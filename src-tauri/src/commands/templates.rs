use crate::ledger::AppLedger;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(serde::Serialize, specta::Type)]
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

pub fn templates_dir(ledger_path: &Path) -> PathBuf {
    ledger_path.join(".grimoire").join("templates")
}

pub fn inject_builtin_templates(ledger_path: &Path) -> Result<(), String> {
    let dir = templates_dir(ledger_path);
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

/// Overwrites only the four built-in template files with their original
/// content, recreating any that are missing. Custom `.md` files in the
/// templates directory are left untouched.
pub fn restore_builtin_templates_for_ledger(ledger_path: &Path) -> Result<(), String> {
    let dir = templates_dir(ledger_path);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create templates directory: {e}"))?;

    for (filename, content) in BUILTIN_TEMPLATES {
        let dest = dir.join(filename);
        std::fs::write(&dest, content)
            .map_err(|e| format!("Failed to restore template {filename}: {e}"))?;
    }

    Ok(())
}

pub fn list_templates_for_ledger(ledger_path: &Path) -> Result<Vec<TemplateEntry>, String> {
    let dir = templates_dir(ledger_path);

    if !dir.exists() {
        return Ok(vec![]);
    }

    let canonical_ledger = ledger_path
        .canonicalize()
        .map_err(|e| format!("Invalid ledger root: {e}"))?;
    let canonical_dir = dir
        .canonicalize()
        .map_err(|e| format!("Invalid templates directory: {e}"))?;

    if !canonical_dir.starts_with(&canonical_ledger) {
        return Err("Templates directory escapes ledger root".to_string());
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

            let display_name = path.file_stem()?.to_string_lossy().into_owned();
            let relative = canonical_file
                .strip_prefix(&canonical_ledger)
                .ok()?
                .to_string_lossy()
                .replace('\\', "/");

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
#[specta::specta]
pub fn list_templates(ledger: State<AppLedger>) -> Result<Vec<TemplateEntry>, String> {
    let state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?;
    list_templates_for_ledger(ledger_path)
}

#[tauri::command]
#[specta::specta]
pub fn restore_builtin_templates(ledger: State<AppLedger>) -> Result<(), String> {
    let state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?;
    restore_builtin_templates_for_ledger(ledger_path)
}

pub(crate) fn resolve_template_path(ledger_path: &Path, path: &str) -> Result<(PathBuf, PathBuf), String> {
    let canonical_file = ledger_path
        .join(path)
        .canonicalize()
        .map_err(|e| format!("Invalid path: {e}"))?;
    let canonical_dir = templates_dir(ledger_path)
        .canonicalize()
        .map_err(|e| format!("Invalid templates dir: {e}"))?;

    if !canonical_file.starts_with(&canonical_dir) {
        return Err("Path escapes templates directory".to_string());
    }

    Ok((canonical_file, canonical_dir))
}

pub fn rename_template_for_ledger(
    ledger_path: &Path,
    path: &str,
    new_name: &str,
) -> Result<(), String> {
    let new_name = new_name.trim();
    if new_name.is_empty() {
        return Err("Template name cannot be empty".to_string());
    }
    if new_name.contains('/') || new_name.contains('\\') || new_name.contains("..") {
        return Err("Invalid template name".to_string());
    }

    let (canonical_file, canonical_dir) = resolve_template_path(ledger_path, path)?;
    let new_path = canonical_dir.join(format!("{new_name}.md"));

    // Canonicalize before comparing: on case-insensitive filesystems a
    // case-only rename hits the source file itself, and the raw joined path
    // never string-matches the canonical one.
    let same_file = new_path
        .canonicalize()
        .map(|p| p == canonical_file)
        .unwrap_or(false);
    if new_path.exists() && !same_file {
        return Err(format!("ERR_NAME_TAKEN: A template named '{new_name}' already exists"));
    }

    std::fs::rename(&canonical_file, &new_path)
        .map_err(|e| format!("Failed to rename template: {e}"))
}

pub(crate) fn read_template_content(ledger_path: &Path, template_path: &str) -> Result<String, String> {
    let (canonical_file, _) = resolve_template_path(ledger_path, template_path)?;
    std::fs::read_to_string(&canonical_file)
        .map_err(|e| format!("Failed to read template: {e}"))
}

pub fn create_template_for_ledger(ledger_path: &Path) -> Result<TemplateEntry, String> {
    let dir = templates_dir(ledger_path);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create templates directory: {e}"))?;

    let mut resolved_name = "Untitled".to_string();
    let mut counter = 2u32;
    loop {
        let candidate = dir.join(format!("{resolved_name}.md"));
        if !candidate.exists() {
            std::fs::write(&candidate, "")
                .map_err(|e| format!("Failed to create template: {e}"))?;

            let canonical_ledger = ledger_path
                .canonicalize()
                .map_err(|e| format!("Invalid ledger root: {e}"))?;
            let canonical_file = candidate
                .canonicalize()
                .map_err(|e| format!("Cannot resolve new template path: {e}"))?;
            let relative = canonical_file
                .strip_prefix(&canonical_ledger)
                .map_err(|_| "Template path escapes ledger root".to_string())?
                .to_string_lossy()
                .replace('\\', "/");

            return Ok(TemplateEntry {
                display_name: resolved_name,
                path: relative,
            });
        }
        resolved_name = format!("Untitled {counter}");
        counter += 1;
    }
}

pub fn write_template_content_for_ledger(
    ledger_path: &Path,
    path: &str,
    content: &str,
) -> Result<(), String> {
    let (canonical_file, _) = resolve_template_path(ledger_path, path)?;
    std::fs::write(&canonical_file, content)
        .map_err(|e| format!("Failed to write template: {e}"))
}

#[tauri::command]
#[specta::specta]
pub fn rename_template(
    path: String,
    new_name: String,
    ledger: State<AppLedger>,
) -> Result<(), String> {
    let state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?;
    rename_template_for_ledger(ledger_path, &path, &new_name)
}

pub fn delete_template_for_ledger(ledger_path: &Path, path: &str) -> Result<(), String> {
    let (canonical_file, _) = resolve_template_path(ledger_path, path)?;
    std::fs::remove_file(&canonical_file)
        .map_err(|e| format!("Failed to delete template: {e}"))
}

#[tauri::command]
#[specta::specta]
pub fn create_template(ledger: State<AppLedger>) -> Result<TemplateEntry, String> {
    let state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?;
    create_template_for_ledger(ledger_path)
}

#[tauri::command]
#[specta::specta]
pub fn read_template(path: String, ledger: State<AppLedger>) -> Result<String, String> {
    let state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?;
    read_template_content(ledger_path, &path)
}

#[tauri::command]
#[specta::specta]
pub fn write_template(path: String, content: String, ledger: State<AppLedger>) -> Result<(), String> {
    let state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?;
    write_template_content_for_ledger(ledger_path, &path, &content)
}

#[tauri::command]
#[specta::specta]
pub fn delete_template(path: String, ledger: State<AppLedger>) -> Result<(), String> {
    let state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?;
    delete_template_for_ledger(ledger_path, &path)
}

pub fn save_note_as_template_for_ledger(ledger_path: &Path, note_path: &str) -> Result<TemplateEntry, String> {
    let canonical_ledger = ledger_path
        .canonicalize()
        .map_err(|e| format!("Invalid ledger root: {e}"))?;
    let canonical_note = ledger_path
        .join(note_path)
        .canonicalize()
        .map_err(|e| format!("Invalid note path: {e}"))?;
    if !canonical_note.starts_with(&canonical_ledger) {
        return Err("Note path escapes ledger root".to_string());
    }

    let content = std::fs::read_to_string(&canonical_note)
        .map_err(|e| format!("Failed to read note: {e}"))?;

    let base_name = canonical_note
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Cannot determine note filename")?
        .to_string();

    let dir = templates_dir(ledger_path);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create templates directory: {e}"))?;

    let mut resolved_name = base_name.clone();
    let mut counter = 2u32;
    loop {
        let candidate = dir.join(format!("{resolved_name}.md"));
        if !candidate.exists() {
            std::fs::write(&candidate, &content)
                .map_err(|e| format!("Failed to write template: {e}"))?;

            let canonical_file = candidate
                .canonicalize()
                .map_err(|e| format!("Cannot resolve new template path: {e}"))?;
            let relative = canonical_file
                .strip_prefix(&canonical_ledger)
                .map_err(|_| "Template path escapes ledger root".to_string())?
                .to_string_lossy()
                .replace('\\', "/");

            return Ok(TemplateEntry {
                display_name: resolved_name,
                path: relative,
            });
        }
        resolved_name = format!("{} {}", base_name, counter);
        counter += 1;
    }
}

#[tauri::command]
#[specta::specta]
pub fn save_note_as_template(note_path: String, ledger: State<AppLedger>) -> Result<TemplateEntry, String> {
    let state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?;
    save_note_as_template_for_ledger(ledger_path, &note_path)
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
    fn restore_overwrites_edited_builtin_files() {
        let tmp = tempdir().unwrap();
        inject_builtin_templates(tmp.path()).unwrap();

        let dir = templates_dir(tmp.path());
        let npc_path = dir.join("NPC.md");
        std::fs::write(&npc_path, "edited content").unwrap();

        restore_builtin_templates_for_ledger(tmp.path()).unwrap();

        let content = std::fs::read_to_string(&npc_path).unwrap();
        let original = BUILTIN_TEMPLATES
            .iter()
            .find(|(name, _)| *name == "NPC.md")
            .map(|(_, c)| *c)
            .unwrap();
        assert_eq!(content, original, "edited built-in should be restored");
    }

    #[test]
    fn restore_resets_all_four_builtins() {
        let tmp = tempdir().unwrap();
        let dir = templates_dir(tmp.path());
        std::fs::create_dir_all(&dir).unwrap();
        for (filename, _) in BUILTIN_TEMPLATES {
            std::fs::write(dir.join(filename), "garbage").unwrap();
        }

        restore_builtin_templates_for_ledger(tmp.path()).unwrap();

        for (filename, content) in BUILTIN_TEMPLATES {
            let on_disk = std::fs::read_to_string(dir.join(filename)).unwrap();
            assert_eq!(&on_disk, content, "{filename} should be reset to default");
        }
    }

    #[test]
    fn restore_leaves_custom_templates_untouched() {
        let tmp = tempdir().unwrap();
        inject_builtin_templates(tmp.path()).unwrap();

        let dir = templates_dir(tmp.path());
        let custom_path = dir.join("My Custom.md");
        std::fs::write(&custom_path, "custom body").unwrap();

        restore_builtin_templates_for_ledger(tmp.path()).unwrap();

        assert!(custom_path.exists(), "custom template must not be deleted");
        let content = std::fs::read_to_string(&custom_path).unwrap();
        assert_eq!(content, "custom body", "custom template must not be modified");
    }

    #[test]
    fn restore_recreates_missing_builtin_files() {
        let tmp = tempdir().unwrap();
        inject_builtin_templates(tmp.path()).unwrap();

        let dir = templates_dir(tmp.path());
        std::fs::remove_file(dir.join("Encounter.md")).unwrap();

        restore_builtin_templates_for_ledger(tmp.path()).unwrap();

        assert!(dir.join("Encounter.md").exists(), "deleted built-in should be recreated");
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

        let entries = list_templates_for_ledger(tmp.path()).unwrap();
        assert_eq!(entries.len(), 4);

        let names: Vec<&str> = entries.iter().map(|e| e.display_name.as_str()).collect();
        assert!(names.contains(&"NPC"), "NPC should be listed");
        assert!(names.contains(&"Location"), "Location should be listed");
        assert!(names.contains(&"Session Log"), "Session Log should be listed");
        assert!(names.contains(&"Encounter"), "Encounter should be listed");
    }

    #[test]
    fn list_templates_paths_are_ledger_relative() {
        let tmp = tempdir().unwrap();
        inject_builtin_templates(tmp.path()).unwrap();

        let entries = list_templates_for_ledger(tmp.path()).unwrap();
        for entry in &entries {
            assert!(
                entry.path.contains(".grimoire"),
                "path '{}' should be ledger-relative and contain .grimoire",
                entry.path
            );
            assert!(
                !entry.path.starts_with('/') && !entry.path.contains(":\\"),
                "path '{}' should be relative, not absolute",
                entry.path
            );
            assert!(
                !entry.path.contains('\\'),
                "path '{}' should use forward slashes",
                entry.path
            );
        }
    }

    #[test]
    fn list_templates_returns_empty_when_dir_missing() {
        let tmp = tempdir().unwrap();
        let entries = list_templates_for_ledger(tmp.path()).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn list_templates_ignores_non_md_files() {
        let tmp = tempdir().unwrap();
        inject_builtin_templates(tmp.path()).unwrap();

        let dir = templates_dir(tmp.path());
        std::fs::write(dir.join("notes.txt"), "ignore me").unwrap();
        std::fs::write(dir.join("image.png"), "ignore me").unwrap();

        let entries = list_templates_for_ledger(tmp.path()).unwrap();
        assert_eq!(entries.len(), 4, "non-.md files should be ignored");
    }

    #[test]
    fn rename_template_renames_file_on_disk() {
        let tmp = tempdir().unwrap();
        inject_builtin_templates(tmp.path()).unwrap();

        let dir = templates_dir(tmp.path());
        let path = ".grimoire/templates/NPC.md";
        rename_template_for_ledger(tmp.path(), path, "Character").unwrap();

        assert!(!dir.join("NPC.md").exists(), "NPC.md should be gone");
        assert!(dir.join("Character.md").exists(), "Character.md should exist");
    }

    #[test]
    fn rename_template_allows_case_only_rename() {
        let tmp = tempdir().unwrap();
        inject_builtin_templates(tmp.path()).unwrap();

        // On case-insensitive filesystems the destination "exists" (it's the
        // source itself) — this must not be reported as a collision.
        rename_template_for_ledger(tmp.path(), ".grimoire/templates/NPC.md", "npc").unwrap();

        assert!(templates_dir(tmp.path()).join("npc.md").exists());
    }

    #[test]
    fn rename_template_rejects_empty_name() {
        let tmp = tempdir().unwrap();
        inject_builtin_templates(tmp.path()).unwrap();
        let result = rename_template_for_ledger(tmp.path(), ".grimoire/templates/NPC.md", "  ");
        assert!(result.is_err());
    }

    #[test]
    fn rename_template_rejects_path_traversal_in_name() {
        let tmp = tempdir().unwrap();
        inject_builtin_templates(tmp.path()).unwrap();
        let result =
            rename_template_for_ledger(tmp.path(), ".grimoire/templates/NPC.md", "../evil");
        assert!(result.is_err());
    }

    #[test]
    fn delete_template_removes_file() {
        let tmp = tempdir().unwrap();
        inject_builtin_templates(tmp.path()).unwrap();

        let dir = templates_dir(tmp.path());
        delete_template_for_ledger(tmp.path(), ".grimoire/templates/NPC.md").unwrap();

        assert!(!dir.join("NPC.md").exists(), "NPC.md should be deleted");
    }

    #[test]
    fn delete_template_rejects_path_outside_templates_dir() {
        let tmp = tempdir().unwrap();
        std::fs::write(tmp.path().join("secret.md"), "secret").unwrap();
        let result = delete_template_for_ledger(tmp.path(), "secret.md");
        assert!(result.is_err());
    }

    #[test]
    fn read_template_content_returns_full_file_body() {
        let tmp = tempdir().unwrap();
        inject_builtin_templates(tmp.path()).unwrap();

        let content = read_template_content(tmp.path(), ".grimoire/templates/NPC.md").unwrap();
        assert!(content.contains("tags: [npc]"), "should include frontmatter");
        assert!(content.contains("## Personality"), "should include section headings");
    }

    #[test]
    fn read_template_content_rejects_path_outside_templates_dir() {
        let tmp = tempdir().unwrap();
        inject_builtin_templates(tmp.path()).unwrap();
        std::fs::write(tmp.path().join("secret.md"), "secret data").unwrap();
        let result = read_template_content(tmp.path(), "secret.md");
        assert!(result.is_err(), "path outside templates dir must be rejected");
    }

    #[test]
    fn create_template_creates_file_in_templates_dir() {
        let tmp = tempdir().unwrap();
        inject_builtin_templates(tmp.path()).unwrap();
        let entry = create_template_for_ledger(tmp.path()).unwrap();
        let dir = templates_dir(tmp.path());
        assert!(dir.join(format!("{}.md", entry.display_name)).exists());
        assert_eq!(entry.display_name, "Untitled");
    }

    #[test]
    fn create_template_resolves_conflicts() {
        let tmp = tempdir().unwrap();
        let dir = templates_dir(tmp.path());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Untitled.md"), "").unwrap();
        let entry = create_template_for_ledger(tmp.path()).unwrap();
        assert_eq!(entry.display_name, "Untitled 2");
        assert!(dir.join("Untitled 2.md").exists());
    }

    #[test]
    fn create_template_creates_templates_dir_if_missing() {
        let tmp = tempdir().unwrap();
        let entry = create_template_for_ledger(tmp.path()).unwrap();
        let dir = templates_dir(tmp.path());
        assert!(dir.exists());
        assert!(dir.join(format!("{}.md", entry.display_name)).exists());
    }

    #[test]
    fn write_template_content_updates_file() {
        let tmp = tempdir().unwrap();
        inject_builtin_templates(tmp.path()).unwrap();
        write_template_content_for_ledger(tmp.path(), ".grimoire/templates/NPC.md", "new content").unwrap();
        let content = std::fs::read_to_string(templates_dir(tmp.path()).join("NPC.md")).unwrap();
        assert_eq!(content, "new content");
    }

    #[test]
    fn write_template_content_rejects_path_outside_templates_dir() {
        let tmp = tempdir().unwrap();
        inject_builtin_templates(tmp.path()).unwrap();
        std::fs::write(tmp.path().join("secret.md"), "").unwrap();
        let result = write_template_content_for_ledger(tmp.path(), "secret.md", "pwned");
        assert!(result.is_err());
    }

    #[test]
    fn save_note_as_template_copies_content_verbatim() {
        let tmp = tempdir().unwrap();
        inject_builtin_templates(tmp.path()).unwrap();

        let notes_dir = tmp.path().join("notes");
        std::fs::create_dir_all(&notes_dir).unwrap();
        let note_path = notes_dir.join("My Hero.md");
        let note_content = "---\ntags: [hero]\n---\n\n# My Hero\n\n## Background\n";
        std::fs::write(&note_path, note_content).unwrap();

        let entry = save_note_as_template_for_ledger(tmp.path(), "notes/My Hero.md").unwrap();

        assert_eq!(entry.display_name, "My Hero");
        let saved = std::fs::read_to_string(templates_dir(tmp.path()).join("My Hero.md")).unwrap();
        assert_eq!(saved, note_content);
    }

    #[test]
    fn save_note_as_template_conflict_resolution() {
        let tmp = tempdir().unwrap();
        let dir = templates_dir(tmp.path());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("My Hero.md"), "existing").unwrap();

        let notes_dir = tmp.path().join("notes");
        std::fs::create_dir_all(&notes_dir).unwrap();
        std::fs::write(notes_dir.join("My Hero.md"), "new content").unwrap();

        let entry = save_note_as_template_for_ledger(tmp.path(), "notes/My Hero.md").unwrap();

        assert_eq!(entry.display_name, "My Hero 2");
        assert!(dir.join("My Hero 2.md").exists());
        let saved = std::fs::read_to_string(dir.join("My Hero 2.md")).unwrap();
        assert_eq!(saved, "new content");
    }

    #[test]
    fn save_note_as_template_creates_templates_dir_if_missing() {
        let tmp = tempdir().unwrap();
        let notes_dir = tmp.path().join("notes");
        std::fs::create_dir_all(&notes_dir).unwrap();
        std::fs::write(notes_dir.join("Hero.md"), "hero content").unwrap();

        let entry = save_note_as_template_for_ledger(tmp.path(), "notes/Hero.md").unwrap();

        assert_eq!(entry.display_name, "Hero");
        assert!(templates_dir(tmp.path()).join("Hero.md").exists());
    }

    #[test]
    fn save_note_as_template_rejects_path_outside_ledger() {
        let tmp = tempdir().unwrap();
        let other = tempdir().unwrap();
        std::fs::write(other.path().join("secret.md"), "secret").unwrap();

        let result = save_note_as_template_for_ledger(tmp.path(), "../secret.md");
        assert!(result.is_err());
    }

    #[test]
    fn save_note_as_template_returns_ledger_relative_forward_slash_path() {
        let tmp = tempdir().unwrap();
        let notes_dir = tmp.path().join("notes");
        std::fs::create_dir_all(&notes_dir).unwrap();
        std::fs::write(notes_dir.join("NPC.md"), "").unwrap();

        let entry = save_note_as_template_for_ledger(tmp.path(), "notes/NPC.md").unwrap();

        assert!(entry.path.contains(".grimoire/templates/NPC.md"), "path should be ledger-relative: {}", entry.path);
        assert!(!entry.path.contains('\\'), "path should use forward slashes");
    }
}
