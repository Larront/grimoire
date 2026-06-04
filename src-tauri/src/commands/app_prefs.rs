use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Manager;

const APP_PREFS_FILE: &str = "app-prefs.json";

/// Global application preferences, persisted in the app data directory.
/// Distinct from per-ledger preferences (`.grimoire/prefs.json`).
#[derive(Debug, Serialize, Deserialize, Default, Clone, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppPrefs {
    pub reduce_motion: bool,
    pub confirm_rename_links: bool,
    pub sample_banner_dismissed: bool,
}

fn app_prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(data_dir.join(APP_PREFS_FILE))
}

fn read_prefs_file(path: &Path) -> Result<AppPrefs, String> {
    if !path.exists() {
        return Ok(AppPrefs::default());
    }
    let contents = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read app prefs: {}", e))?;
    serde_json::from_str(&contents).map_err(|e| format!("Failed to parse app prefs: {}", e))
}

fn write_prefs_file(path: &Path, prefs: &AppPrefs) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(prefs)
        .map_err(|e| format!("Failed to serialize app prefs: {}", e))?;
    fs::write(path, contents).map_err(|e| format!("Failed to write app prefs: {}", e))
}

#[tauri::command]
pub fn get_app_prefs(app: AppHandle) -> Result<AppPrefs, String> {
    let path = app_prefs_path(&app)?;
    read_prefs_file(&path)
}

#[tauri::command]
pub fn save_app_prefs(app: AppHandle, prefs: AppPrefs) -> Result<(), String> {
    let path = app_prefs_path(&app)?;
    write_prefs_file(&path, &prefs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn prefs_roundtrip_preserves_values() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(APP_PREFS_FILE);

        let prefs = AppPrefs {
            reduce_motion: true,
            confirm_rename_links: false,
            sample_banner_dismissed: true,
        };
        write_prefs_file(&path, &prefs).unwrap();

        assert_eq!(read_prefs_file(&path).unwrap(), prefs);
    }

    #[test]
    fn missing_file_yields_defaults() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(APP_PREFS_FILE);

        assert_eq!(read_prefs_file(&path).unwrap(), AppPrefs::default());
    }

    #[test]
    fn partial_file_fills_missing_fields_with_defaults() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(APP_PREFS_FILE);
        fs::write(&path, r#"{ "reduceMotion": true }"#).unwrap();

        let prefs = read_prefs_file(&path).unwrap();
        assert!(prefs.reduce_motion);
        assert!(!prefs.confirm_rename_links);
        assert!(!prefs.sample_banner_dismissed);
    }
}
