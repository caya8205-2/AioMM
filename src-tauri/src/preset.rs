use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

pub const CUSTOM_PRESETS_FILENAME: &str = "modctl.presets.toml";
const DEFAULT_PRESETS_TOML: &str = include_str!("../presets.default.toml");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnchorInsert {
    pub anchor: String,
    pub inject: String,
}

// Keep scalar fields before Vec<AnchorInsert> so toml::to_string_pretty never hits ValueAfterTable.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default, alias = "source_url")]
    pub source_url: Option<String>,
    #[serde(default)]
    pub recommended: bool,
    #[serde(alias = "section_prefix")]
    pub section_prefix: String,
    #[serde(default, alias = "min_component")]
    pub min_component: Option<u32>,
    #[serde(default)]
    pub builtin: bool,
    #[serde(default, alias = "insert_after")]
    pub insert_after: Vec<AnchorInsert>,
    #[serde(default, alias = "insert_before")]
    pub insert_before: Vec<AnchorInsert>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct PresetFile {
    #[serde(default)]
    presets: Vec<Preset>,
}

pub fn builtin_presets() -> Vec<Preset> {
    let parsed: PresetFile =
        toml::from_str(DEFAULT_PRESETS_TOML).expect("valid embedded presets.default.toml");
    parsed
        .presets
        .into_iter()
        .map(|mut p| {
            p.builtin = true;
            p
        })
        .collect()
}

fn read_custom_presets(mods_root: &Path) -> Result<Vec<Preset>, String> {
    let file_path = mods_root.join(CUSTOM_PRESETS_FILENAME);
    if !file_path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read {}: {e}", file_path.display()))?;
    let body = raw.strip_prefix('\u{feff}').unwrap_or(&raw);
    if body.trim().is_empty() {
        return Ok(Vec::new());
    }
    let parsed: PresetFile = toml::from_str(body)
        .map_err(|e| format!("Invalid TOML in {}: {e}", file_path.display()))?;
    Ok(parsed
        .presets
        .into_iter()
        .map(|mut p| {
            p.builtin = false;
            p
        })
        .collect())
}

pub fn load_presets(mods_root: Option<&Path>) -> Result<Vec<Preset>, String> {
    let mut all = builtin_presets();
    if let Some(root) = mods_root {
        let custom = read_custom_presets(root)?;
        for preset in custom {
            if all.iter().any(|b| b.builtin && b.id == preset.id) {
                continue;
            }
            if let Some(existing) = all.iter_mut().find(|p| p.id == preset.id) {
                *existing = preset;
            } else {
                all.push(preset);
            }
        }
    }
    Ok(all)
}

pub fn find_preset(mods_root: &Path, preset_id: &str) -> Result<Preset, String> {
    let presets = load_presets(Some(mods_root))?;
    presets
        .into_iter()
        .find(|p| p.id == preset_id)
        .ok_or_else(|| format!("Preset '{preset_id}' not found"))
}

pub fn save_custom_preset(mods_root: &Path, mut preset: Preset) -> Result<Vec<Preset>, String> {
    if !mods_root.is_dir() {
        return Err(format!(
            "Mods directory does not exist: {}",
            mods_root.display()
        ));
    }

    preset.id = preset.id.trim().to_string();
    preset.name = preset.name.trim().to_string();
    preset.description = preset.description.trim().to_string();
    preset.section_prefix = preset.section_prefix.trim().to_string();
    preset.group = preset
        .group
        .map(|g| g.trim().to_string())
        .filter(|g| !g.is_empty());
    preset.source_url = preset
        .source_url
        .map(|u| u.trim().to_string())
        .filter(|u| !u.is_empty());
    if let Some(ref url) = preset.source_url {
        if !url.starts_with("https://") && !url.starts_with("http://") {
            return Err("Mod page URL must start with https:// or http://.".into());
        }
    }
    preset.insert_after = preset
        .insert_after
        .into_iter()
        .map(|r| AnchorInsert {
            anchor: r.anchor.trim().to_string(),
            inject: r.inject.trim().to_string(),
        })
        .filter(|r| !r.anchor.is_empty() && !r.inject.is_empty())
        .collect();
    preset.insert_before = preset
        .insert_before
        .into_iter()
        .map(|r| AnchorInsert {
            anchor: r.anchor.trim().to_string(),
            inject: r.inject.trim().to_string(),
        })
        .filter(|r| !r.anchor.is_empty() && !r.inject.is_empty())
        .collect();

    if preset.id.is_empty() {
        return Err("Preset ID cannot be empty.".into());
    }
    if preset.name.is_empty() {
        return Err("Preset name cannot be empty.".into());
    }
    if preset.section_prefix.is_empty() {
        return Err("Section prefix cannot be empty.".into());
    }
    if preset.insert_after.is_empty() && preset.insert_before.is_empty() {
        return Err("Preset must define at least one insert rule.".into());
    }
    if builtin_presets().iter().any(|b| b.id == preset.id) {
        return Err(format!("Cannot overwrite built-in preset '{}'.", preset.id));
    }

    preset.builtin = false;

    let mut custom = read_custom_presets(mods_root)?;
    if let Some(existing) = custom.iter_mut().find(|p| p.id == preset.id) {
        *existing = preset;
    } else {
        custom.push(preset);
    }

    let file_path = mods_root.join(CUSTOM_PRESETS_FILENAME);
    let serialized = toml::to_string_pretty(&PresetFile { presets: custom })
        .map_err(|e| format!("Failed to serialize custom presets: {e}"))?;
    fs::write(&file_path, serialized)
        .map_err(|e| format!("Failed to write {}: {e}", file_path.display()))?;

    load_presets(Some(mods_root))
}

pub fn delete_custom_preset(mods_root: &Path, preset_id: &str) -> Result<Vec<Preset>, String> {
    if builtin_presets().iter().any(|b| b.id == preset_id) {
        return Err(format!("Cannot delete built-in preset '{preset_id}'."));
    }

    let file_path = mods_root.join(CUSTOM_PRESETS_FILENAME);
    if file_path.exists() {
        let mut custom = read_custom_presets(mods_root)?;
        custom.retain(|p| p.id != preset_id);
        if custom.is_empty() {
            fs::remove_file(&file_path)
                .map_err(|e| format!("Failed to remove {}: {e}", file_path.display()))?;
        } else {
            let serialized = toml::to_string_pretty(&PresetFile { presets: custom })
                .map_err(|e| format!("Failed to serialize custom presets: {e}"))?;
            fs::write(&file_path, serialized)
                .map_err(|e| format!("Failed to write {}: {e}", file_path.display()))?;
        }
    }

    load_presets(Some(mods_root))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("modctl_preset_{tag}_{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn loads_embedded_oilskin_builtins() {
        let list = load_presets(None).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "oilskin-3plus");
        assert!(list[0].builtin);
        assert!(list[0].recommended);
        assert_eq!(
            list[0].source_url.as_deref(),
            Some("https://gamebanana.com/mods/733773")
        );
        assert_eq!(list[0].min_component, Some(3));
        assert_eq!(list[1].id, "oilskin-all");
        assert!(list[1].builtin);
        assert_eq!(
            list[1].source_url.as_deref(),
            Some("https://gamebanana.com/mods/733773")
        );
        assert_eq!(list[1].min_component, Some(0));
    }

    #[test]
    fn saves_updates_and_deletes_custom_presets_including_optional_fields() {
        let dir = temp_dir("crud");
        let custom_none = Preset {
            id: "orfix-any".into(),
            name: "ORFix All Sections".into(),
            description: "Injects ORFix applier into TextureOverride sections.".into(),
            group: None,
            source_url: Some("https://gamebanana.com/mods/733773".into()),
            recommended: false,
            section_prefix: "TextureOverride".into(),
            min_component: None,
            builtin: true,
            insert_after: vec![AnchorInsert {
                anchor: "ps-t0 = ResourceDiffuse".into(),
                inject: r"run = CommandList\global\ORFix\ORFix".into(),
            }],
            insert_before: vec![],
        };

        let after_save = save_custom_preset(&dir, custom_none).unwrap();
        assert_eq!(after_save.len(), 3);
        let saved = after_save.iter().find(|p| p.id == "orfix-any").unwrap();
        assert!(!saved.builtin);
        assert_eq!(saved.min_component, None);
        assert_eq!(saved.group, None);
        assert_eq!(
            saved.source_url.as_deref(),
            Some("https://gamebanana.com/mods/733773")
        );

        let updated = Preset {
            name: "ORFix Component 1+".into(),
            group: Some("ORFix".into()),
            min_component: Some(1),
            ..saved.clone()
        };
        let after_update = save_custom_preset(&dir, updated).unwrap();
        assert_eq!(after_update.len(), 3);
        let reloaded = after_update.iter().find(|p| p.id == "orfix-any").unwrap();
        assert_eq!(reloaded.name, "ORFix Component 1+");
        assert_eq!(reloaded.min_component, Some(1));
        assert_eq!(reloaded.group.as_deref(), Some("ORFix"));

        assert!(save_custom_preset(
            &dir,
            Preset {
                id: "oilskin-3plus".into(),
                ..reloaded.clone()
            }
        )
        .is_err());
        assert!(delete_custom_preset(&dir, "oilskin-3plus").is_err());

        let after_del = delete_custom_preset(&dir, "orfix-any").unwrap();
        assert_eq!(after_del.len(), 2);
        assert!(!dir.join(CUSTOM_PRESETS_FILENAME).exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn preset_json_uses_exact_typescript_camel_case_keys() {
        let p = &builtin_presets()[0];
        let json = serde_json::to_value(p).unwrap();
        assert!(json.get("sourceUrl").is_some());
        assert!(json.get("sectionPrefix").is_some());
        assert!(json.get("minComponent").is_some());
        assert!(json.get("insertAfter").is_some());
        assert!(json.get("insertBefore").is_some());
        assert!(json.get("builtin").is_some());
    }
}
