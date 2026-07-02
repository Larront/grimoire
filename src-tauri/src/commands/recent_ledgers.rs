use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

const MAX_RECENT_LEDGERS: usize = 10;
const RECENT_LEDGERS_FILE: &str = "recent-ledgers.json";

#[derive(Debug, Serialize, specta::Type, Deserialize, Clone)]
pub struct RecentLedger {
    pub path: String,
    pub name: String,
    #[specta(type = i32)]
    pub note_count: usize,
    #[specta(type = i32)]
    pub scene_count: usize,
    #[specta(type = i32)]
    pub map_count: usize,
    pub last_opened: String, // ISO 8601
    /// Derived at read time: the ledger folder was not found on disk (moved,
    /// deleted, or on an unmounted drive). Recomputed by every
    /// `get_recent_ledgers` call; the stored value is ignored.
    #[serde(default)]
    pub missing: bool,
}

#[derive(Debug, Serialize, specta::Type, Deserialize, Default)]
struct RecentLedgersFile {
    ledgers: Vec<RecentLedger>,
}

fn recent_ledgers_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(data_dir.join(RECENT_LEDGERS_FILE))
}

fn read_recent_ledgers_file(app: &AppHandle) -> Result<RecentLedgersFile, String> {
    let path = recent_ledgers_path(app)?;
    if !path.exists() {
        return Ok(RecentLedgersFile::default());
    }
    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read recent ledgers: {}", e))?;
    serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse recent ledgers: {}", e))
}

fn write_recent_ledgers_file(app: &AppHandle, data: &RecentLedgersFile) -> Result<(), String> {
    let path = recent_ledgers_path(app)?;
    let contents = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize recent ledgers: {}", e))?;
    fs::write(&path, contents)
        .map_err(|e| format!("Failed to write recent ledgers: {}", e))
}

#[tauri::command]
#[specta::specta]
pub fn get_recent_ledgers(app: AppHandle) -> Result<Vec<RecentLedger>, String> {
    let mut data = read_recent_ledgers_file(&app)?;
    // Annotate rather than prune: a folder on an unmounted drive is only
    // temporarily gone — silently dropping the entry would lose it for good.
    // Removal is explicit via remove_recent_ledger (issue #111).
    for entry in &mut data.ledgers {
        entry.missing = !std::path::Path::new(&entry.path).exists();
    }
    Ok(data.ledgers)
}

#[tauri::command]
#[specta::specta]
pub fn add_recent_ledger(app: AppHandle, entry: RecentLedger) -> Result<(), String> {
    let mut data = read_recent_ledgers_file(&app)?;
    // Remove existing entry for this path (if any) so we can re-insert at front
    data.ledgers.retain(|v| v.path != entry.path);
    // Insert at front (most recent first)
    data.ledgers.insert(0, entry);
    // Trim to max
    data.ledgers.truncate(MAX_RECENT_LEDGERS);
    write_recent_ledgers_file(&app, &data)
}

#[tauri::command]
#[specta::specta]
pub fn remove_recent_ledger(app: AppHandle, path: String) -> Result<(), String> {
    let mut data = read_recent_ledgers_file(&app)?;
    data.ledgers.retain(|v| v.path != path);
    write_recent_ledgers_file(&app, &data)
}
