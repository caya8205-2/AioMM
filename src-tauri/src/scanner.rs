use crate::ini::{self, KeyBind};
use crate::preset::{self, Preset};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

const KNOWN_GAMES: &[(&str, &str)] = &[
    ("GIMI", "GIMI (Genshin Impact)"),
    ("SRMI", "SRMI (Honkai: Star Rail)"),
    ("ZZMI", "ZZMI (Zenless Zone Zero)"),
    ("WWMI", "WWMI (Wuthering Waves)"),
    ("EFMI", "EFMI (Endfield)"),
];

const PREVIEW_EXTS: &[&str] = &["png", "webp", "jpg", "jpeg", "gif", "bmp", "avif"];
const MAX_SCAN_DEPTH: usize = 6;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetectedFolder {
    pub label: String,
    pub game_code: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IniFileEntry {
    pub path: String,
    pub rel_name: String,
    pub is_disabled: bool,
    pub has_backup: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModEntry {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub category: Option<String>,
    pub path: String,
    pub enabled: bool,
    pub preview_path: Option<String>,
    pub ini_files: Vec<IniFileEntry>,
    pub keybinds: Vec<KeyBind>,
    pub applied_preset_ids: Vec<String>,
    pub has_any_backup: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictMember {
    pub mod_id: String,
    pub mod_display_name: String,
    pub mod_path: String,
    pub keybind: KeyBind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KeyConflict {
    pub normalized_key: String,
    pub cross_mod: bool,
    pub entries: Vec<ConflictMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub root: String,
    pub mods: Vec<ModEntry>,
    pub presets: Vec<Preset>,
    pub conflicts: Vec<KeyConflict>,
}

pub fn detect_xxmi_folders() -> Vec<DetectedFolder> {
    let Some(roaming) = dirs::data_dir() else {
        return Vec::new();
    };
    detect_xxmi_folders_in(&roaming.join("XXMI Launcher"))
}

pub fn detect_xxmi_folders_in(xxmi_root: &Path) -> Vec<DetectedFolder> {
    if !xxmi_root.is_dir() {
        return Vec::new();
    }

    let mut candidate_roots: Vec<PathBuf> =
        vec![xxmi_root.to_path_buf(), xxmi_root.join("Importers")];
    let mut per_game_dirs: Vec<(&str, &str, PathBuf)> = Vec::new();

    let cfg_path = xxmi_root.join("XXMI Launcher Config.json");
    if let Ok(raw) = fs::read_to_string(&cfg_path) {
        if let Ok(val) =
            serde_json::from_str::<serde_json::Value>(raw.strip_prefix('\u{feff}').unwrap_or(&raw))
        {
            for ptr in [
                "/importer_folder",
                "/Launcher/importer_folder",
                "/AppConfig/importer_folder",
            ] {
                if let Some(folder_str) = val.pointer(ptr).and_then(|v| v.as_str()) {
                    let trimmed = folder_str.trim();
                    if !trimmed.is_empty() {
                        let resolved = resolve_maybe_relative(xxmi_root, Path::new(trimmed));
                        candidate_roots.push(resolved);
                    }
                }
            }

            for &(code, label) in KNOWN_GAMES {
                let ptr = format!("/Importers/{code}/Importer/importer_folder");
                if let Some(folder_str) = val.pointer(&ptr).and_then(|v| v.as_str()) {
                    let trimmed = folder_str.trim();
                    if !trimmed.is_empty() {
                        let imp_dir = resolve_maybe_relative(xxmi_root, Path::new(trimmed));
                        per_game_dirs.push((code, label, imp_dir.join("Mods")));
                    }
                }
            }
        }
    }

    let mut seen = HashSet::new();
    let mut found = Vec::new();

    let mut push_if_exists = |code: &str, label: &str, mods_dir: PathBuf| {
        if !mods_dir.is_dir() {
            return;
        }
        let path_str = mods_dir.to_string_lossy().to_string();
        let dedup_key = path_str.replace('/', "\\").to_lowercase();
        if seen.insert(dedup_key) {
            found.push(DetectedFolder {
                label: label.to_string(),
                game_code: code.to_string(),
                path: path_str,
            });
        }
    };

    for &(code, label) in KNOWN_GAMES {
        for base in &candidate_roots {
            push_if_exists(code, label, base.join(code).join("Mods"));
        }
    }
    for (code, label, mods_dir) in per_game_dirs {
        push_if_exists(code, label, mods_dir);
    }

    found
}

fn resolve_maybe_relative(base: &Path, target: &Path) -> PathBuf {
    if target.is_absolute() {
        target.to_path_buf()
    } else {
        base.join(target)
    }
}

pub fn is_disabled_name(name: &str) -> bool {
    name.trim_start().to_lowercase().starts_with("disabled")
}

pub fn strip_disabled_prefix(name: &str) -> String {
    let trimmed = name.trim();
    let lower = trimmed.to_lowercase();
    if !lower.starts_with("disabled") {
        return trimmed.to_string();
    }
    // "disabled" is 8 ASCII bytes, so slicing at 8 is always a valid UTF-8 boundary.
    let rest = trimmed[8..].trim_start_matches(['_', '-', ' ']);
    if rest.is_empty() {
        trimmed.to_string()
    } else {
        rest.to_string()
    }
}

fn is_ini_file(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    if name.eq_ignore_ascii_case("desktop.ini") {
        return false;
    }
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("ini"))
}

fn has_direct_ini(dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    entries
        .flatten()
        .any(|e| e.file_type().is_ok_and(|ft| ft.is_file()) && is_ini_file(&e.path()))
}

fn collect_mod_dirs(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth >= MAX_SCAN_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut subdirs: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| {
            let ok_dir = e.file_type().is_ok_and(|ft| ft.is_dir());
            let name_ok = e.file_name().to_str().is_some_and(|n| !n.starts_with('.'));
            ok_dir && name_ok
        })
        .map(|e| e.path())
        .collect();
    subdirs.sort_by_key(|p| p.to_string_lossy().to_lowercase());

    for sub in subdirs {
        if has_direct_ini(&sub) {
            out.push(sub);
        } else {
            collect_mod_dirs(&sub, depth + 1, out);
        }
    }
}

fn collect_ini_files(mod_dir: &Path, cur: &Path, depth: usize, out: &mut Vec<IniFileEntry>) {
    if depth > MAX_SCAN_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(cur) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if ft.is_file() && is_ini_file(&path) {
            let rel = path.strip_prefix(mod_dir).unwrap_or(&path);
            let rel_name = rel.to_string_lossy().replace('/', "\\");
            let is_disabled = rel
                .components()
                .any(|c| is_disabled_name(&c.as_os_str().to_string_lossy()));
            out.push(IniFileEntry {
                path: path.to_string_lossy().to_string(),
                rel_name,
                is_disabled,
                has_backup: ini::has_backup_file(&path),
            });
        } else if ft.is_dir() {
            let skip = entry
                .file_name()
                .to_str()
                .is_some_and(|n| n.starts_with('.'));
            if !skip {
                collect_ini_files(mod_dir, &path, depth + 1, out);
            }
        }
    }
}

pub fn find_preview_image(mod_dir: &Path) -> Option<String> {
    let entries = fs::read_dir(mod_dir).ok()?;
    let mut candidates: Vec<(u8, usize, String, PathBuf)> = Vec::new();

    for entry in entries.flatten() {
        if !entry.file_type().is_ok_and(|ft| ft.is_file()) {
            continue;
        }
        let path = entry.path();
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        let ext_lower = ext.to_lowercase();
        let Some(ext_rank) = PREVIEW_EXTS.iter().position(|&x| x == ext_lower) else {
            continue;
        };
        let stem_lower = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();

        let priority = if stem_lower == "preview" {
            0
        } else if stem_lower.starts_with("preview")
            || stem_lower.starts_with("thumb")
            || stem_lower.starts_with("cover")
            || stem_lower.starts_with("icon")
        {
            1
        } else {
            2
        };

        candidates.push((priority, ext_rank, stem_lower, path));
    }

    candidates.sort_by(|a, b| (a.0, a.1, &a.2).cmp(&(b.0, b.1, &b.2)));
    candidates
        .into_iter()
        .next()
        .map(|(_, _, _, p)| p.to_string_lossy().to_string())
}

pub fn find_key_conflicts(mods: &[ModEntry]) -> Vec<KeyConflict> {
    let mut grouped: BTreeMap<String, Vec<ConflictMember>> = BTreeMap::new();

    for m in mods {
        if !m.enabled {
            continue;
        }
        for kb in &m.keybinds {
            if kb.normalized_key.is_empty() {
                continue;
            }
            grouped
                .entry(kb.normalized_key.clone())
                .or_default()
                .push(ConflictMember {
                    mod_id: m.id.clone(),
                    mod_display_name: m.display_name.clone(),
                    mod_path: m.path.clone(),
                    keybind: kb.clone(),
                });
        }
    }

    let mut conflicts: Vec<KeyConflict> = grouped
        .into_iter()
        .filter_map(|(normalized_key, entries)| {
            if entries.len() < 2 {
                return None;
            }
            let distinct_mods: HashSet<&str> = entries.iter().map(|e| e.mod_id.as_str()).collect();
            Some(KeyConflict {
                normalized_key,
                cross_mod: distinct_mods.len() > 1,
                entries,
            })
        })
        .collect();

    conflicts
        .sort_by(|a, b| (!a.cross_mod, &a.normalized_key).cmp(&(!b.cross_mod, &b.normalized_key)));
    conflicts
}

pub fn scan_workspace(root: &Path) -> Result<WorkspaceSnapshot, String> {
    if !root.exists() {
        return Err(format!("Mods folder does not exist: {}", root.display()));
    }
    if !root.is_dir() {
        return Err(format!("Selected path is not a folder: {}", root.display()));
    }

    let presets = preset::load_presets(Some(root))?;
    let mut mod_dirs = Vec::new();
    collect_mod_dirs(root, 0, &mut mod_dirs);
    if mod_dirs.is_empty() && has_direct_ini(root) {
        mod_dirs.push(root.to_path_buf());
    }

    let mut mods: Vec<ModEntry> = Vec::with_capacity(mod_dirs.len());

    for mod_dir in mod_dirs {
        let mut ini_files = Vec::new();
        collect_ini_files(&mod_dir, &mod_dir, 0, &mut ini_files);
        if ini_files.is_empty() {
            continue;
        }

        ini_files.sort_by_key(|f| {
            let depth_nonzero = f.rel_name.contains(['\\', '/']);
            let not_merged = !f.rel_name.eq_ignore_ascii_case("merged.ini");
            (
                f.is_disabled,
                depth_nonzero,
                not_merged,
                f.rel_name.to_lowercase(),
            )
        });

        let name = mod_dir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| mod_dir.to_string_lossy().to_string());
        let clean_name = strip_disabled_prefix(&name);
        let display_words: Vec<&str> = clean_name
            .split(['_', ' '])
            .filter(|w| !w.is_empty())
            .collect();
        let display_name = if display_words.is_empty() {
            clean_name.clone()
        } else {
            display_words.join(" ")
        };

        let (category, enabled, id) = if mod_dir == root {
            let en = !is_disabled_name(&name);
            (None, en, clean_name.clone())
        } else {
            let rel = mod_dir.strip_prefix(root).unwrap_or(&mod_dir);
            let folder_disabled = rel
                .components()
                .any(|c| is_disabled_name(&c.as_os_str().to_string_lossy()));

            let parent_parts: Vec<String> = rel
                .parent()
                .map(|p| {
                    p.components()
                        .map(|c| strip_disabled_prefix(&c.as_os_str().to_string_lossy()))
                        .filter(|s| !s.is_empty())
                        .collect()
                })
                .unwrap_or_default();

            let cat = if parent_parts.is_empty() {
                None
            } else {
                Some(parent_parts.join(" / "))
            };

            let mut id_parts = parent_parts;
            id_parts.push(clean_name.clone());
            (cat, !folder_disabled, id_parts.join("/"))
        };

        let mut keybinds = Vec::new();
        let mut applied_preset_ids = Vec::new();

        for ini_entry in &ini_files {
            if ini_entry.is_disabled {
                continue;
            }
            let Ok(raw) = ini::read_ini_lossy(Path::new(&ini_entry.path)) else {
                continue;
            };
            if enabled {
                let mut binds = ini::extract_keybinds(&raw, &ini_entry.path, &ini_entry.rel_name);
                keybinds.append(&mut binds);
            }
            for p in &presets {
                let rep = ini::inspect_and_dry_run(&raw, p);
                if rep.already_applied_lines > 0
                    && rep.injected_lines == 0
                    && !applied_preset_ids.contains(&p.id)
                {
                    applied_preset_ids.push(p.id.clone());
                }
            }
        }

        let has_any_backup = ini_files.iter().any(|f| f.has_backup);

        mods.push(ModEntry {
            id,
            name,
            display_name,
            category,
            path: mod_dir.to_string_lossy().to_string(),
            enabled,
            preview_path: find_preview_image(&mod_dir),
            ini_files,
            keybinds,
            applied_preset_ids,
            has_any_backup,
        });
    }

    let mut id_counts: BTreeMap<String, usize> = BTreeMap::new();
    for m in &mods {
        *id_counts.entry(m.id.clone()).or_default() += 1;
    }
    for m in &mut mods {
        if id_counts.get(&m.id).copied().unwrap_or(0) > 1 {
            if let Ok(rel) = Path::new(&m.path).strip_prefix(root) {
                m.id = rel.to_string_lossy().replace('\\', "/");
            }
        }
    }

    // Sort independent of `enabled` so toggling a mod ON/OFF never jumps its card out from under the cursor.
    mods.sort_by(|a, b| {
        let ca = a.category.as_deref().unwrap_or("").to_lowercase();
        let cb = b.category.as_deref().unwrap_or("").to_lowercase();
        (ca, a.display_name.to_lowercase(), a.name.to_lowercase()).cmp(&(
            cb,
            b.display_name.to_lowercase(),
            b.name.to_lowercase(),
        ))
    });

    let conflicts = find_key_conflicts(&mods);

    Ok(WorkspaceSnapshot {
        root: root.to_string_lossy().to_string(),
        mods,
        presets,
        conflicts,
    })
}

pub fn toggle_mod_folder(mod_path: &Path) -> Result<String, String> {
    if !mod_path.exists() || !mod_path.is_dir() {
        return Err(format!("Mod folder not found: {}", mod_path.display()));
    }
    let parent = mod_path
        .parent()
        .ok_or_else(|| "Cannot toggle filesystem root directory.".to_string())?;
    let folder_name = mod_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Mod folder name is not valid UTF-8.".to_string())?;

    let target_name = if is_disabled_name(folder_name) {
        strip_disabled_prefix(folder_name)
    } else {
        format!("DISABLED_{folder_name}")
    };

    let target_path = parent.join(&target_name);
    if target_path.exists() {
        return Err(format!(
            "Cannot rename mod because '{}' already exists in '{}'.",
            target_name,
            parent.display()
        ));
    }

    fs::rename(mod_path, &target_path).map_err(|e| {
        format!(
            "Failed to rename '{}' to '{}': {e}",
            mod_path.display(),
            target_path.display()
        )
    })?;

    Ok(target_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("modctl_scan_{tag}_{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn scans_nested_categories_merged_slots_previews_and_conflicts() {
        let root = temp_dir("workspace");

        let jane = root.join("JaneDoe_Jacket");
        fs::create_dir_all(jane.join("Slot0")).unwrap();
        fs::write(
            jane.join("merged.ini"),
            "[KeySwapJacket]\nkey = no_ctrl no_alt VK_UP\n$jacket = 0,1\n\n[KeySwapHair]\nkey = VK_RIGHT\n$hair = 0,1\n\n[KeySwapBoots]\nkey = no_ctrl VK_RIGHT\n$boots = 0,1\n\n[TextureOverrideComponent3]\nrun = CommandListOverrideSharedResources\nrun = CommandList\\KatFXMatcap\\OilSkin\nrun = CommandList\\KatFXMatcap\\Clear\nrun = CommandListCleanupSharedResources\n",
        )
        .unwrap();
        fs::write(
            jane.join("Slot0").join("DISABLED_base.ini"),
            "[KeyOld]\nkey = VK_F9\n",
        )
        .unwrap();
        fs::write(jane.join("desktop.ini"), "[.ShellClassInfo]\n").unwrap();
        fs::write(jane.join("diffuse.dds"), b"DDS ").unwrap();
        fs::write(jane.join("preview.png"), b"\x89PNG").unwrap();

        let burnice = root.join("Burnice").join("Alt_Coat");
        fs::create_dir_all(&burnice).unwrap();
        fs::write(
            burnice.join("Burnice.ini"),
            "[KeyToggleGlasses]\nkey = VK_UP\n$glasses = 0,1\n",
        )
        .unwrap();
        fs::write(burnice.join("shot.webp"), b"RIFF").unwrap();

        let evelyn = root.join("DISABLED_Evelyn_Old");
        fs::create_dir_all(&evelyn).unwrap();
        fs::write(
            evelyn.join("Evelyn.ini"),
            "[KeyToggle]\nkey = VK_UP\n$swap = 0,1\n",
        )
        .unwrap();

        let snap = scan_workspace(&root).unwrap();
        assert_eq!(snap.mods.len(), 3);

        let jane_mod = snap.mods.iter().find(|m| m.id == "JaneDoe_Jacket").unwrap();
        assert!(jane_mod.enabled);
        assert_eq!(jane_mod.ini_files.len(), 2);
        assert_eq!(jane_mod.ini_files[0].rel_name, "merged.ini");
        assert!(!jane_mod.ini_files[0].is_disabled);
        assert!(jane_mod.ini_files[1].is_disabled);
        assert!(jane_mod
            .preview_path
            .as_deref()
            .unwrap()
            .ends_with("preview.png"));
        assert!(jane_mod
            .applied_preset_ids
            .contains(&"oilskin-3plus".to_string()));
        assert_eq!(jane_mod.keybinds.len(), 3);

        let burnice_mod = snap
            .mods
            .iter()
            .find(|m| m.id == "Burnice/Alt_Coat")
            .unwrap();
        assert_eq!(burnice_mod.category.as_deref(), Some("Burnice"));
        assert!(burnice_mod
            .preview_path
            .as_deref()
            .unwrap()
            .ends_with("shot.webp"));

        let evelyn_mod = snap.mods.iter().find(|m| m.id == "Evelyn_Old").unwrap();
        assert!(!evelyn_mod.enabled);
        assert_eq!(evelyn_mod.display_name, "Evelyn Old");
        assert!(evelyn_mod.keybinds.is_empty());

        assert_eq!(snap.conflicts.len(), 2);
        assert_eq!(snap.conflicts[0].normalized_key, "up");
        assert!(snap.conflicts[0].cross_mod);
        assert_eq!(snap.conflicts[0].entries.len(), 2);

        assert_eq!(snap.conflicts[1].normalized_key, "right");
        assert!(!snap.conflicts[1].cross_mod);
        assert_eq!(snap.conflicts[1].entries.len(), 2);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn toggles_mod_and_guards_against_name_collision() {
        let root = temp_dir("toggle");
        let mod_a = root.join("Arlecchino_Boss");
        fs::create_dir_all(&mod_a).unwrap();
        fs::write(mod_a.join("mod.ini"), "[TextureOverride]\n").unwrap();

        let disabled_str = toggle_mod_folder(&mod_a).unwrap();
        let disabled_path = PathBuf::from(&disabled_str);
        assert_eq!(
            disabled_path.file_name().unwrap().to_str().unwrap(),
            "DISABLED_Arlecchino_Boss"
        );
        assert!(disabled_path.is_dir());

        fs::create_dir_all(&mod_a).unwrap();
        assert!(toggle_mod_folder(&disabled_path).is_err());
        fs::remove_dir_all(&mod_a).unwrap();

        let reenabled_str = toggle_mod_folder(&disabled_path).unwrap();
        assert_eq!(PathBuf::from(reenabled_str), mod_a);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn detects_xxmi_default_and_custom_importer_folders() {
        let xxmi = temp_dir("xxmi");
        fs::create_dir_all(xxmi.join("ZZMI").join("Mods")).unwrap();
        fs::create_dir_all(xxmi.join("WWMI").join("Mods")).unwrap();

        let custom_drive = temp_dir("custom_xxmi");
        fs::create_dir_all(custom_drive.join("GIMI").join("Mods")).unwrap();
        let cfg = serde_json::json!({
            "Launcher": {
                "importer_folder": custom_drive.to_string_lossy()
            }
        });
        fs::write(
            xxmi.join("XXMI Launcher Config.json"),
            serde_json::to_string(&cfg).unwrap(),
        )
        .unwrap();

        let detected = detect_xxmi_folders_in(&xxmi);
        let codes: Vec<&str> = detected.iter().map(|d| d.game_code.as_str()).collect();
        assert_eq!(codes, vec!["GIMI", "ZZMI", "WWMI"]);
        assert_eq!(detected[0].label, "GIMI (Genshin Impact)");
        assert_eq!(detected[1].label, "ZZMI (Zenless Zone Zero)");

        let _ = fs::remove_dir_all(&xxmi);
        let _ = fs::remove_dir_all(&custom_drive);
    }

    #[test]
    fn deduplicates_mod_ids_when_enabled_and_disabled_copies_coexist() {
        let root = temp_dir("dup_id");
        let a = root.join("Evelyn");
        let b = root.join("DISABLED_Evelyn");
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        fs::write(a.join("mod.ini"), "[TextureOverride]\n").unwrap();
        fs::write(b.join("mod.ini"), "[TextureOverride]\n").unwrap();

        let snap = scan_workspace(&root).unwrap();
        assert_eq!(snap.mods.len(), 2);
        assert_ne!(snap.mods[0].id, snap.mods[1].id);

        let _ = fs::remove_dir_all(&root);
    }
}
