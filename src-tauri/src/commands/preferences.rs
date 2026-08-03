use crate::ledger::AppLedger;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Serialize, specta::Type, Deserialize, Default)]
struct LedgerPrefs {
    accent_preset: Option<String>,
    density_level: Option<String>,
    /// Which app-wide [[Statblock Preset]] a bare `/statblock` stamps in this vault
    /// (#179). A *name*, not an id, and deliberately allowed to dangle: the presets it
    /// points at are shared across machines while this pointer is not, so a vault
    /// carried to a machine without that preset must still open. An unresolvable
    /// pointer stamps a blank statblock silently and reports itself in Settings.
    statblock_preset: Option<String>,
}

fn prefs_path(ledger: &AppLedger) -> Option<PathBuf> {
    let state = ledger.lock().ok()?;
    let base = state.path.as_ref()?.join(".grimoire").join("prefs.json");
    Some(base)
}

fn read_prefs(ledger: &AppLedger) -> LedgerPrefs {
    prefs_path(ledger)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_prefs(ledger: &AppLedger, prefs: &LedgerPrefs) {
    if let Some(path) = prefs_path(ledger) {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(contents) = serde_json::to_string_pretty(prefs) {
            let _ = fs::write(path, contents);
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn save_accent_preset(preset: String, ledger: State<AppLedger>) {
    let mut prefs = read_prefs(&ledger);
    prefs.accent_preset = Some(preset);
    write_prefs(&ledger, &prefs);
}

#[tauri::command]
#[specta::specta]
pub fn get_accent_preset(ledger: State<AppLedger>) -> Option<String> {
    read_prefs(&ledger).accent_preset
}

#[tauri::command]
#[specta::specta]
pub fn save_density_level(level: String, ledger: State<AppLedger>) {
    let mut prefs = read_prefs(&ledger);
    prefs.density_level = Some(level);
    write_prefs(&ledger, &prefs);
}

#[tauri::command]
#[specta::specta]
pub fn get_density_level(ledger: State<AppLedger>) -> Option<String> {
    read_prefs(&ledger).density_level
}

/// `None` clears the pointer, which is how "Blank" is chosen — blank is not a preset
/// but the absence of one, so there is no name to store for it.
#[tauri::command]
#[specta::specta]
pub fn save_statblock_preset_default(preset: Option<String>, ledger: State<AppLedger>) {
    let mut prefs = read_prefs(&ledger);
    prefs.statblock_preset = preset.filter(|name| !name.trim().is_empty());
    write_prefs(&ledger, &prefs);
}

#[tauri::command]
#[specta::specta]
pub fn get_statblock_preset_default(ledger: State<AppLedger>) -> Option<String> {
    read_prefs(&ledger).statblock_preset
}
