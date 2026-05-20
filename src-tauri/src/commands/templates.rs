use crate::vault::AppVault;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(serde::Serialize)]
pub struct TemplateEntry {
    pub display_name: String,
    pub path: String,
}

static BUILTIN_TEMPLATES: &[(&str, &str)] = &[
    (
        "NPC.md",
        "---\ntags: [npc]\n---\n\n# Name\n\n## Description\n\n## Personality\n\n## Background\n\n## Notes\n",
    ),
    (
        "Location.md",
        "---\ntags: [location]\n---\n\n# Name\n\n## Description\n\n## Notable Features\n\n## NPCs\n\n## Notes\n",
    ),
    (
        "Session Log.md",
        "---\ntags: [session]\n---\n\n# Session — Date\n\n## Summary\n\n## Events\n\n## NPCs Met\n\n## Loot & Rewards\n\n## Notes\n",
    ),
    (
        "Encounter.md",
        "---\ntags: [encounter]\n---\n\n# Name\n\n## Description\n\n## Monsters\n\n## Loot\n\n## Notes\n",
    ),
];

pub fn templates_dir(vault_path: &Path) -> PathBuf {
    vault_path.join(".grimoire").join("templates")
}

pub fn inject_builtin_templates(vault_path: &Path) -> Result<(), String> {
    let dir = templates_dir(vault_path);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create templates directory: {e}"))?;

    for (filename, content) in BUILTIN_TEMPLATES {
        let dest = dir.join(filename);
        if !dest.exists() {
            std::fs::write(&dest, content)
                .map_err(|e| format!("Failed to write template {filename}: {e}"))?;
        }
    }

    Ok(())
}

pub fn list_templates_for_vault(vault_path: &Path) -> Result<Vec<TemplateEntry>, String> {
    let dir = templates_dir(vault_path);

    if !dir.exists() {
        return Ok(vec![]);
    }

    let canonical_vault = vault_path
        .canonicalize()
        .map_err(|e| format!("Invalid vault root: {e}"))?;
    let canonical_dir = dir
        .canonicalize()
        .map_err(|e| format!("Invalid templates directory: {e}"))?;

    if !canonical_dir.starts_with(&canonical_vault) {
        return Err("Templates directory escapes vault root".to_string());
    }

    let mut entries: Vec<TemplateEntry> = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read templates directory: {e}"))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();

            if path.extension()?.to_str()? != "md" {
                return None;
            }

            let canonical_file = path.canonicalize().ok()?;
            if !canonical_file.starts_with(&canonical_dir) {
                return None;
            }

            let display_name = path.file_stem()?.to_string_lossy().to_string();
            let relative = canonical_file
                .strip_prefix(&canonical_vault)
                .ok()?
                .to_string_lossy()
                .to_string();

            Some(TemplateEntry {
                display_name,
                path: relative,
            })
        })
        .collect();

    entries.sort_by(|a, b| a.display_name.cmp(&b.display_name));

    Ok(entries)
}

#[tauri::command]
pub fn list_templates(vault: State<AppVault>) -> Result<Vec<TemplateEntry>, String> {
    let state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.as_ref().ok_or("No vault open")?;
    list_templates_for_vault(vault_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn inject_creates_templates_dir_and_four_files() {
        let tmp = tempdir().unwrap();
        inject_builtin_templates(tmp.path()).unwrap();

        let dir = templates_dir(tmp.path());
        assert!(dir.exists(), "templates dir should be created");

        for (filename, _) in BUILTIN_TEMPLATES {
            assert!(dir.join(filename).exists(), "{filename} should exist");
        }
    }

    #[test]
    fn inject_does_not_overwrite_existing_files() {
        let tmp = tempdir().unwrap();
        inject_builtin_templates(tmp.path()).unwrap();

        let dir = templates_dir(tmp.path());
        let npc_path = dir.join("NPC.md");
        std::fs::write(&npc_path, "custom content").unwrap();

        inject_builtin_templates(tmp.path()).unwrap();

        let content = std::fs::read_to_string(&npc_path).unwrap();
        assert_eq!(content, "custom content", "existing file must not be overwritten");
    }

    #[test]
    fn list_templates_returns_entry_per_md_file() {
        let tmp = tempdir().unwrap();
        inject_builtin_templates(tmp.path()).unwrap();

        let entries = list_templates_for_vault(tmp.path()).unwrap();
        assert_eq!(entries.len(), 4);

        let names: Vec<&str> = entries.iter().map(|e| e.display_name.as_str()).collect();
        assert!(names.contains(&"NPC"), "NPC should be listed");
        assert!(names.contains(&"Location"), "Location should be listed");
        assert!(names.contains(&"Session Log"), "Session Log should be listed");
        assert!(names.contains(&"Encounter"), "Encounter should be listed");
    }

    #[test]
    fn list_templates_paths_are_vault_relative() {
        let tmp = tempdir().unwrap();
        inject_builtin_templates(tmp.path()).unwrap();

        let entries = list_templates_for_vault(tmp.path()).unwrap();
        for entry in &entries {
            assert!(
                entry.path.contains(".grimoire"),
                "path '{}' should be vault-relative and contain .grimoire",
                entry.path
            );
            assert!(
                !entry.path.contains(":\\") && !entry.path.starts_with('/'),
                "path '{}' should be relative, not absolute",
                entry.path
            );
        }
    }

    #[test]
    fn list_templates_returns_empty_when_dir_missing() {
        let tmp = tempdir().unwrap();
        let entries = list_templates_for_vault(tmp.path()).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn list_templates_ignores_non_md_files() {
        let tmp = tempdir().unwrap();
        inject_builtin_templates(tmp.path()).unwrap();

        let dir = templates_dir(tmp.path());
        std::fs::write(dir.join("notes.txt"), "ignore me").unwrap();
        std::fs::write(dir.join("image.png"), "ignore me").unwrap();

        let entries = list_templates_for_vault(tmp.path()).unwrap();
        assert_eq!(entries.len(), 4, "non-.md files should be ignored");
    }
}
