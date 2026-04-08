use crate::db::models::{Map, NewMap, Pin, NewPin, PinCategory, NewPinCategory};
use crate::db::schema::{maps, pin_categories, pins};
use crate::vault::AppVault;
use base64::Engine;
use diesel::prelude::*;
use std::fs;
use std::path::Path;
use tauri::State;

// ── Helpers ──────────────────────────────────────────────────────────────────

fn resolve_map_filename(base_name: &str, ext: &str, parent_dir: &Path) -> (String, std::path::PathBuf) {
    let mut name = base_name.to_string();
    let mut counter = 2u32;
    loop {
        let filename = format!("{}.{}", name, ext);
        let full = parent_dir.join(&filename);
        if !full.exists() {
            return (name, full);
        }
        name = format!("{} {}", base_name, counter);
        counter += 1;
    }
}

// ── Map commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn create_map(
    title: String,
    source_image_path: String,
    dest_path: String,
    vault: State<AppVault>,
) -> Result<Map, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.clone().ok_or("No vault open")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;

    let source = std::path::Path::new(&source_image_path);
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();

    let initial_dest = vault_path.join(&dest_path);
    let parent_dir = initial_dest.parent().ok_or("Cannot determine parent directory")?;
    fs::create_dir_all(parent_dir).map_err(|e| e.to_string())?;

    let (_, dest_full) = resolve_map_filename(&title, &ext, parent_dir);
    fs::copy(&source_image_path, &dest_full).map_err(|e| e.to_string())?;

    let (img_width, img_height) =
        image::image_dimensions(&dest_full).map_err(|e| e.to_string())?;

    let resolved_path = dest_full
        .strip_prefix(&vault_path)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    let new_map = NewMap {
        title: &title,
        image_path: &resolved_path,
        image_width: img_width as i32,
        image_height: img_height as i32,
    };

    diesel::insert_into(maps::table)
        .values(&new_map)
        .returning(Map::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_maps(vault: State<AppVault>) -> Result<Vec<Map>, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    maps::table.load::<Map>(conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_map(map: Map, vault: State<AppVault>) -> Result<Map, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    diesel::update(maps::table.find(map.id))
        .set(&map)
        .returning(Map::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_map(map_id: i32, vault: State<AppVault>) -> Result<usize, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.clone().ok_or("No vault open")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;

    let m: Map = maps::table.find(map_id).first(conn).map_err(|e| e.to_string())?;
    let full_path = vault_path.join(&m.image_path);
    if full_path.exists() {
        fs::remove_file(&full_path).map_err(|e| e.to_string())?;
    }
    diesel::delete(maps::table.find(map_id))
        .execute(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_map_image_data_url(map_id: i32, vault: State<AppVault>) -> Result<String, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.clone().ok_or("No vault open")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;

    let m: Map = maps::table.find(map_id).first(conn).map_err(|e| e.to_string())?;
    let full_path = vault_path.join(&m.image_path);
    let bytes = fs::read(&full_path).map_err(|e| e.to_string())?;

    let ext = Path::new(&m.image_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/png",
    };

    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

// ── Pin commands ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_pins(map_id: i32, vault: State<AppVault>) -> Result<Vec<Pin>, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    pins::table
        .filter(pins::map_id.eq(map_id))
        .load::<Pin>(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_pin(
    map_id: i32,
    x: f32,
    y: f32,
    title: String,
    description: Option<String>,
    category_id: Option<i32>,
    note_id: Option<i32>,
    vault: State<AppVault>,
) -> Result<Pin, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    let new_pin = NewPin {
        map_id,
        x,
        y,
        title: &title,
        description: description.as_deref(),
        category_id,
        note_id,
    };
    diesel::insert_into(pins::table)
        .values(&new_pin)
        .returning(Pin::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_pin(pin: Pin, vault: State<AppVault>) -> Result<Pin, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    diesel::update(pins::table.find(pin.id))
        .set(&pin)
        .returning(Pin::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_pin(pin_id: i32, vault: State<AppVault>) -> Result<usize, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    diesel::delete(pins::table.find(pin_id))
        .execute(conn)
        .map_err(|e| e.to_string())
}

// ── Category commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_pin_categories(vault: State<AppVault>) -> Result<Vec<PinCategory>, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    pin_categories::table
        .load::<PinCategory>(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_pin_category(
    map_id: Option<i32>,
    name: String,
    icon: String,
    color: String,
    vault: State<AppVault>,
) -> Result<PinCategory, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    let new_cat = NewPinCategory {
        map_id,
        name: &name,
        icon: &icon,
        color: &color,
    };
    diesel::insert_into(pin_categories::table)
        .values(&new_cat)
        .returning(PinCategory::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_pin_category(category: PinCategory, vault: State<AppVault>) -> Result<PinCategory, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    diesel::update(pin_categories::table.find(category.id))
        .set(&category)
        .returning(PinCategory::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_pin_category(category_id: i32, vault: State<AppVault>) -> Result<usize, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    diesel::delete(pin_categories::table.find(category_id))
        .execute(conn)
        .map_err(|e| e.to_string())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::resolve_map_filename;
    use std::fs;

    #[test]
    fn no_conflict_returns_original_name() {
        let dir = tempfile::tempdir().unwrap();
        let (name, path) = resolve_map_filename("World Map", "jpg", dir.path());
        assert_eq!(name, "World Map");
        assert_eq!(path, dir.path().join("World Map.jpg"));
    }

    #[test]
    fn one_conflict_appends_counter() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("World Map.jpg"), "").unwrap();
        let (name, path) = resolve_map_filename("World Map", "jpg", dir.path());
        assert_eq!(name, "World Map 2");
        assert_eq!(path, dir.path().join("World Map 2.jpg"));
    }

    #[test]
    fn multiple_conflicts_increments_correctly() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("World Map.jpg"), "").unwrap();
        fs::write(dir.path().join("World Map 2.jpg"), "").unwrap();
        let (name, _) = resolve_map_filename("World Map", "jpg", dir.path());
        assert_eq!(name, "World Map 3");
    }
}
