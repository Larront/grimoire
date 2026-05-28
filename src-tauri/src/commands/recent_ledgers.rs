use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

const MAX_RECENT_LEDGERS: usize = 10;
const RECENT_LEDGERS_FILE: &str = "recent-ledgers.json";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecentLedger {
    pub path: String,
    pub name: String,
    pub note_count: usize,
    pub scene_count: usize,
    pub map_count: usize,
    pub last_opened: String, // ISO 8601
}

#[derive(Debug, Serialize, Deserialize, Default)]
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
pub fn get_recent_ledgers(app: AppHandle) -> Result<Vec<RecentLedger>, String> {
    let mut data = read_recent_ledgers_file(&app)?;
    // Filter out ledgers whose directories no longer exist
    data.ledgers.retain(|v| std::path::Path::new(&v.path).exists());
    // Write back the filtered list so removed entries don't persist
    write_recent_ledgers_file(&app, &data)?;
    Ok(data.ledgers)
}

#[tauri::command]
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
pub fn remove_recent_ledger(app: AppHandle, path: String) -> Result<(), String> {
    let mut data = read_recent_ledgers_file(&app)?;
    data.ledgers.retain(|v| v.path != path);
    write_recent_ledgers_file(&app, &data)
}
