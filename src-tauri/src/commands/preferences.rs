use crate::vault::AppVault;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Default)]
struct VaultPrefs {
    accent_preset: Option<String>,
    density_level: Option<String>,
}

fn prefs_path(vault: &AppVault) -> Option<PathBuf> {
    let state = vault.lock().ok()?;
    let base = state.path.as_ref()?.join(".grimoire-prefs.json");
    Some(base)
}

fn read_prefs(vault: &AppVault) -> VaultPrefs {
    prefs_path(vault)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_prefs(vault: &AppVault, prefs: &VaultPrefs) {
    if let Some(path) = prefs_path(vault) {
        if let Ok(contents) = serde_json::to_string_pretty(prefs) {
            let _ = fs::write(path, contents);
        }
    }
}

#[tauri::command]
pub fn save_accent_preset(preset: String, vault: State<AppVault>) {
    let mut prefs = read_prefs(&vault);
    prefs.accent_preset = Some(preset);
    write_prefs(&vault, &prefs);
}

#[tauri::command]
pub fn get_accent_preset(vault: State<AppVault>) -> Option<String> {
    read_prefs(&vault).accent_preset
}

#[tauri::command]
pub fn save_density_level(level: String, vault: State<AppVault>) {
    let mut prefs = read_prefs(&vault);
    prefs.density_level = Some(level);
    write_prefs(&vault, &prefs);
}

#[tauri::command]
pub fn get_density_level(vault: State<AppVault>) -> Option<String> {
    read_prefs(&vault).density_level
}
