use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnusedAssetInfo {
    pub rel_path: String,
    pub abs_path: String,
    pub file_size_bytes: u64,
    pub extension: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModCleanScanDto {
    pub mod_name: String,
    pub total_scanned_files: usize,
    pub unused_assets: Vec<UnusedAssetInfo>,
    pub reclaimable_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModUnusedGroupDto {
    pub mod_name: String,
    pub mod_path: String,
    pub total_scanned_files: usize,
    pub reclaimable_bytes: u64,
    pub unused_assets: Vec<UnusedAssetInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AllModsCleanScanDto {
    pub root_path: String,
    pub total_mods_scanned: usize,
    pub mods_with_unused: Vec<ModUnusedGroupDto>,
    pub total_unused_files: usize,
    pub total_reclaimable_bytes: u64,
}

fn normalize_slash(p: &str) -> String {
    p.replace('\\', "/").to_lowercase()
}

fn is_preview_image(name_lower: &str) -> bool {
    let stem = name_lower.split('.').next().unwrap_or(name_lower);
    matches!(stem, "preview" | "thumbnail" | "cover" | "icon")
}

pub fn scan_unused_assets_in_mod(mod_dir: &Path) -> Result<ModCleanScanDto, String> {
    if !mod_dir.is_dir() {
        return Err(format!("'{}' is not a directory.", mod_dir.display()));
    }

    let mod_name = mod_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Mod")
        .to_string();

    let mut referenced: HashSet<String> = HashSet::new();
    let mut all_files: Vec<(PathBuf, String, u64)> = Vec::new();

    fn walk_dir(
        root: &Path,
        current: &Path,
        referenced: &mut HashSet<String>,
        all_files: &mut Vec<(PathBuf, String, u64)>,
    ) {
        let entries = match fs::read_dir(current) {
            Ok(e) => e,
            Err(_) => return,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                walk_dir(root, &path, referenced, all_files);
            } else if path.is_file() {
                let rel = path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .to_string();
                let meta = fs::metadata(&path).ok();
                let size = meta.map(|m| m.len()).unwrap_or(0);
                all_files.push((path.clone(), rel.clone(), size));

                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();

                if ext == "ini" {
                    if let Ok(content) = fs::read_to_string(&path) {
                        for line in content.lines() {
                            let trimmed = line.trim();
                            if trimmed.starts_with(';') {
                                continue;
                            }
                            if let Some((lhs, rhs)) = trimmed.split_once('=') {
                                if lhs.trim().eq_ignore_ascii_case("filename") {
                                    let clean_fn = rhs.trim().trim_matches('"').trim_matches('\'');
                                    let norm = normalize_slash(clean_fn);
                                    if let Some(fn_only) = norm.split('/').last() {
                                        referenced.insert(fn_only.to_string());
                                    }
                                    referenced.insert(norm);
                                }
                            }
                            // Also scan for any explicit token that points to asset extensions
                            for token in trimmed.split(|c: char| c.is_whitespace() || c == ',' || c == '"' || c == '\'') {
                                let t_norm = normalize_slash(token);
                                if t_norm.ends_with(".dds")
                                    || t_norm.ends_with(".png")
                                    || t_norm.ends_with(".jpg")
                                    || t_norm.ends_with(".jpeg")
                                    || t_norm.ends_with(".tga")
                                    || t_norm.ends_with(".ib")
                                    || t_norm.ends_with(".vb")
                                    || t_norm.ends_with(".buf")
                                    || t_norm.ends_with(".hlsl")
                                    || t_norm.ends_with(".fx")
                                {
                                    if let Some(fn_only) = t_norm.split('/').last() {
                                        referenced.insert(fn_only.to_string());
                                    }
                                    referenced.insert(t_norm);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    walk_dir(mod_dir, mod_dir, &mut referenced, &mut all_files);

    let mut unused_assets = Vec::new();
    let mut reclaimable_bytes = 0u64;

    for (abs, rel, size) in all_files.iter() {
        let file_name = abs
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_lowercase();

        let ext = abs
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        // Never mark preview images, config ini files, backups, or quarantined files as unused
        if ext == "ini"
            || file_name.ends_with(".bak")
            || file_name.ends_with(".aiomm_unused")
            || is_preview_image(&file_name)
        {
            continue;
        }

        let rel_norm = normalize_slash(rel);
        let is_ref = referenced.contains(&file_name) || referenced.contains(&rel_norm);

        if !is_ref {
            unused_assets.push(UnusedAssetInfo {
                rel_path: rel.clone(),
                abs_path: abs.to_string_lossy().to_string(),
                file_size_bytes: *size,
                extension: ext,
            });
            reclaimable_bytes += *size;
        }
    }

    Ok(ModCleanScanDto {
        mod_name,
        total_scanned_files: all_files.len(),
        unused_assets,
        reclaimable_bytes,
    })
}

pub fn scan_all_unused_assets_in_root(root: &Path) -> Result<AllModsCleanScanDto, String> {
    if !root.is_dir() {
        return Err(format!("'{}' is not a directory.", root.display()));
    }

    let mut mod_dirs = Vec::new();
    crate::scanner::collect_mod_dirs(root, 0, &mut mod_dirs);
    if mod_dirs.is_empty() && crate::scanner::has_direct_ini(root) {
        mod_dirs.push(root.to_path_buf());
    }

    let mut mods_with_unused = Vec::new();
    let mut total_unused_files = 0;
    let mut total_reclaimable_bytes = 0u64;

    for dir in &mod_dirs {
        if let Ok(scan) = scan_unused_assets_in_mod(dir) {
            if !scan.unused_assets.is_empty() {
                total_unused_files += scan.unused_assets.len();
                total_reclaimable_bytes += scan.reclaimable_bytes;
                mods_with_unused.push(ModUnusedGroupDto {
                    mod_name: scan.mod_name,
                    mod_path: dir.to_string_lossy().to_string(),
                    total_scanned_files: scan.total_scanned_files,
                    reclaimable_bytes: scan.reclaimable_bytes,
                    unused_assets: scan.unused_assets,
                });
            }
        }
    }

    Ok(AllModsCleanScanDto {
        root_path: root.to_string_lossy().to_string(),
        total_mods_scanned: mod_dirs.len(),
        mods_with_unused,
        total_unused_files,
        total_reclaimable_bytes,
    })
}

pub fn delete_files_batch(file_paths: &[String]) -> Result<u64, String> {
    let mut freed_bytes = 0u64;
    for fp in file_paths {
        let p = Path::new(fp);
        if p.is_file() {
            if let Ok(meta) = fs::metadata(p) {
                freed_bytes += meta.len();
            }
            fs::remove_file(p).map_err(|e| format!("Failed to delete '{}': {e}", p.display()))?;
        }
    }
    Ok(freed_bytes)
}

pub fn quarantine_files_batch(file_paths: &[String]) -> Result<usize, String> {
    let mut count = 0;
    for fp in file_paths {
        let p = Path::new(fp);
        if p.is_file() {
            let target_str = format!("{}.aiomm_unused", fp);
            let target = Path::new(&target_str);
            fs::rename(p, target).map_err(|e| format!("Failed to quarantine '{}': {e}", p.display()))?;
            count += 1;
        }
    }
    Ok(count)
}

pub fn restore_quarantined_files_batch(file_paths: &[String]) -> Result<usize, String> {
    let mut count = 0;
    for fp in file_paths {
        let p = Path::new(fp);
        if p.is_file() {
            let filename = p.file_name().unwrap_or_default().to_string_lossy();
            if filename.ends_with(".aiomm_unused") {
                let target_name = filename.trim_end_matches(".aiomm_unused");
                let target = p.with_file_name(target_name);
                fs::rename(p, target).map_err(|e| format!("Failed to restore '{}': {e}", p.display()))?;
                count += 1;
            }
        }
    }
    Ok(count)
}

pub fn restore_quarantined_files(root: &Path) -> Result<usize, String> {
    if !root.is_dir() {
        return Err(format!("'{}' is not a directory.", root.display()));
    }
    let mut count = 0;

    fn walk_restore(dir: &Path, count: &mut usize) -> std::io::Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                walk_restore(&path, count)?;
            } else if path.is_file() {
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                if name.ends_with(".aiomm_unused") {
                    let new_name = name.trim_end_matches(".aiomm_unused");
                    let target = path.with_file_name(new_name);
                    fs::rename(&path, target)?;
                    *count += 1;
                }
            }
        }
        Ok(())
    }

    walk_restore(root, &mut count).map_err(|e| format!("Failed to restore quarantined files: {e}"))?;
    Ok(count)
}

pub fn purge_quarantined_files(root: &Path) -> Result<u64, String> {
    if !root.is_dir() {
        return Err(format!("'{}' is not a directory.", root.display()));
    }
    let mut freed_bytes = 0u64;

    fn walk_purge(dir: &Path, freed: &mut u64) -> std::io::Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                walk_purge(&path, freed)?;
            } else if path.is_file() {
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                if name.ends_with(".aiomm_unused") {
                    if let Ok(meta) = fs::metadata(&path) {
                        *freed += meta.len();
                    }
                    fs::remove_file(&path)?;
                }
            }
        }
        Ok(())
    }

    walk_purge(root, &mut freed_bytes).map_err(|e| format!("Failed to purge quarantined files: {e}"))?;
    Ok(freed_bytes)
}

pub fn scan_quarantined_files(root: &Path) -> Result<Vec<UnusedAssetInfo>, String> {
    if !root.is_dir() {
        return Err(format!("'{}' is not a directory.", root.display()));
    }
    let mut quarantined = Vec::new();

    fn walk_scan(root: &Path, current: &Path, out: &mut Vec<UnusedAssetInfo>) {
        let Ok(entries) = fs::read_dir(current) else { return; };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.starts_with('.') {
                    walk_scan(root, &path, out);
                }
            } else if path.is_file() {
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                if name.ends_with(".aiomm_unused") {
                    let rel = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().to_string();
                    let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                    let orig_name = name.trim_end_matches(".aiomm_unused");
                    let ext = Path::new(orig_name)
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("")
                        .to_lowercase();
                    out.push(UnusedAssetInfo {
                        rel_path: rel,
                        abs_path: path.to_string_lossy().to_string(),
                        file_size_bytes: size,
                        extension: ext,
                    });
                }
            }
        }
    }

    walk_scan(root, root, &mut quarantined);
    Ok(quarantined)
}

pub fn package_mod_zip(
    mod_path: &Path,
    output_dir: Option<&Path>,
    include_backups: bool,
) -> Result<String, String> {
    if !mod_path.is_dir() {
        return Err(format!("'{}' is not a valid directory.", mod_path.display()));
    }

    let mod_name = mod_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Mod");

    let clean_mod_name = mod_name
        .trim_start_matches("DISABLED_")
        .replace(['\\', '/', ':', '*', '?', '"', '<', '>', '|'], "_");

    let out_dir = match output_dir {
        Some(d) if d.is_dir() => d.to_path_buf(),
        _ => dirs::desktop_dir()
            .or_else(dirs::download_dir)
            .unwrap_or_else(|| mod_path.parent().unwrap_or(mod_path).to_path_buf()),
    };

    let zip_filename = format!("{clean_mod_name}.zip");
    let target_zip = out_dir.join(&zip_filename);

    if target_zip.exists() {
        let _ = fs::remove_file(&target_zip);
    }

    if include_backups {
        let ps_cmd = format!(
            "Compress-Archive -Path '{}' -DestinationPath '{}' -Force",
            mod_path.display(),
            target_zip.display()
        );

        let status = Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps_cmd])
            .status()
            .map_err(|e| format!("Failed to run PowerShell Compress-Archive: {e}"))?;

        if !status.success() {
            return Err("PowerShell failed to create zip archive.".into());
        }
    } else {
        // Create clean temp archive omitting backup files
        let temp_dir = std::env::temp_dir().join(format!("aiomm_pkg_{clean_mod_name}"));
        if temp_dir.exists() {
            let _ = fs::remove_dir_all(&temp_dir);
        }
        fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to create temporary packaging folder: {e}"))?;

        let sub_folder = temp_dir.join(&clean_mod_name);
        fs::create_dir_all(&sub_folder)
            .map_err(|e| format!("Failed to create subfolder in temp dir: {e}"))?;

        fn copy_clean(src: &Path, dst: &Path) -> std::io::Result<()> {
            for entry in fs::read_dir(src)? {
                let entry = entry?;
                let path = entry.path();
                let file_name = entry.file_name().to_string_lossy().to_string();
                if file_name.ends_with(".bak") || file_name.starts_with('.') {
                    continue;
                }
                let target = dst.join(&file_name);
                if path.is_dir() {
                    fs::create_dir_all(&target)?;
                    copy_clean(&path, &target)?;
                } else if path.is_file() {
                    fs::copy(&path, &target)?;
                }
            }
            Ok(())
        }

        if let Err(e) = copy_clean(mod_path, &sub_folder) {
            let _ = fs::remove_dir_all(&temp_dir);
            return Err(format!("Failed to copy clean mod files: {e}"));
        }

        let ps_cmd = format!(
            "Compress-Archive -Path '{}' -DestinationPath '{}' -Force",
            sub_folder.display(),
            target_zip.display()
        );

        let status = Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps_cmd])
            .status()
            .map_err(|e| format!("Failed to run PowerShell Compress-Archive: {e}"))?;

        let _ = fs::remove_dir_all(&temp_dir);

        if !status.success() {
            return Err("PowerShell failed to create zip archive.".into());
        }
    }

    if !target_zip.exists() {
        return Err("Zip archive was not produced.".into());
    }

    Ok(target_zip.to_string_lossy().to_string())
}

pub fn install_mod_from_zip(zip_path: &Path, mods_root: &Path) -> Result<String, String> {
    if !zip_path.is_file() {
        return Err(format!("'{}' is not a valid file.", zip_path.display()));
    }
    if !mods_root.is_dir() {
        return Err(format!("'{}' is not a valid directory.", mods_root.display()));
    }

    let zip_stem = zip_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Installed_Mod")
        .replace(['\\', '/', ':', '*', '?', '"', '<', '>', '|'], "_");

    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let temp_extract = std::env::temp_dir().join(format!("aiomm_unpack_{zip_stem}_{millis}"));
    if temp_extract.exists() {
        let _ = fs::remove_dir_all(&temp_extract);
    }
    fs::create_dir_all(&temp_extract)
        .map_err(|e| format!("Failed to create extract folder: {e}"))?;

    let ps_cmd = format!(
        "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
        zip_path.display(),
        temp_extract.display()
    );

    let status = Command::new("powershell")
        .args(["-NoProfile", "-Command", &ps_cmd])
        .status()
        .map_err(|e| {
            let _ = fs::remove_dir_all(&temp_extract);
            format!("Failed to run PowerShell Expand-Archive: {e}")
        })?;

    if !status.success() {
        let _ = fs::remove_dir_all(&temp_extract);
        return Err("Failed to extract zip archive.".into());
    }

    fn find_ini_files(dir: &Path, out: &mut Vec<PathBuf>) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    find_ini_files(&p, out);
                } else if p.is_file() && p.extension().is_some_and(|e| e.eq_ignore_ascii_case("ini")) {
                    out.push(p);
                }
            }
        }
    }

    let mut inis = Vec::new();
    find_ini_files(&temp_extract, &mut inis);
    if inis.is_empty() {
        let _ = fs::remove_dir_all(&temp_extract);
        return Err("No .ini mod files found inside this zip archive.".into());
    }

    let top_entries: Vec<PathBuf> = fs::read_dir(&temp_extract)
        .map(|entries| entries.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();

    let target_folder_name = if top_entries.len() == 1 && top_entries[0].is_dir() {
        top_entries[0]
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&zip_stem)
            .to_string()
    } else {
        zip_stem.clone()
    };

    let mut unique_target = mods_root.join(&target_folder_name);
    let mut counter = 1;
    while unique_target.exists() {
        unique_target = mods_root.join(format!("{target_folder_name} ({counter})"));
        counter += 1;
    }

    fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let path = entry.path();
            let target = dst.join(entry.file_name());
            if path.is_dir() {
                copy_recursive(&path, &target)?;
            } else if path.is_file() {
                fs::copy(&path, &target)?;
            }
        }
        Ok(())
    }

    let source_dir_to_move = if top_entries.len() == 1 && top_entries[0].is_dir() {
        &top_entries[0]
    } else {
        &temp_extract
    };

    if let Err(e) = copy_recursive(source_dir_to_move, &unique_target) {
        let _ = fs::remove_dir_all(&temp_extract);
        return Err(format!("Failed to install mod files: {e}"));
    }

    let _ = fs::remove_dir_all(&temp_extract);
    Ok(unique_target.to_string_lossy().to_string())
}

pub fn validate_file_or_folder_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Name cannot be empty".to_string());
    }
    let forbidden = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    if trimmed.chars().any(|c| forbidden.contains(&c) || (c as u32) < 32) {
        return Err("Name contains invalid characters (< > : \" / \\ | ? *)".to_string());
    }
    if trimmed.ends_with('.') || trimmed.ends_with(' ') {
        return Err("Name cannot end with a period or space".to_string());
    }
    let upper = trimmed.to_uppercase();
    let reserved = [
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let stem = upper.split('.').next().unwrap_or(&upper);
    if reserved.contains(&stem) {
        return Err(format!("'{trimmed}' is a reserved Windows device name"));
    }
    Ok(trimmed.to_string())
}

pub fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), std::io::Error> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let target = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else if path.is_file() {
            fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

pub fn rename_fs_entry(target: &Path, new_name: &str) -> Result<PathBuf, String> {
    if !target.exists() {
        return Err(format!("Item not found: '{}'", target.display()));
    }
    let valid_name = validate_file_or_folder_name(new_name)?;
    let parent = target.parent().ok_or_else(|| "Cannot rename root directory".to_string())?;
    let new_path = parent.join(&valid_name);

    if new_path == target {
        return Ok(new_path);
    }

    if new_path.exists() {
        let same_file = match (target.canonicalize(), new_path.canonicalize()) {
            (Ok(a), Ok(b)) => a == b,
            _ => false,
        };
        if same_file {
            let temp_name = format!("{valid_name}_aiomm_case_tmp_{}", std::process::id());
            let temp_path = parent.join(temp_name);
            fs::rename(target, &temp_path)
                .map_err(|e| format!("Failed during case rename step 1: {e}"))?;
            fs::rename(&temp_path, &new_path)
                .map_err(|e| format!("Failed during case rename step 2: {e}"))?;
            return Ok(new_path);
        } else {
            return Err(format!("An item named '{valid_name}' already exists in this folder"));
        }
    }

    fs::rename(target, &new_path).map_err(|e| format!("Failed to rename '{}': {e}", target.display()))?;
    Ok(new_path)
}

pub fn create_subfolder(parent: &Path, folder_name: &str) -> Result<PathBuf, String> {
    if !parent.exists() {
        return Err(format!("Parent directory does not exist: '{}'", parent.display()));
    }
    if !parent.is_dir() {
        return Err(format!("Parent path is not a folder: '{}'", parent.display()));
    }
    let valid_name = validate_file_or_folder_name(folder_name)?;
    let new_folder = parent.join(&valid_name);
    if new_folder.exists() {
        return Err(format!("Folder '{valid_name}' already exists"));
    }
    fs::create_dir_all(&new_folder).map_err(|e| format!("Failed to create folder: {e}"))?;
    Ok(new_folder)
}

pub fn move_fs_entry(source: &Path, target_dir: &Path) -> Result<PathBuf, String> {
    if !source.exists() {
        return Err(format!("Source item not found: '{}'", source.display()));
    }
    if !target_dir.exists() || !target_dir.is_dir() {
        return Err(format!("Destination folder does not exist: '{}'", target_dir.display()));
    }

    if let (Ok(src_canon), Ok(target_canon)) = (source.canonicalize(), target_dir.canonicalize()) {
        if target_canon.starts_with(&src_canon) {
            return Err("Cannot move a folder into itself or its own subfolder".to_string());
        }
    }

    let file_name = source.file_name().ok_or_else(|| "Invalid source file name".to_string())?;
    let dest_path = target_dir.join(file_name);

    if dest_path == source {
        return Ok(dest_path);
    }
    if dest_path.exists() {
        return Err(format!(
            "An item named '{}' already exists in the destination folder",
            file_name.to_string_lossy()
        ));
    }

    if fs::rename(source, &dest_path).is_ok() {
        return Ok(dest_path);
    }

    if source.is_dir() {
        copy_dir_recursive(source, &dest_path)
            .map_err(|e| format!("Failed to move directory: {e}"))?;
        fs::remove_dir_all(source)
            .map_err(|e| format!("Failed to clean up source directory: {e}"))?;
    } else {
        fs::copy(source, &dest_path)
            .map_err(|e| format!("Failed to move file: {e}"))?;
        fs::remove_file(source)
            .map_err(|e| format!("Failed to clean up source file: {e}"))?;
    }

    Ok(dest_path)
}

pub fn copy_fs_entry(source: &Path, target_dir: &Path) -> Result<PathBuf, String> {
    if !source.exists() {
        return Err(format!("Source item not found: '{}'", source.display()));
    }
    if !target_dir.exists() || !target_dir.is_dir() {
        return Err(format!("Destination folder does not exist: '{}'", target_dir.display()));
    }

    if let (Ok(src_canon), Ok(target_canon)) = (source.canonicalize(), target_dir.canonicalize()) {
        if target_canon.starts_with(&src_canon) {
            return Err("Cannot copy a folder into itself or its own subfolder".to_string());
        }
    }

    let file_stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("item");
    let ext_opt = source.extension().and_then(|s| s.to_str());

    let mut dest_path = target_dir.join(source.file_name().unwrap());
    if dest_path.exists() {
        let mut counter = 1;
        loop {
            let candidate_name = if source.is_dir() || ext_opt.is_none() {
                if counter == 1 {
                    format!("{file_stem} - Copy")
                } else {
                    format!("{file_stem} - Copy ({counter})")
                }
            } else {
                let ext = ext_opt.unwrap();
                if counter == 1 {
                    format!("{file_stem} - Copy.{ext}")
                } else {
                    format!("{file_stem} - Copy ({counter}).{ext}")
                }
            };
            let candidate_path = target_dir.join(candidate_name);
            if !candidate_path.exists() {
                dest_path = candidate_path;
                break;
            }
            counter += 1;
        }
    }

    if source.is_dir() {
        copy_dir_recursive(source, &dest_path)
            .map_err(|e| format!("Failed to copy directory: {e}"))?;
    } else {
        fs::copy(source, &dest_path)
            .map_err(|e| format!("Failed to copy file: {e}"))?;
    }

    Ok(dest_path)
}

pub fn delete_fs_entry(target: &Path) -> Result<(), String> {
    if !target.exists() {
        return Err(format!("Item not found: '{}'", target.display()));
    }
    if target.is_dir() {
        fs::remove_dir_all(target)
            .map_err(|e| format!("Failed to delete directory '{}': {e}", target.display()))?;
    } else {
        fs::remove_file(target)
            .map_err(|e| format!("Failed to delete file '{}': {e}", target.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_unused_assets_and_deletes_them() {
        let temp_dir = std::env::temp_dir().join("aiomm_test_cleaner");
        if temp_dir.exists() {
            let _ = fs::remove_dir_all(&temp_dir);
        }
        fs::create_dir_all(&temp_dir).unwrap();

        let ini_content = "[ResourceBody]\nfilename = Textures/UsedBody.dds\n\n[ResourceFace]\nfilename = Textures\\UsedFace.dds\n";
        fs::write(temp_dir.join("mod.ini"), ini_content).unwrap();
        fs::write(temp_dir.join("preview.png"), "image data").unwrap();
        fs::write(temp_dir.join("orphan_raw.psd"), "500MB raw file").unwrap();
        fs::write(temp_dir.join("unreferenced.dds"), "extra texture").unwrap();

        let scan = scan_unused_assets_in_mod(&temp_dir).unwrap();
        assert_eq!(scan.total_scanned_files, 4);
        assert_eq!(scan.unused_assets.len(), 2);
        assert!(scan.unused_assets.iter().any(|u| u.rel_path.contains("orphan_raw.psd")));
        assert!(scan.unused_assets.iter().any(|u| u.rel_path.contains("unreferenced.dds")));

        let to_delete: Vec<String> = scan.unused_assets.iter().map(|u| u.abs_path.clone()).collect();
        let freed = delete_files_batch(&to_delete).unwrap();
        assert!(freed > 0);

        let scan_after = scan_unused_assets_in_mod(&temp_dir).unwrap();
        assert_eq!(scan_after.unused_assets.len(), 0);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn scans_all_unused_assets_in_root() {
        let temp_dir = std::env::temp_dir().join("aiomm_test_clean_all");
        if temp_dir.exists() {
            let _ = fs::remove_dir_all(&temp_dir);
        }
        let mod_a = temp_dir.join("ModA");
        let mod_b = temp_dir.join("ModB");
        fs::create_dir_all(&mod_a).unwrap();
        fs::create_dir_all(&mod_b).unwrap();

        fs::write(mod_a.join("mod.ini"), "[Resource]\nfilename = used.dds\n").unwrap();
        fs::write(mod_a.join("used.dds"), "data").unwrap();
        fs::write(mod_a.join("unused_a.dds"), "orphan a").unwrap();

        fs::write(mod_b.join("mod.ini"), "[Resource]\nfilename = used_b.dds\n").unwrap();
        fs::write(mod_b.join("used_b.dds"), "data").unwrap();

        let scan = scan_all_unused_assets_in_root(&temp_dir).unwrap();
        assert_eq!(scan.total_mods_scanned, 2);
        assert_eq!(scan.mods_with_unused.len(), 1);
        assert_eq!(scan.mods_with_unused[0].mod_name, "ModA");
        assert_eq!(scan.total_unused_files, 1);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn packages_mod_into_zip() {
        let temp_dir = std::env::temp_dir().join("aiomm_test_packager");
        if temp_dir.exists() {
            let _ = fs::remove_dir_all(&temp_dir);
        }
        let mod_dir = temp_dir.join("MyCharacterMod");
        fs::create_dir_all(&mod_dir).unwrap();
        fs::write(mod_dir.join("mod.ini"), "[TextureOverride]").unwrap();
        fs::write(mod_dir.join("mod.ini.aiomm.bak"), "[Original]").unwrap();

        let zip_path = package_mod_zip(&mod_dir, Some(&temp_dir), false).unwrap();
        assert!(Path::new(&zip_path).exists());
        assert!(zip_path.ends_with("MyCharacterMod.zip"));

        let install_root = temp_dir.join("TargetMods");
        fs::create_dir_all(&install_root).unwrap();

        let installed_dir = install_mod_from_zip(Path::new(&zip_path), &install_root).unwrap();
        assert!(Path::new(&installed_dir).exists());
        assert!(Path::new(&installed_dir).join("mod.ini").exists());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn file_manager_crud_workflow() {
        let temp_dir = std::env::temp_dir().join(format!("aiomm_fm_test_{}", std::process::id()));
        if temp_dir.exists() {
            let _ = fs::remove_dir_all(&temp_dir);
        }
        fs::create_dir_all(&temp_dir).unwrap();

        // 1. Validation
        assert!(validate_file_or_folder_name("").is_err());
        assert!(validate_file_or_folder_name("con").is_err());
        assert!(validate_file_or_folder_name("bad/name").is_err());
        assert_eq!(validate_file_or_folder_name("Good Name").unwrap(), "Good Name");

        // 2. Create subfolder
        let created = create_subfolder(&temp_dir, "Characters").unwrap();
        assert!(created.is_dir());

        // 3. Rename
        let renamed = rename_fs_entry(&created, "Enemies").unwrap();
        assert!(renamed.is_dir());
        assert!(!created.exists());
        assert!(renamed.exists());

        // 4. Create child item to test move
        let child_folder = create_subfolder(&renamed, "BossMod").unwrap();
        fs::write(child_folder.join("mod.ini"), "test").unwrap();

        let target_dest = create_subfolder(&temp_dir, "Archive").unwrap();
        let moved = move_fs_entry(&child_folder, &target_dest).unwrap();
        assert!(moved.exists());
        assert!(moved.join("mod.ini").exists());
        assert!(!child_folder.exists());

        // 5. Copy
        let copied = copy_fs_entry(&moved, &renamed).unwrap();
        assert!(copied.exists());
        assert!(copied.join("mod.ini").exists());
        assert!(moved.exists()); // source still intact

        // 6. Delete
        delete_fs_entry(&copied).unwrap();
        assert!(!copied.exists());

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
