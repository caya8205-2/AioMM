use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::scanner::is_ini_file;
use crate::tools::move_fs_entry;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeProposal {
    pub mod_id: String,
    pub mod_name: String,
    pub current_path: String,
    pub current_rel_path: String,
    pub target_folder_rel: String,     // e.g. "Characters/Acheron"
    pub target_dir_abs: String,        // e.g. "C:\...\Mods\Characters\Acheron"
    pub suggested_full_rel: String,    // e.g. "Characters/Acheron/acheron_mod"
    pub category: String,              // "Characters", "Enemy", "NPC", "Others", "Unknown"
    pub character_name: Option<String>,
    pub confidence: u32,               // 0 - 100
    pub match_reason: String,
    pub is_already_organized: bool,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeScanDto {
    pub root_path: String,
    pub total_mods: usize,
    pub unorganized_count: usize,
    pub already_organized_count: usize,
    pub proposals: Vec<OrganizeProposal>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeMoveRequest {
    pub source_path: String,
    pub target_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeResultDto {
    pub moved_count: usize,
    pub failed_count: usize,
    pub errors: Vec<String>,
}

// Built-in WWMI object_guid signature mappings (extracted from real game mods)
const WWMI_GUID_MAP: &[(&str, &str)] = &[
    ("10032", "Augusta"),
    ("117876", "Zani"),
    ("120099", "Yangyang"),
    ("120393", "Danjin"),
    ("127017", "Encore"),
    ("128367", "Jianxin"),
    ("135258", "Taoqi"),
    ("137760", "Zani"),
    ("141879", "Chixia"),
    ("145266", "Rusak"),
    ("153393", "Baizhi"),
    ("160992", "Zani"),
    ("162915", "Lucy"),
    ("169449", "Jinhsi"),
    ("170961", "Camellya"),
    ("172782", "Youhu"),
    ("174225", "Rover F"),
    ("174510", "Rusak"),
    ("175455", "Sanhua"),
    ("196860", "Phoebe"),
    ("197598", "Yinlin"),
    ("211575", "Cartethyia"),
    ("213486", "Buling"),
    ("216714", "Rusak"),
    ("221175", "Lupa"),
    ("226359", "Lucilla"),
    ("243021", "Rusak"),
    ("250749", "Rusak"),
    ("252186", "Augusta"),
    ("253182", "Shorekeeper"),
    ("254601", "Phrolova"),
    ("255876", "Cartethyia"),
    ("260355", "Zhezhi"),
    ("262929", "Rusak"),
    ("263181", "Yangyang XL"),
    ("264861", "Lucilla"),
    ("273777", "Mornye"),
    ("276291", "Suisui"),
    ("277797", "Galbrena"),
    ("280476", "Chisa"),
    ("282999", "Aemeath"),
    ("286611", "Changli"),
    ("287358", "Chisa"),
    ("295788", "Suoming"),
    ("296013", "Qingxiao"),
    ("297990", "Iuno"),
    ("301545", "Lynae"),
    ("310422", "Lynae"),
    ("313785", "Rusak"),
    ("32658", "Rusak"),
    ("343302", "Aemeath"),
    ("347325", "Hiyuki"),
    ("39810", "Rusak"),
    ("43116", "Zani"),
    ("44169", "Rusak"),
    ("54276", "Iuno"),
    ("9333", "Rusak"),
    ("95769", "Phrolova"),
    ("96765", "Jinhsi"),
];

// Curated built-in known characters across Star Rail (SRMI), Wuthering Waves (WWMI),
// Genshin Impact (GIMI), and Zenless Zone Zero (ZZMI).
const BUILTIN_CHARACTERS: &[&str] = &[
    // Honkai: Star Rail
    "Acheron", "Aglaea", "Blackswan", "Bronya", "Castorice", "Cerydra", "Cipher", "Clara",
    "Cyrene", "Evanescia", "Evernight", "Feixiao", "Firefly", "Fu Xuan", "Fugue", "Guinaifen",
    "Hanya", "Himeko", "Hook", "Huohuo", "Hyacine", "Hysilens", "Jade", "Jingliu", "Kafka",
    "Lingsha", "Lynx", "March7th", "Nihilux", "Pearl", "Pela", "Qingque", "Rappa", "Robin",
    "Ruan Mei", "Seele", "Silverwolf", "Sparkle", "Sparxie", "Sushang", "The Dahlia",
    "The Herta", "Tingyun", "Topaz", "Tribbie", "Xueyi", "Yao Guang", "Yukong", "Yunli",
    // Wuthering Waves
    "Aemeath", "Augusta", "Baizhi", "Buling", "Camellya", "Cartethyia", "Changli", "Chisa",
    "Chixia", "Danjin", "Denia", "Encore", "Galbrena", "Hiyuki", "Iuno", "Jianxin", "Jinhsi",
    "Lucilla", "Lucy", "Lupa", "Lynae", "Mornye", "Phoebe", "Phrolova", "Qingxiao", "Rebecca",
    "Rover F", "Rusak", "Sanhua", "Shorekeeper", "Suisui", "Suoming", "Taoqi", "Yangyang",
    "Yinlin", "Youhu", "Zani", "Zhezhi",
    // Genshin Impact
    "Arlecchino", "Ayaka", "Chiori", "Clorinde", "Dehya", "Emilie", "Eula", "Furina", "Ganyu",
    "Hu Tao", "Jean", "Keqing", "Klee", "Kokomi", "Mona", "Nahida", "Navia", "Nilou", "Ningguang",
    "Raiden", "Shenhe", "Xianyun", "Xilonen", "Yae Miko", "Yelan", "Yoimiya",
    // Zenless Zone Zero
    "Anby", "Burnice", "Caesar", "Corin", "Ellen", "Grace", "Harumasa", "Jane Doe", "Koleda",
    "Lighter", "Miyabi", "Nicole", "Piper", "Qingyi", "Rina", "Soukaku", "Yanagi", "Zhu Yuan",
];

// Secondary character aliases to canonical name mapping
const CHARACTER_ALIASES: &[(&str, &str)] = &[
    ("huangquan", "Acheron"),
    ("black_swan", "Blackswan"),
    ("black swan", "Blackswan"),
    ("fu_xuan", "Fu Xuan"),
    ("fuxuan", "Fu Xuan"),
    ("silver_wolf", "Silverwolf"),
    ("silver wolf", "Silverwolf"),
    ("ruan_mei", "Ruan Mei"),
    ("ruanmei", "Ruan Mei"),
    ("march_7th", "March7th"),
    ("march 7th", "March7th"),
    ("march", "March7th"),
    ("yae", "Yae Miko"),
    ("raiden_shogun", "Raiden"),
    ("hutao", "Hu Tao"),
    ("jane_doe", "Jane Doe"),
    ("janedoe", "Jane Doe"),
    ("zhu_yuan", "Zhu Yuan"),
    ("zhuyuan", "Zhu Yuan"),
];

pub fn scan_and_preview_organization(mods_root: &Path) -> Result<OrganizeScanDto, String> {
    if !mods_root.exists() || !mods_root.is_dir() {
        return Err(format!("Mods folder not found: {}", mods_root.display()));
    }

    // 1. Build dynamic knowledge base from existing folders inside root
    let mut character_catalog: HashMap<String, String> = HashMap::new(); // lowercase key -> Canonical Name
    for name in BUILTIN_CHARACTERS {
        character_catalog.insert(name.to_lowercase(), name.to_string());
    }
    for (alias, canonical) in CHARACTER_ALIASES {
        character_catalog.insert(alias.to_lowercase(), canonical.to_string());
    }

    // If root has a Characters folder, harvest every existing subfolder as a recognized character!
    let chars_dir = mods_root.join("Characters");
    if chars_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&chars_dir) {
            for entry in entries.flatten() {
                if entry.file_type().is_ok_and(|ft| ft.is_dir()) {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if !name.starts_with('.') && !name.eq_ignore_ascii_case("Unknown") {
                        character_catalog.insert(name.to_lowercase(), name.clone());
                    }
                }
            }
        }
    }

    let mut guid_map: HashMap<String, String> = HashMap::new();
    for (guid, char_name) in WWMI_GUID_MAP {
        guid_map.insert(guid.to_string(), char_name.to_string());
    }

    // 2. Collect all mod directories in the workspace
    let mut mod_dirs = Vec::new();
    crate::scanner::collect_mod_dirs(mods_root, 0, &mut mod_dirs);
    if mod_dirs.is_empty() && crate::scanner::has_direct_ini(mods_root) {
        mod_dirs.push(mods_root.to_path_buf());
    }

    let mut proposals = Vec::new();
    let mut unorganized_count = 0;
    let mut already_organized_count = 0;

    let norm_root = mods_root.to_string_lossy().replace('\\', "/");

    for mod_path in &mod_dirs {
        let rel = match mod_path.strip_prefix(mods_root) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };

        let parts: Vec<&str> = rel.split('/').filter(|s| !s.is_empty()).collect();
        let mod_folder_name = parts.last().copied().unwrap_or("mod");

        // Determine if already properly organized in standard structure
        // Clean structure examples:
        // - Characters/<CharName>/<ModName> (depth >= 3)
        // - Enemy/<EnemyName>/... or Enemy/<ModName> (depth >= 2)
        // - NPC/<NPCName>/... or NPC/<ModName> (depth >= 2)
        // - Splash/... (depth >= 2)
        let is_already_organized = if parts.is_empty() || parts.len() == 1 {
            false
        } else {
            let top = parts[0].to_lowercase();
            if top == "characters" {
                parts.len() >= 3 && parts[1] != "Unknown"
            } else if top == "enemy" || top == "npc" || top == "splash" || top == "others" {
                parts.len() >= 2
            } else {
                false
            }
        };

        let display_rel = if parts.len() <= 1 {
            format!("./{rel}")
        } else {
            rel.clone()
        };

        if is_already_organized {
            already_organized_count += 1;
            let target_folder_rel = if parts.len() > 1 {
                parts[..parts.len() - 1].join("/")
            } else {
                parts[0].to_string()
            };
            proposals.push(OrganizeProposal {
                mod_id: rel.clone(),
                mod_name: mod_folder_name.to_string(),
                current_path: mod_path.to_string_lossy().to_string(),
                current_rel_path: display_rel,
                target_folder_rel: target_folder_rel.clone(),
                target_dir_abs: mod_path.parent().unwrap_or(mods_root).to_string_lossy().to_string(),
                category: parts[0].to_string(),
                character_name: if parts.len() >= 3 { Some(parts[1].to_string()) } else { None },
                confidence: 100,
                match_reason: "Already in structured category".to_string(),
                is_already_organized: true,
                selected: false,
                suggested_full_rel: rel.clone(),
            });
            continue;
        }

        unorganized_count += 1;

        // Inspect mod files (.ini, folder name, etc.)
        let (category, char_opt, confidence, reason) =
            classify_mod(mod_path, &character_catalog, &guid_map);

        let target_folder_rel = if let Some(ref char_name) = char_opt {
            format!("{category}/{char_name}")
        } else {
            format!("{category}")
        };

        let target_dir_abs = mods_root
            .join(target_folder_rel.replace('/', "\\"))
            .to_string_lossy()
            .to_string();

        let suggested_full_rel = format!("{target_folder_rel}/{mod_folder_name}");

        proposals.push(OrganizeProposal {
            mod_id: rel.clone(),
            mod_name: mod_folder_name.to_string(),
            current_path: mod_path.to_string_lossy().to_string(),
            current_rel_path: display_rel,
            target_folder_rel,
            target_dir_abs,
            suggested_full_rel,
            category,
            character_name: char_opt,
            confidence,
            match_reason: reason,
            is_already_organized: false,
            selected: confidence >= 60,
        });
    }

    // Sort proposals: unorganized first, highest confidence first
    proposals.sort_by(|a, b| b.confidence.cmp(&a.confidence).then_with(|| a.mod_name.cmp(&b.mod_name)));

    Ok(OrganizeScanDto {
        root_path: norm_root,
        total_mods: mod_dirs.len(),
        unorganized_count,
        already_organized_count,
        proposals,
    })
}

fn classify_mod(
    mod_path: &Path,
    character_catalog: &HashMap<String, String>,
    guid_map: &HashMap<String, String>,
) -> (String, Option<String>, u32, String) {
    let mod_folder_name = mod_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_lowercase();

    // Collect all .ini files inside this mod folder
    let mut ini_files = Vec::new();
    collect_ini_paths(mod_path, &mut ini_files);

    // 1. Check WWMI object_guid in .ini files (highest accuracy, 100% confidence)
    for ini_p in &ini_files {
        if let Ok(content) = fs::read_to_string(ini_p) {
            for (guid, char_name) in guid_map {
                let needle1 = format!("object_guid = {guid}");
                let needle2 = format!("object_guid={guid}");
                let needle3 = format!("$object_guid = {guid}");
                if content.contains(&needle1) || content.contains(&needle2) || content.contains(&needle3) {
                    return (
                        "Characters".to_string(),
                        Some(char_name.clone()),
                        100,
                        format!("Matched WWMI $object_guid {guid} ({char_name})"),
                    );
                }
            }
        }
    }

    // 2. Check TextureOverride section headers in .ini files (95% confidence)
    // Example: [TextureOverrideAcheronPosition], [TextureOverrideChangliBody]
    for ini_p in &ini_files {
        if let Ok(content) = fs::read_to_string(ini_p) {
            let lower = content.to_lowercase();
            for (key, canonical) in character_catalog {
                let pattern1 = format!("[textureoverride{key}");
                let pattern2 = format!("[textureoverride_{key}");
                let pattern3 = format!("[resource{key}");
                if lower.contains(&pattern1) || lower.contains(&pattern2) || lower.contains(&pattern3) {
                    return (
                        "Characters".to_string(),
                        Some(canonical.clone()),
                        95,
                        format!("Matched .ini section header [TextureOverride{canonical}...]"),
                    );
                }
            }
        }
    }

    // 3. Check .ini file names (90% confidence)
    // Example: Acheron.ini, AcheronSplash.ini, Changli.ini
    for ini_p in &ini_files {
        let stem = ini_p
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();

        // Strip prefix "disabled"
        let clean_stem = stem.strip_prefix("disabled").unwrap_or(&stem);

        for (key, canonical) in character_catalog {
            if clean_stem == key.as_str()
                || clean_stem.starts_with(key.as_str())
                || clean_stem.ends_with(key.as_str())
            {
                return (
                    "Characters".to_string(),
                    Some(canonical.clone()),
                    90,
                    format!("Matched .ini filename '{clean_stem}.ini' -> {canonical}"),
                );
            }
        }
    }

    // 4. Check Enemy / Monster / NPC keywords in folder name or ini
    if mod_folder_name.contains("enemy")
        || mod_folder_name.contains("boss")
        || mod_folder_name.contains("monster")
    {
        return (
            "Enemy".to_string(),
            None,
            85,
            "Matched 'enemy/boss/monster' in mod folder name".to_string(),
        );
    }
    if mod_folder_name.contains("npc") {
        return (
            "NPC".to_string(),
            None,
            85,
            "Matched 'npc' in mod folder name".to_string(),
        );
    }
    if mod_folder_name.contains("splash") || mod_folder_name.contains("art") {
        // Check if a character matches too
        for (key, canonical) in character_catalog {
            if mod_folder_name.contains(key.as_str()) {
                return (
                    "Characters".to_string(),
                    Some(canonical.clone()),
                    85,
                    format!("Matched Splash Art for character '{canonical}'"),
                );
            }
        }
    }

    // 5. Check mod folder name against known characters (75% confidence)
    for (key, canonical) in character_catalog {
        if mod_folder_name.contains(key.as_str()) {
            return (
                "Characters".to_string(),
                Some(canonical.clone()),
                75,
                format!("Matched character keyword '{canonical}' in mod folder name"),
            );
        }
    }

    // 6. Check .ini comment headers (; Acheron, ; Changli)
    for ini_p in &ini_files {
        if let Ok(content) = fs::read_to_string(ini_p) {
            let first_lines = content
                .lines()
                .take(15)
                .map(|l| l.trim().to_lowercase())
                .collect::<Vec<_>>();

            for line in first_lines {
                if line.starts_with(';') {
                    for (key, canonical) in character_catalog {
                        if line.contains(key.as_str()) {
                            return (
                                "Characters".to_string(),
                                Some(canonical.clone()),
                                65,
                                format!("Matched character '{canonical}' in .ini comment header"),
                            );
                        }
                    }
                }
            }
        }
    }

    // 7. Fallback to Unknown
    (
        "Unknown".to_string(),
        None,
        0,
        "No known character, hash, or category signature matched".to_string(),
    )
}

fn collect_ini_paths(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() && is_ini_file(&p) {
            out.push(p);
        } else if p.is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with('.') {
                collect_ini_paths(&p, out);
            }
        }
    }
}

pub fn apply_organization_batch(moves: Vec<OrganizeMoveRequest>) -> Result<OrganizeResultDto, String> {
    let mut moved_count = 0;
    let mut failed_count = 0;
    let mut errors = Vec::new();

    for req in moves {
        let src = Path::new(&req.source_path);
        let target_dir = Path::new(&req.target_dir);

        if !src.exists() {
            failed_count += 1;
            errors.push(format!("Source '{}' not found", req.source_path));
            continue;
        }

        if !target_dir.exists() {
            if let Err(e) = fs::create_dir_all(target_dir) {
                failed_count += 1;
                errors.push(format!("Failed to create destination folder '{}': {e}", target_dir.display()));
                continue;
            }
        }

        match move_fs_entry(src, target_dir) {
            Ok(_) => moved_count += 1,
            Err(e) => {
                failed_count += 1;
                errors.push(format!("Failed to move '{}': {e}", req.source_path));
            }
        }
    }

    Ok(OrganizeResultDto {
        moved_count,
        failed_count,
        errors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_mod_by_ini_content() {
        let temp = std::env::temp_dir().join(format!("aiomm_test_org_{}", std::process::id()));
        if temp.exists() {
            let _ = fs::remove_dir_all(&temp);
        }
        let mod_dir = temp.join("random_custom_mod");
        fs::create_dir_all(&mod_dir).unwrap();

        fs::write(
            mod_dir.join("mod.ini"),
            "[TextureOverrideAcheronPosition]\nhash = 45f5804b\nhandling = skip\n",
        )
        .unwrap();

        let mut catalog = HashMap::new();
        catalog.insert("acheron".to_string(), "Acheron".to_string());
        let guid_map = HashMap::new();

        let (cat, char_opt, conf, reason) = classify_mod(&mod_dir, &catalog, &guid_map);
        assert_eq!(cat, "Characters");
        assert_eq!(char_opt.as_deref(), Some("Acheron"));
        assert!(conf >= 90);
        assert!(reason.contains("TextureOverride"));

        let _ = fs::remove_dir_all(&temp);
    }
}
