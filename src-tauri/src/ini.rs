use crate::preset::Preset;
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KeyBind {
    pub ini_path: String,
    pub ini_rel_name: String,
    pub section: String,
    pub key_line_idx: usize,
    pub raw_key: String,
    pub normalized_key: String,
    pub variable: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DryRunDto {
    pub preset_id: String,
    pub injected_lines: usize,
    pub touched_sections: usize,
    pub already_applied_lines: usize,
    pub matching_sections_total: usize,
    pub preview: Vec<String>,
    pub has_backup: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchReport {
    pub injected_lines: usize,
    pub touched_sections: usize,
    pub already_applied_lines: usize,
    pub matching_sections_total: usize,
    pub preview: Vec<String>,
    pub patched_content: String,
}

pub fn modctl_backup_path(ini_path: &Path) -> PathBuf {
    let mut os: OsString = ini_path.as_os_str().to_os_string();
    os.push(".modctl.bak");
    PathBuf::from(os)
}

pub fn legacy_backup_path(ini_path: &Path) -> PathBuf {
    let mut os: OsString = ini_path.as_os_str().to_os_string();
    os.push(".bak");
    PathBuf::from(os)
}

pub fn has_backup_file(ini_path: &Path) -> bool {
    modctl_backup_path(ini_path).is_file() || legacy_backup_path(ini_path).is_file()
}

// Preserve original untouched file across sequential passes (such as 3+ followed by 0+).
pub fn ensure_backup_once(ini_path: &Path) -> Result<(), String> {
    let bak = modctl_backup_path(ini_path);
    if !bak.exists() {
        fs::copy(ini_path, &bak)
            .map_err(|e| format!("Failed to create backup '{}': {e}", bak.display()))?;
    }
    Ok(())
}

pub fn restore_backup(ini_path: &Path) -> Result<(), String> {
    let modctl_bak = modctl_backup_path(ini_path);
    if modctl_bak.is_file() {
        fs::copy(&modctl_bak, ini_path)
            .map_err(|e| format!("Failed to restore backup '{}': {e}", modctl_bak.display()))?;
        fs::remove_file(&modctl_bak)
            .map_err(|e| format!("Failed to clean up backup '{}': {e}", modctl_bak.display()))?;
        return Ok(());
    }

    let legacy_bak = legacy_backup_path(ini_path);
    if legacy_bak.is_file() {
        fs::copy(&legacy_bak, ini_path)
            .map_err(|e| format!("Failed to restore backup '{}': {e}", legacy_bak.display()))?;
        return Ok(());
    }

    Err(format!(
        "No backup file found for '{}'.",
        ini_path.display()
    ))
}

fn split_lines_lossless(body: &str) -> Vec<(&str, &str)> {
    body.split_inclusive('\n')
        .map(|raw_line| {
            if let Some(s) = raw_line.strip_suffix("\r\n") {
                (s, "\r\n")
            } else if let Some(s) = raw_line.strip_suffix('\n') {
                (s, "\n")
            } else {
                (raw_line, "")
            }
        })
        .collect()
}

fn parse_section_header(trimmed: &str) -> Option<&str> {
    if !trimmed.starts_with('[') {
        return None;
    }
    let close = trimmed.find(']')?;
    let rest = trimmed[close + 1..].trim();
    if rest.is_empty() || rest.starts_with(';') {
        Some(trimmed[1..close].trim())
    } else {
        None
    }
}

fn parse_component_index(section_name: &str) -> Option<u32> {
    let lower = section_name.to_lowercase();
    lower.rmatch_indices("component").find_map(|(idx, _)| {
        let after = lower[idx + "component".len()..].trim_start_matches([' ', '_', '-']);
        let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
        if digits.is_empty() {
            None
        } else {
            digits.parse::<u32>().ok()
        }
    })
}

fn eq_ci(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
}

fn leading_indent(line: &str) -> &str {
    let idx = line
        .find(|c: char| !c.is_whitespace())
        .unwrap_or(line.len());
    &line[..idx]
}

fn push_line(out: &mut Vec<(String, String)>, content: String, ending: &str, default_nl: &str) {
    if let Some(prev) = out.last_mut() {
        if prev.1.is_empty() {
            prev.1 = default_nl.to_string();
        }
    }
    out.push((content, ending.to_string()));
}

pub fn inspect_and_dry_run(raw: &str, preset: &Preset) -> PatchReport {
    let (bom, body) = raw
        .strip_prefix('\u{feff}')
        .map_or(("", raw), |rest| ("\u{feff}", rest));
    let default_nl = if body.contains("\r\n") { "\r\n" } else { "\n" };
    let lines = split_lines_lossless(body);

    let prefix_lower = preset.section_prefix.trim().to_lowercase();
    let mut out: Vec<(String, String)> = Vec::with_capacity(lines.len() + 16);
    let mut preview: Vec<String> = Vec::new();
    let mut in_target = false;
    let mut current_sec = String::new();
    let mut sec_touched = false;
    let mut section_start_out_idx = 0usize;

    let mut injected_lines = 0usize;
    let mut touched_sections = 0usize;
    let mut already_applied_lines = 0usize;
    let mut matching_sections_total = 0usize;

    for i in 0..lines.len() {
        let (content, ending) = lines[i];
        let trimmed = content.trim();

        if let Some(sec) = parse_section_header(trimmed) {
            let sec_lower = sec.to_lowercase();
            let pref_ok = !prefix_lower.is_empty() && sec_lower.starts_with(&prefix_lower);
            let comp_ok = match preset.min_component {
                Some(min_c) => parse_component_index(sec).is_some_and(|c| c >= min_c),
                None => true,
            };
            in_target = pref_ok && comp_ok;
            if in_target {
                matching_sections_total += 1;
            }
            current_sec = sec.to_string();
            sec_touched = false;
            push_line(&mut out, content.to_string(), ending, default_nl);
            section_start_out_idx = out.len();
            continue;
        }

        if in_target && !trimmed.is_empty() && !trimmed.starts_with(';') {
            let indent = leading_indent(content);
            let inject_ending = if ending.is_empty() {
                default_nl
            } else {
                ending
            };

            for rule in &preset.insert_before {
                if eq_ci(trimmed, &rule.anchor) {
                    let mut already = false;
                    for (emitted, _) in out[section_start_out_idx..].iter().rev() {
                        let et = emitted.trim();
                        if et.is_empty() || et.starts_with(';') {
                            continue;
                        }
                        if eq_ci(et, &rule.inject) {
                            already = true;
                            break;
                        }
                        let is_sibling = preset.insert_before.iter().any(|other| {
                            eq_ci(&other.anchor, &rule.anchor) && eq_ci(et, &other.inject)
                        });
                        if !is_sibling {
                            break;
                        }
                    }

                    if already {
                        already_applied_lines += 1;
                    } else {
                        if !sec_touched {
                            preview.push(format!("[{current_sec}]"));
                            sec_touched = true;
                            touched_sections += 1;
                        }
                        let injected = format!("{indent}{}", rule.inject);
                        push_line(&mut out, injected.clone(), inject_ending, default_nl);
                        preview.push(format!("+ {injected}"));
                        injected_lines += 1;
                    }
                }
            }

            push_line(&mut out, content.to_string(), ending, default_nl);

            for rule in &preset.insert_after {
                if eq_ci(trimmed, &rule.anchor) {
                    let mut already = false;
                    for &(next_content, _) in &lines[i + 1..] {
                        let nt = next_content.trim();
                        if nt.is_empty() || nt.starts_with(';') {
                            continue;
                        }
                        if parse_section_header(nt).is_some() {
                            break;
                        }
                        if eq_ci(nt, &rule.inject) {
                            already = true;
                            break;
                        }
                        let is_sibling = preset.insert_after.iter().any(|other| {
                            eq_ci(&other.anchor, &rule.anchor) && eq_ci(nt, &other.inject)
                        });
                        if !is_sibling {
                            break;
                        }
                    }

                    if already {
                        already_applied_lines += 1;
                    } else {
                        if !sec_touched {
                            preview.push(format!("[{current_sec}]"));
                            sec_touched = true;
                            touched_sections += 1;
                        }
                        let injected = format!("{indent}{}", rule.inject);
                        let after_ending = if ending.is_empty() { "" } else { ending };
                        push_line(&mut out, injected.clone(), after_ending, default_nl);
                        preview.push(format!("+ {injected}"));
                        injected_lines += 1;
                    }
                }
            }
        } else {
            push_line(&mut out, content.to_string(), ending, default_nl);
        }
    }

    let mut patched_content = String::with_capacity(raw.len() + injected_lines * 48);
    patched_content.push_str(bom);
    for (c, e) in out {
        patched_content.push_str(&c);
        patched_content.push_str(&e);
    }

    PatchReport {
        injected_lines,
        touched_sections,
        already_applied_lines,
        matching_sections_total,
        preview,
        patched_content,
    }
}

pub fn read_ini_utf8(ini_path: &Path) -> Result<String, String> {
    fs::read_to_string(ini_path)
        .map_err(|e| format!("Failed to read '{}': {e}", ini_path.display()))
}

// ponytail: lossy fallback is scan-only; mutating paths call read_ini_utf8 so non-UTF-8 files are never corrupted with U+FFFD.
pub fn read_ini_lossy(ini_path: &Path) -> Result<String, String> {
    let bytes =
        fs::read(ini_path).map_err(|e| format!("Failed to read '{}': {e}", ini_path.display()))?;
    Ok(match String::from_utf8(bytes) {
        Ok(s) => s,
        Err(err) => String::from_utf8_lossy(err.as_bytes()).into_owned(),
    })
}

pub fn preview_preset_file(ini_path: &Path, preset: &Preset) -> Result<DryRunDto, String> {
    let raw = read_ini_utf8(ini_path)?;
    let report = inspect_and_dry_run(&raw, preset);
    Ok(DryRunDto {
        preset_id: preset.id.clone(),
        injected_lines: report.injected_lines,
        touched_sections: report.touched_sections,
        already_applied_lines: report.already_applied_lines,
        matching_sections_total: report.matching_sections_total,
        preview: report.preview,
        has_backup: has_backup_file(ini_path),
    })
}

pub fn apply_preset_file(ini_path: &Path, preset: &Preset) -> Result<DryRunDto, String> {
    let raw = read_ini_utf8(ini_path)?;
    let report = inspect_and_dry_run(&raw, preset);
    if report.injected_lines > 0 {
        ensure_backup_once(ini_path)?;
        fs::write(ini_path, &report.patched_content)
            .map_err(|e| format!("Failed to write '{}': {e}", ini_path.display()))?;
    }
    Ok(DryRunDto {
        preset_id: preset.id.clone(),
        injected_lines: report.injected_lines,
        touched_sections: report.touched_sections,
        already_applied_lines: report.already_applied_lines,
        matching_sections_total: report.matching_sections_total,
        preview: report.preview,
        has_backup: has_backup_file(ini_path),
    })
}

pub fn normalize_key_combo(raw: &str) -> String {
    let mut mods: Vec<&str> = Vec::new();
    let mut main_key = String::new();

    for part in raw.split_whitespace() {
        let lower = part.to_lowercase();
        if lower.starts_with("no_") {
            continue;
        }
        let stripped = lower.strip_prefix("vk_").unwrap_or(&lower);
        match stripped {
            "ctrl" | "control" | "lctrl" | "rctrl" => mods.push("ctrl"),
            "alt" | "menu" | "lalt" | "ralt" => mods.push("alt"),
            "shift" | "lshift" | "rshift" => mods.push("shift"),
            _ => main_key = stripped.to_string(),
        }
    }

    mods.sort_unstable();
    mods.dedup();

    if main_key.is_empty() {
        return raw.trim().to_lowercase();
    }
    if mods.is_empty() {
        main_key
    } else {
        format!("{}+{main_key}", mods.join("+"))
    }
}

pub fn extract_keybinds(raw: &str, ini_path: &str, ini_rel_name: &str) -> Vec<KeyBind> {
    let body = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let lines = split_lines_lossless(body);

    let mut out: Vec<KeyBind> = Vec::new();
    let mut current_sec = String::new();
    let mut in_key_sec = false;
    let mut sec_binds: Vec<KeyBind> = Vec::new();
    let mut sec_var: Option<String> = None;

    let flush_sec = |out: &mut Vec<KeyBind>, binds: &mut Vec<KeyBind>, var: &mut Option<String>| {
        for mut kb in binds.drain(..) {
            kb.variable = var.clone();
            out.push(kb);
        }
        *var = None;
    };

    for (idx, &(content, _)) in lines.iter().enumerate() {
        let trimmed = content.trim();
        if trimmed.is_empty() || trimmed.starts_with(';') {
            continue;
        }
        if let Some(sec) = parse_section_header(trimmed) {
            flush_sec(&mut out, &mut sec_binds, &mut sec_var);
            current_sec = sec.to_string();
            in_key_sec = sec.to_lowercase().starts_with("key");
            continue;
        }
        if !in_key_sec {
            continue;
        }

        // Do not strip inline ';' because ';' itself is a valid 3DMigoto key binding.
        if let Some((lhs, rhs)) = trimmed.split_once('=') {
            let lhs_trim = lhs.trim();
            let rhs_trim = rhs.trim();
            if lhs_trim.starts_with('$') && sec_var.is_none() && !lhs_trim.is_empty() {
                sec_var = Some(lhs_trim.to_string());
            } else if (lhs_trim.eq_ignore_ascii_case("key")
                || lhs_trim.eq_ignore_ascii_case("back"))
                && !rhs_trim.is_empty()
            {
                sec_binds.push(KeyBind {
                    ini_path: ini_path.to_string(),
                    ini_rel_name: ini_rel_name.to_string(),
                    section: current_sec.clone(),
                    key_line_idx: idx,
                    raw_key: rhs_trim.to_string(),
                    normalized_key: normalize_key_combo(rhs_trim),
                    variable: None,
                });
            }
        }
    }

    flush_sec(&mut out, &mut sec_binds, &mut sec_var);
    out
}

pub fn update_keybind_in_file(
    ini_path: &Path,
    line_idx: usize,
    new_key: &str,
) -> Result<(), String> {
    let cleaned_key = new_key.trim();
    if cleaned_key.is_empty() {
        return Err("New key binding cannot be empty.".into());
    }
    if cleaned_key.contains(['\r', '\n']) {
        return Err("Key binding cannot contain newline characters.".into());
    }

    let raw = read_ini_utf8(ini_path)?;
    let (bom, body) = raw
        .strip_prefix('\u{feff}')
        .map_or(("", raw.as_str()), |rest| ("\u{feff}", rest));
    let mut lines = split_lines_lossless(body);

    if line_idx >= lines.len() {
        return Err(format!(
            "Line index {line_idx} is out of range for '{}'.",
            ini_path.display()
        ));
    }

    let (target_content, target_ending) = lines[line_idx];
    let (lhs, _) = target_content
        .split_once('=')
        .ok_or_else(|| format!("Line {line_idx} is not a valid key assignment."))?;
    let lhs_key = lhs.trim();
    if !lhs_key.eq_ignore_ascii_case("key") && !lhs_key.eq_ignore_ascii_case("back") {
        return Err(format!(
            "Line {line_idx} ('{lhs_key}') is not a 'key' or 'back' binding."
        ));
    }

    let indent = leading_indent(target_content);
    let replacement = format!("{indent}{lhs_key} = {cleaned_key}");

    ensure_backup_once(ini_path)?;

    let mut out = String::with_capacity(raw.len() + cleaned_key.len());
    out.push_str(bom);
    for (idx, (content, ending)) in lines.drain(..).enumerate() {
        if idx == line_idx {
            out.push_str(&replacement);
            out.push_str(target_ending);
        } else {
            out.push_str(content);
            out.push_str(ending);
        }
    }

    fs::write(ini_path, out).map_err(|e| format!("Failed to write '{}': {e}", ini_path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preset::builtin_presets;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("modctl_ini_{tag}_{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn preserves_bom_crlf_tabs_and_unicode_comments() {
        let presets = builtin_presets();
        let p3 = &presets[0];
        let raw = "\u{feff}; 日本語コメント / 中文注释 / Кириллица\r\n[TextureOverride_雅_Component0]\r\nhash = 11aa22\r\nrun = CommandListOverrideSharedResources\r\nib = ResourceIB0\r\nrun = CommandListCleanupSharedResources\r\n\r\n[TextureOverride_雅_Component3] ; 衣装メッシュ\r\nhash = 33bb44\r\n\trun = CommandListOverrideSharedResources\r\n\t; 内側コメント\r\n\tib = ResourceIB3\r\n\trun = CommandListCleanupSharedResources\r\n";

        let rep = inspect_and_dry_run(raw, p3);
        assert_eq!(rep.matching_sections_total, 1);
        assert_eq!(rep.touched_sections, 1);
        assert_eq!(rep.injected_lines, 2);
        assert_eq!(rep.already_applied_lines, 0);
        assert!(rep.patched_content.starts_with('\u{feff}'));
        assert!(rep
            .patched_content
            .contains("\trun = CommandListOverrideSharedResources\r\n\trun = CommandList\\KatFXMatcap\\OilSkin\r\n"));
        assert!(rep
            .patched_content
            .contains("\trun = CommandList\\KatFXMatcap\\Clear\r\n\trun = CommandListCleanupSharedResources\r\n"));
        assert!(!rep
            .patched_content
            .contains("\nrun = CommandList\\KatFXMatcap\\OilSkin"));

        let rep_again = inspect_and_dry_run(&rep.patched_content, p3);
        assert_eq!(rep_again.injected_lines, 0);
        assert_eq!(rep_again.already_applied_lines, 2);
        assert_eq!(rep_again.patched_content, rep.patched_content);
    }

    #[test]
    fn sequential_3plus_then_all_preserves_original_backup_for_clean_restore() {
        let dir = temp_dir("seq_bak");
        let ini_path = dir.join("merged.ini");
        let original = "[TextureOverrideComponent0]\nhash = aa\nrun = CommandListOverrideSharedResources\nrun = CommandListCleanupSharedResources\n\n[TextureOverrideComponent3]\nhash = bb\nrun = CommandListOverrideSharedResources\nrun = CommandListCleanupSharedResources";
        fs::write(&ini_path, original).unwrap();

        let presets = builtin_presets();
        let p3 = &presets[0];
        let pall = &presets[1];

        let r1 = apply_preset_file(&ini_path, p3).unwrap();
        assert_eq!(r1.injected_lines, 2);
        assert_eq!(r1.touched_sections, 1);
        assert!(r1.has_backup);

        let r2 = apply_preset_file(&ini_path, pall).unwrap();
        assert_eq!(r2.matching_sections_total, 2);
        assert_eq!(r2.injected_lines, 2);
        assert_eq!(r2.already_applied_lines, 2);
        assert!(r2.has_backup);

        restore_backup(&ini_path).unwrap();
        assert!(!has_backup_file(&ini_path));
        let restored = fs::read_to_string(&ini_path).unwrap();
        assert_eq!(restored, original);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn handles_merged_mod_multiple_branches_inside_single_section() {
        let presets = builtin_presets();
        let p3 = &presets[0];
        let merged = "[TextureOverrideComponent3]\nhash = 33bb44\nif $swapvar == 0\n\trun = CommandListOverrideSharedResources\n\tib = ResourceIB0\n\trun = CommandListCleanupSharedResources\nelse if $swapvar == 1\n\trun = CommandListOverrideSharedResources\n\tib = ResourceIB1\n\trun = CommandListCleanupSharedResources\nendif\n";

        let rep = inspect_and_dry_run(merged, p3);
        assert_eq!(rep.matching_sections_total, 1);
        assert_eq!(rep.touched_sections, 1);
        assert_eq!(rep.injected_lines, 4);

        let idemp = inspect_and_dry_run(&rep.patched_content, p3);
        assert_eq!(idemp.injected_lines, 0);
        assert_eq!(idemp.already_applied_lines, 4);
    }

    #[test]
    fn extracts_normalizes_and_updates_keybinds_including_semicolon_and_back() {
        let dir = temp_dir("keys");
        let ini_path = dir.join("Burnice.ini");
        let raw = "\u{feff}[KeySwapOutfit]\r\n\tkey = no_ctrl no_alt VK_UP\r\n\tback = ctrl shift ; \r\ntype = cycle\r\n$outfit = 0,1,2\r\n";
        fs::write(&ini_path, raw).unwrap();

        let binds = extract_keybinds(raw, ini_path.to_str().unwrap(), "Burnice.ini");
        assert_eq!(binds.len(), 2);
        assert_eq!(binds[0].section, "KeySwapOutfit");
        assert_eq!(binds[0].key_line_idx, 1);
        assert_eq!(binds[0].normalized_key, "up");
        assert_eq!(binds[0].variable.as_deref(), Some("$outfit"));
        assert_eq!(binds[1].key_line_idx, 2);
        assert_eq!(binds[1].normalized_key, "ctrl+shift+;");

        update_keybind_in_file(&ini_path, 1, "ctrl no_alt VK_F8").unwrap();
        assert!(has_backup_file(&ini_path));
        let updated = fs::read_to_string(&ini_path).unwrap();
        assert!(updated.starts_with('\u{feff}'));
        assert!(updated.contains("\tkey = ctrl no_alt VK_F8\r\n"));
        assert!(
            updated.contains("\tback = ctrl shift ;\r\n")
                || updated.contains("\tback = ctrl shift ; \r\n")
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn restores_legacy_bak_and_handles_no_trailing_newline_multi_rule() {
        let dir = temp_dir("legacy_bak");
        let ini_path = dir.join("char.ini");
        let bak_path = legacy_backup_path(&ini_path);
        fs::write(&ini_path, "[TextureOverrideBody]\nhash = 123").unwrap();
        fs::write(&bak_path, "[TextureOverrideBody]\nhash = original").unwrap();

        assert!(has_backup_file(&ini_path));
        restore_backup(&ini_path).unwrap();
        assert_eq!(
            fs::read_to_string(&ini_path).unwrap(),
            "[TextureOverrideBody]\nhash = original"
        );
        assert!(bak_path.is_file());

        let multi = Preset {
            id: "multi".into(),
            name: "Multi".into(),
            description: String::new(),
            group: None,
            source_url: None,
            recommended: false,
            section_prefix: "TextureOverride".into(),
            min_component: None,
            builtin: false,
            insert_after: vec![
                crate::preset::AnchorInsert {
                    anchor: "hash = original".into(),
                    inject: "ps-t0 = ResourceA".into(),
                },
                crate::preset::AnchorInsert {
                    anchor: "hash = original".into(),
                    inject: "ps-t1 = ResourceB".into(),
                },
            ],
            insert_before: vec![],
        };

        let raw = fs::read_to_string(&ini_path).unwrap();
        let r1 = inspect_and_dry_run(&raw, &multi);
        assert_eq!(r1.injected_lines, 2);
        assert_eq!(
            r1.patched_content,
            "[TextureOverrideBody]\nhash = original\nps-t0 = ResourceA\nps-t1 = ResourceB"
        );
        let r2 = inspect_and_dry_run(&r1.patched_content, &multi);
        assert_eq!(r2.injected_lines, 0);
        assert_eq!(r2.already_applied_lines, 2);

        let _ = fs::remove_dir_all(&dir);
    }
}
