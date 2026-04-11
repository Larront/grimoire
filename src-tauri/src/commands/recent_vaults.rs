use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

const MAX_RECENT_VAULTS: usize = 10;
const RECENT_VAULTS_FILE: &str = "recent-vaults.json";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecentVault {
    pub path: String,
    pub name: String,
    pub note_count: usize,
    pub scene_count: usize,
    pub map_count: usize,
    pub last_opened: String, // ISO 8601
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct RecentVaultsFile {
    vaults: Vec<RecentVault>,
}

fn recent_vaults_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(data_dir.join(RECENT_VAULTS_FILE))
}

fn read_recent_vaults_file(app: &AppHandle) -> Result<RecentVaultsFile, String> {
    let path = recent_vaults_path(app)?;
    if !path.exists() {
        return Ok(RecentVaultsFile::default());
    }
    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read recent vaults: {}", e))?;
    serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse recent vaults: {}", e))
}

fn write_recent_vaults_file(app: &AppHandle, data: &RecentVaultsFile) -> Result<(), String> {
    let path = recent_vaults_path(app)?;
    let contents = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize recent vaults: {}", e))?;
    fs::write(&path, contents)
        .map_err(|e| format!("Failed to write recent vaults: {}", e))
}

#[tauri::command]
pub fn get_recent_vaults(app: AppHandle) -> Result<Vec<RecentVault>, String> {
    let mut data = read_recent_vaults_file(&app)?;
    // Filter out vaults whose directories no longer exist
    data.vaults.retain(|v| std::path::Path::new(&v.path).exists());
    // Write back the filtered list so removed entries don't persist
    write_recent_vaults_file(&app, &data)?;
    Ok(data.vaults)
}

#[tauri::command]
pub fn add_recent_vault(app: AppHandle, entry: RecentVault) -> Result<(), String> {
    let mut data = read_recent_vaults_file(&app)?;
    // Remove existing entry for this path (if any) so we can re-insert at front
    data.vaults.retain(|v| v.path != entry.path);
    // Insert at front (most recent first)
    data.vaults.insert(0, entry);
    // Trim to max
    data.vaults.truncate(MAX_RECENT_VAULTS);
    write_recent_vaults_file(&app, &data)
}

#[tauri::command]
pub fn remove_recent_vault(app: AppHandle, path: String) -> Result<(), String> {
    let mut data = read_recent_vaults_file(&app)?;
    data.vaults.retain(|v| v.path != path);
    write_recent_vaults_file(&app, &data)
}
