use crate::db::models::{Map, NewMap, AssignImageChangeset, MapAnnotation, NewMapAnnotation, Pin, NewPin, PinCategory, NewPinCategory};
use crate::db::schema::{map_annotations, maps, pin_categories, pins};
use crate::vault::AppVault;
use base64::Engine;
use chrono::Utc;
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
        image_path: Some(&resolved_path),
        image_width: Some(img_width as i32),
        image_height: Some(img_height as i32),
    };

    diesel::insert_into(maps::table)
        .values(&new_map)
        .returning(Map::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_map_empty(title: String, vault: State<AppVault>) -> Result<Map, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;

    let new_map = NewMap {
        title: &title,
        image_path: None,
        image_width: None,
        image_height: None,
    };

    diesel::insert_into(maps::table)
        .values(&new_map)
        .returning(Map::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn assign_map_image(
    map_id: i32,
    source_image_path: String,
    dest_folder: Option<String>,
    vault: State<AppVault>,
) -> Result<Map, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.clone().ok_or("No vault open")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;

    let m: Map = maps::table.find(map_id).first(conn).map_err(|e| e.to_string())?;

    // Clean up existing image file if one is already assigned
    if let Some(ref old_ip) = m.image_path {
        let old_full = vault_path.join(old_ip);
        if old_full.exists() {
            fs::remove_file(&old_full).map_err(|e| e.to_string())?;
        }
    }

    let source = std::path::Path::new(&source_image_path);
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();

    let dest_dir = match dest_folder.as_deref().filter(|s| !s.is_empty()) {
        Some(folder) => {
            let dir = vault_path.join(folder);
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            dir
        }
        None => vault_path.clone(),
    };
    let (_, dest_full) = resolve_map_filename(&m.title, &ext, &dest_dir);
    fs::copy(&source_image_path, &dest_full).map_err(|e| e.to_string())?;

    let (img_width, img_height) =
        image::image_dimensions(&dest_full).map_err(|e| e.to_string())?;

    let resolved_path = dest_full
        .strip_prefix(&vault_path)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    let modified_at = Utc::now().to_rfc3339();

    let changeset = AssignImageChangeset {
        image_path: Some(resolved_path.as_str()),
        image_width: Some(img_width as i32),
        image_height: Some(img_height as i32),
        modified_at: &modified_at,
    };

    diesel::update(maps::table.find(map_id))
        .set(&changeset)
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
    if let Some(ref ip) = m.image_path {
        let full_path = vault_path.join(ip);
        if full_path.exists() {
            fs::remove_file(&full_path).map_err(|e| e.to_string())?;
        }
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
    let image_path = m.image_path.ok_or("Map has no image assigned")?;
    let full_path = vault_path.join(&image_path);
    let bytes = fs::read(&full_path).map_err(|e| e.to_string())?;

    let ext = Path::new(&image_path)
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

// ── Annotation commands ───────────────────────────────────────────────────────

#[tauri::command]
pub fn get_annotations(map_id: i32, vault: State<AppVault>) -> Result<Vec<MapAnnotation>, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    map_annotations::table
        .filter(map_annotations::map_id.eq(map_id))
        .load::<MapAnnotation>(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_annotation(
    map_id: i32,
    kind: String,
    x: f32,
    y: f32,
    x2: Option<f32>,
    y2: Option<f32>,
    radius: Option<f32>,
    label: Option<String>,
    color: String,
    stroke_color: String,
    stroke_width: i32,
    font_size: i32,
    opacity: f32,
    vault: State<AppVault>,
) -> Result<MapAnnotation, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    let new_ann = NewMapAnnotation {
        map_id,
        kind: &kind,
        x,
        y,
        x2,
        y2,
        radius,
        label: label.as_deref(),
        color: &color,
        stroke_color: &stroke_color,
        stroke_width,
        font_size,
        opacity,
    };
    diesel::insert_into(map_annotations::table)
        .values(&new_ann)
        .returning(MapAnnotation::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_annotation(annotation: MapAnnotation, vault: State<AppVault>) -> Result<MapAnnotation, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    diesel::update(map_annotations::table.find(annotation.id))
        .set(&annotation)
        .returning(MapAnnotation::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_annotation(annotation_id: i32, vault: State<AppVault>) -> Result<usize, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    diesel::delete(map_annotations::table.find(annotation_id))
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
