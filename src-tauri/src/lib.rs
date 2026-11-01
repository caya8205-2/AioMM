pub mod ini;
pub mod preset;
pub mod scanner;
pub mod tools;

use ini::DryRunDto;
use preset::Preset;
use scanner::{DetectedFolder, WorkspaceSnapshot};
use std::path::Path;
use std::process::Command;

#[tauri::command]
fn detect_known_mod_folders() -> Vec<DetectedFolder> {
    scanner::detect_xxmi_folders()
}

#[tauri::command]
fn scan_mods_folder(root: String) -> Result<WorkspaceSnapshot, String> {
    scanner::scan_workspace(Path::new(&root))
}

#[tauri::command]
fn toggle_mod(mod_path: String) -> Result<String, String> {
    scanner::toggle_mod_folder(Path::new(&mod_path))
}

#[tauri::command]
fn preview_preset(
    ini_path: String,
    mods_root: String,
    preset_id: String,
) -> Result<DryRunDto, String> {
    let target_preset = preset::find_preset(Path::new(&mods_root), &preset_id)?;
    ini::preview_preset_file(Path::new(&ini_path), &target_preset)
}

#[tauri::command]
fn apply_preset(
    ini_path: String,
    mods_root: String,
    preset_id: String,
) -> Result<DryRunDto, String> {
    let target_preset = preset::find_preset(Path::new(&mods_root), &preset_id)?;
    ini::apply_preset_file(Path::new(&ini_path), &target_preset)
}

#[tauri::command]
fn restore_ini_backup(ini_path: String) -> Result<(), String> {
    ini::restore_backup(Path::new(&ini_path))
}

#[tauri::command]
fn update_keybind(ini_path: String, line_idx: usize, new_key: String) -> Result<(), String> {
    ini::update_keybind_in_file(Path::new(&ini_path), line_idx, &new_key)
}

#[tauri::command]
fn save_preset(mods_root: String, preset: Preset) -> Result<Vec<Preset>, String> {
    preset::save_custom_preset(Path::new(&mods_root), preset)
}

#[tauri::command]
fn delete_preset(mods_root: String, preset_id: String) -> Result<Vec<Preset>, String> {
    preset::delete_custom_preset(Path::new(&mods_root), &preset_id)
}

#[tauri::command]
fn analyze_rabbitfx(ini_path: String) -> Result<ini::RabbitFxAnalysisDto, String> {
    ini::analyze_rabbitfx_file(Path::new(&ini_path))
}

#[tauri::command]
fn apply_rabbitfx(request: ini::RabbitFxApplyRequest) -> Result<DryRunDto, String> {
    ini::apply_rabbitfx_to_file(request)
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    // Windows explorer treats forward slashes as switch flags and falls back to Documents.
    let win_path = path.replace('/', "\\");
    let target = Path::new(&win_path);
    if !target.exists() {
        return Err(format!("Path does not exist: {win_path}"));
    }

    let mut cmd = Command::new("explorer");
    if target.is_file() {
        cmd.arg(format!("/select,{win_path}"));
    } else {
        cmd.arg(&win_path);
    }
    cmd.spawn()
        .map_err(|e| format!("Failed to launch Explorer: {e}"))?;
    Ok(())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !trimmed.starts_with("https://") && !trimmed.starts_with("http://") {
        return Err("Only http:// and https:// URLs are allowed.".into());
    }
    Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", trimmed])
        .spawn()
        .map_err(|e| format!("Failed to open browser: {e}"))?;
    Ok(())
}

#[tauri::command]
fn scan_unused_assets(mod_path: String) -> Result<tools::ModCleanScanDto, String> {
    tools::scan_unused_assets_in_mod(Path::new(&mod_path))
}

#[tauri::command]
fn delete_unused_assets(file_paths: Vec<String>) -> Result<u64, String> {
    tools::delete_files_batch(&file_paths)
}

#[tauri::command]
fn package_mod(
    mod_path: String,
    output_dir: Option<String>,
    include_backups: bool,
) -> Result<String, String> {
    tools::package_mod_zip(
        Path::new(&mod_path),
        output_dir.as_deref().map(Path::new),
        include_backups,
    )
}

#[tauri::command]
fn install_mod_zip(zip_path: String, mods_root: String) -> Result<String, String> {
    tools::install_mod_from_zip(Path::new(&zip_path), Path::new(&mods_root))
}

#[tauri::command]
fn batch_toggle_mods(mods_root: String, enable_all: bool) -> Result<usize, String> {
    scanner::batch_toggle_all(Path::new(&mods_root), enable_all)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            detect_known_mod_folders,
            scan_mods_folder,
            toggle_mod,
            preview_preset,
            apply_preset,
            restore_ini_backup,
            update_keybind,
            save_preset,
            delete_preset,
            analyze_rabbitfx,
            apply_rabbitfx,
            reveal_in_explorer,
            open_external_url,
            scan_unused_assets,
            delete_unused_assets,
            package_mod,
            install_mod_zip,
            batch_toggle_mods,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AIOMM tauri application");
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use crate::preset::AnchorInsert;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("aiomm_ipc_{tag}_{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn full_ipc_workflow_scan_preview_apply_keybind_preset_and_restore() {
        let root = temp_dir("e2e");
        let root_str = root.to_string_lossy().to_string();

        let mod_a = root.join("Miyabi_Coat");
        fs::create_dir_all(&mod_a).unwrap();
        let ini_a = mod_a.join("merged.ini");
        let ini_a_orig = "[KeySwapCoat]\r\nkey = no_ctrl no_alt VK_UP\r\n$swap = 0,1\r\n\r\n[KeySwapHair]\r\nkey = VK_UP\r\n$hair = 0,1\r\n\r\n[TextureOverrideComponent0]\r\nhash = 111\r\nrun = CommandListOverrideSharedResources\r\nrun = CommandListCleanupSharedResources\r\n\r\n[TextureOverrideComponent3]\r\nhash = 333\r\n\trun = CommandListOverrideSharedResources\r\n\trun = CommandListCleanupSharedResources\r\n";
        fs::write(&ini_a, ini_a_orig).unwrap();

        let mod_b = root.join("Yanagi_Glasses");
        fs::create_dir_all(&mod_b).unwrap();
        let ini_b = mod_b.join("Yanagi.ini");
        fs::write(&ini_b, "[KeyGlasses]\nkey = VK_UP\n$g = 0,1\n").unwrap();

        let snap1 = scan_mods_folder(root_str.clone()).unwrap();
        assert_eq!(snap1.mods.len(), 2);
        assert_eq!(snap1.conflicts.len(), 1);
        assert_eq!(snap1.conflicts[0].mod_id, "Miyabi_Coat");
        assert_eq!(snap1.conflicts[0].normalized_key, "up");
        assert_eq!(snap1.conflicts[0].entries.len(), 2);

        let ini_a_str = ini_a.to_string_lossy().to_string();
        let dry =
            preview_preset(ini_a_str.clone(), root_str.clone(), "oilskin-3plus".into()).unwrap();
        assert_eq!(dry.injected_lines, 2);
        assert_eq!(dry.touched_sections, 1);
        assert!(!dry.has_backup);

        let app3 =
            apply_preset(ini_a_str.clone(), root_str.clone(), "oilskin-3plus".into()).unwrap();
        assert_eq!(app3.injected_lines, 2);
        assert!(app3.has_backup);

        let snap2 = scan_mods_folder(root_str.clone()).unwrap();
        let miyabi = snap2.mods.iter().find(|m| m.id == "Miyabi_Coat").unwrap();
        assert_eq!(miyabi.applied_preset_ids, vec!["oilskin-3plus".to_string()]);
        assert!(miyabi.has_any_backup);

        let app_all =
            apply_preset(ini_a_str.clone(), root_str.clone(), "oilskin-all".into()).unwrap();
        assert_eq!(app_all.injected_lines, 2);
        assert_eq!(app_all.already_applied_lines, 2);

        let kb_line = miyabi.keybinds[1].key_line_idx;
        update_keybind(
            ini_a_str.clone(),
            kb_line,
            "no_ctrl no_alt VK_F9".into(),
        )
        .unwrap();

        let snap3 = scan_mods_folder(root_str.clone()).unwrap();
        assert!(snap3.conflicts.is_empty());

        let saved_list = save_preset(
            root_str.clone(),
            Preset {
                id: "custom-fx".into(),
                name: "Custom Shader FX".into(),
                description: "Test custom preset".into(),
                group: Some("Custom".into()),
                source_url: Some("https://gamebanana.com/mods/733773".into()),
                recommended: false,
                section_prefix: "TextureOverride".into(),
                min_component: Some(3),
                builtin: false,
                insert_after: vec![AnchorInsert {
                    anchor: "hash = 333".into(),
                    inject: "handling = skip".into(),
                }],
                insert_before: vec![],
            },
        )
        .unwrap();
        assert_eq!(saved_list.len(), 5);
        let after_del = delete_preset(root_str.clone(), "custom-fx".into()).unwrap();
        assert_eq!(after_del.len(), 4);

        restore_ini_backup(ini_a_str.clone()).unwrap();
        assert_eq!(fs::read_to_string(&ini_a).unwrap(), ini_a_orig);

        let toggled = toggle_mod(mod_a.to_string_lossy().to_string()).unwrap();
        assert!(toggled.ends_with("DISABLED_Miyabi_Coat"));
        let snap4 = scan_mods_folder(root_str).unwrap();
        let json = serde_json::to_value(&snap4).unwrap();
        assert!(json["mods"][0].get("displayName").is_some());
        assert!(json["mods"][0].get("iniFiles").is_some());
        assert!(json["mods"][0].get("appliedPresetIds").is_some());
        assert!(json["mods"][0].get("hasAnyBackup").is_some());

        let _ = fs::remove_dir_all(&root);
    }
}
