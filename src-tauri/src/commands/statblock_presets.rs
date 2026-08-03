//! Statblock Presets (#179) — GM-authored statblock shapes, held app-wide.
//!
//! **Why these live outside the ledger.** A preset is verbatim fence text, stamped
//! copy-on-insert with no id left behind, so no note ever depends on one existing. A
//! vault opened on a fresh machine loses a convenience and never a word of content.
//! That test — and only that test — is what makes app data the right home; anything a
//! note could depend on belongs in the ledger.
//!
//! **One file rather than many**, against the usual recommendation, so it can be
//! emailed or dropped into a sync folder. The accepted cost is a one-way door: fence
//! text inside a JSON string makes hand-editing not a realistic route, and unlike a
//! raw fence in a note there is no Obsidian escape hatch for app data. That is what
//! makes complete in-app authoring load-bearing rather than merely nice.
//!
//! **Only GM-authored shapes are stored.** The two shipped presets are frontend code
//! constants and are never written here, which is what keeps them un-editable and
//! un-deletable without a flag on every row.
//!
//! Nothing here understands a fence. The text is opaque: no parsing, and above all no
//! value-cleaning — pools count in opposite directions, so a clean `HP: 3/12` is
//! `12/12` to one GM and `0/12` to another, and the backend cannot know which.
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Manager;

const PRESETS_FILE: &str = "statblock-presets.json";

/// One saved shape: the name a GM stamps it by, and the fence text verbatim.
#[derive(Debug, Serialize, specta::Type, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatblockPreset {
    pub name: String,
    pub fence: String,
}

/// The file's shape. An object rather than a bare array so a later key can be added
/// without every existing file becoming unreadable.
#[derive(Debug, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
struct PresetStore {
    presets: Vec<StatblockPreset>,
}

/// Names are compared the way `/statblock <arg>` matches them: case-insensitively,
/// whole, and with surrounding whitespace ignored.
fn same_name(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

fn presets_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(data_dir.join(PRESETS_FILE))
}

fn read_store(path: &Path) -> Result<PresetStore, String> {
    if !path.exists() {
        return Ok(PresetStore::default());
    }
    let contents =
        fs::read_to_string(path).map_err(|e| format!("Failed to read statblock presets: {}", e))?;
    serde_json::from_str(&contents).map_err(|e| format!("Failed to parse statblock presets: {}", e))
}

fn write_store(path: &Path, store: &PresetStore) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(store)
        .map_err(|e| format!("Failed to serialize statblock presets: {}", e))?;
    fs::write(path, contents).map_err(|e| format!("Failed to write statblock presets: {}", e))
}

/// Save over an existing name, or append. The GM's order is otherwise untouched —
/// re-saving a shape must not move its row in Settings.
fn upsert(store: &mut PresetStore, preset: StatblockPreset) {
    match store
        .presets
        .iter_mut()
        .find(|p| same_name(&p.name, &preset.name))
    {
        Some(existing) => *existing = preset,
        None => store.presets.push(preset),
    }
}

fn rename(store: &mut PresetStore, from: &str, to: &str) -> Result<(), String> {
    if to.trim().is_empty() {
        return Err("ERR_EMPTY_NAME: a preset needs a name".into());
    }
    if store
        .presets
        .iter()
        .any(|p| same_name(&p.name, to) && !same_name(&p.name, from))
    {
        return Err("ERR_NAME_TAKEN: a preset of that name already exists".into());
    }
    match store.presets.iter_mut().find(|p| same_name(&p.name, from)) {
        Some(preset) => {
            preset.name = to.trim().to_string();
            Ok(())
        }
        None => Err(format!("No statblock preset named {}", from)),
    }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn list_statblock_presets(app: AppHandle) -> Result<Vec<StatblockPreset>, String> {
    Ok(read_store(&presets_path(&app)?)?.presets)
}

/// Save a shape under a name, overwriting any shape already saved under it. The fence
/// is stored exactly as given — this is the whole of "save shape as preset".
#[tauri::command]
#[specta::specta]
pub fn save_statblock_preset(app: AppHandle, name: String, fence: String) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("ERR_EMPTY_NAME: a preset needs a name".into());
    }
    let path = presets_path(&app)?;
    let mut store = read_store(&path)?;
    upsert(
        &mut store,
        StatblockPreset {
            name: name.trim().to_string(),
            fence,
        },
    );
    write_store(&path, &store)
}

#[tauri::command]
#[specta::specta]
pub fn rename_statblock_preset(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let path = presets_path(&app)?;
    let mut store = read_store(&path)?;
    rename(&mut store, &from, &to)?;
    write_store(&path, &store)
}

/// Delete a shape. No note can be affected: a stamped block holds a copy and no
/// reference, so this reaches nothing but the convenience itself.
#[tauri::command]
#[specta::specta]
pub fn delete_statblock_preset(app: AppHandle, name: String) -> Result<(), String> {
    let path = presets_path(&app)?;
    let mut store = read_store(&path)?;
    store.presets.retain(|p| !same_name(&p.name, &name));
    write_store(&path, &store)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn preset(name: &str, fence: &str) -> StatblockPreset {
        StatblockPreset {
            name: name.into(),
            fence: fence.into(),
        }
    }

    #[test]
    fn roundtrip_preserves_fence_text_verbatim() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(PRESETS_FILE);
        let fence = "```statblock\n# Goblin\nHP: 3/12\nWounds: [x][ ]\n```";

        let store = PresetStore {
            presets: vec![preset("Goblin", fence)],
        };
        write_store(&path, &store).unwrap();

        assert_eq!(read_store(&path).unwrap(), store);
        assert_eq!(read_store(&path).unwrap().presets[0].fence, fence);
    }

    #[test]
    fn missing_file_yields_an_empty_store() {
        let dir = tempdir().unwrap();
        assert_eq!(
            read_store(&dir.path().join(PRESETS_FILE)).unwrap(),
            PresetStore::default()
        );
    }

    #[test]
    fn upsert_overwrites_by_case_insensitive_name_and_keeps_position() {
        let mut store = PresetStore {
            presets: vec![preset("Goblin", "a"), preset("Orc", "b")],
        };
        upsert(&mut store, preset("goblin", "c"));

        assert_eq!(store.presets.len(), 2);
        assert_eq!(store.presets[0].name, "goblin");
        assert_eq!(store.presets[0].fence, "c");
        assert_eq!(store.presets[1].name, "Orc");
    }

    #[test]
    fn upsert_appends_a_new_name() {
        let mut store = PresetStore {
            presets: vec![preset("Goblin", "a")],
        };
        upsert(&mut store, preset("Orc", "b"));
        assert_eq!(
            store
                .presets
                .iter()
                .map(|p| p.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Goblin", "Orc"]
        );
    }

    #[test]
    fn rename_refuses_a_taken_name() {
        let mut store = PresetStore {
            presets: vec![preset("Goblin", "a"), preset("Orc", "b")],
        };
        let err = rename(&mut store, "Goblin", "orc").unwrap_err();
        assert!(err.starts_with("ERR_NAME_TAKEN"));
        assert_eq!(store.presets[0].name, "Goblin");
    }

    #[test]
    fn rename_allows_a_change_of_case_on_the_same_preset() {
        let mut store = PresetStore {
            presets: vec![preset("goblin", "a")],
        };
        rename(&mut store, "goblin", "Goblin").unwrap();
        assert_eq!(store.presets[0].name, "Goblin");
    }

    #[test]
    fn rename_refuses_an_empty_name() {
        let mut store = PresetStore {
            presets: vec![preset("Goblin", "a")],
        };
        assert!(
            rename(&mut store, "Goblin", "   ")
                .unwrap_err()
                .starts_with("ERR_EMPTY_NAME")
        );
    }
}
