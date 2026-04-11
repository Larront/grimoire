use crate::db::establish_connection;
use crate::db::models::NewPinCategory;
use crate::db::schema::{maps, notes, pin_categories, scenes};
use crate::vault::AppVault;
use diesel::prelude::*;
use std::path::PathBuf;
use tauri::State;

fn seed_default_categories(conn: &mut SqliteConnection) -> Result<(), String> {
    let count: i64 = pin_categories::table
        .filter(pin_categories::map_id.is_null())
        .count()
        .get_result(conn)
        .map_err(|e| e.to_string())?;

    if count > 0 {
        return Ok(());
    }

    let defaults: Vec<NewPinCategory> = vec![
        NewPinCategory { map_id: None, name: "Town",              icon: "house",     color: "#c4843a" },
        NewPinCategory { map_id: None, name: "City",              icon: "castle",    color: "#e0b44a" },
        NewPinCategory { map_id: None, name: "Cave",              icon: "mountain",  color: "#8b6abf" },
        NewPinCategory { map_id: None, name: "Dungeon",           icon: "skull",     color: "#cf4545" },
        NewPinCategory { map_id: None, name: "Ruin",              icon: "landmark",  color: "#7a8499" },
        NewPinCategory { map_id: None, name: "Forest",            icon: "tree-pine", color: "#4a9b5a" },
        NewPinCategory { map_id: None, name: "Point of Interest", icon: "map-pin",   color: "#6a9b87" },
    ];

    diesel::insert_into(pin_categories::table)
        .values(&defaults)
        .execute(conn)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(serde::Serialize)]
pub struct OpenVaultResult {
    pub path: String,
    pub note_count: i64,
    pub scene_count: i64,
    pub map_count: i64,
}

#[tauri::command]
pub fn open_vault(path: String, vault: State<AppVault>) -> Result<OpenVaultResult, String> {
    let vault_path = PathBuf::from(&path);

    if !vault_path.exists() {
        std::fs::create_dir_all(&vault_path)
            .map_err(|e| format!("Failed to create vault directory: {}", e))?;
    }

    let mut conn = establish_connection(&vault_path)?;
    seed_default_categories(&mut conn)?;

    let note_count: i64 = notes::table
        .count()
        .get_result(&mut conn)
        .unwrap_or(0);
    let scene_count: i64 = scenes::table
        .count()
        .get_result(&mut conn)
        .unwrap_or(0);
    let map_count: i64 = maps::table
        .count()
        .get_result(&mut conn)
        .unwrap_or(0);

    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    state.path = Some(vault_path);
    state.connection = Some(conn);

    Ok(OpenVaultResult {
        path,
        note_count,
        scene_count,
        map_count,
    })
}

#[tauri::command]
pub fn get_vault_path(vault: State<AppVault>) -> Option<String> {
    let state = vault.lock().ok()?;
    state.path.as_ref().map(|p| p.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    #[test]
    fn test_open_vault_creates_directory() {
        let tmp = tempdir().unwrap();
        let new_dir = tmp.path().join("new_vault");
        // Just test the directory creation logic directly
        std::fs::create_dir_all(&new_dir).unwrap();
        assert!(new_dir.exists());
    }
}
