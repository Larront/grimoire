use crate::db::models::{Map, NewMap, AssignImageChangeset, MapAnnotation, NewMapAnnotation, Pin, NewPin, PinCategory, NewPinCategory};
use crate::db::schema::{map_annotations, maps, pin_categories, pins};
use crate::ledger::AppLedger;
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

/// Move a map's image file into `dest_folder` (`""` = the ledger root), keeping
/// its filename — the map half of a [[Tree Move]]. Returns the new
/// ledger-relative image path.
///
/// A map is addressed in the Files tree by its image file, so moving the node
/// means moving that file. Unlike a [[PDF]] move, a name already taken in the
/// destination is **deduplicated rather than refused** (`Coast.png` → `Coast
/// 2.png`, the convention `resolve_map_filename` already uses): the tree shows a
/// map's *title*, never its filename, so a collision here is bookkeeping the GM
/// cannot see and could not act on.
///
/// `image_path` comes from the map's own row rather than the frontend, so it
/// needs no traversal guard; `dest_folder` arrives from a drop target and does.
pub fn move_map_image_inner(
    ledger_path: &Path,
    image_path: &str,
    dest_folder: &str,
) -> Result<String, String> {
    use crate::commands::media::{file_name_of, join_in_folder, validate_dest_folder};

    let dest_dir = validate_dest_folder(ledger_path, dest_folder)?;
    let file_name = file_name_of(image_path);

    // A drop onto the folder the image already sits in is nothing at all — and
    // must not fall through to the dedup below, which would rename it to
    // `Coast 2.png` for no reason.
    if join_in_folder(dest_folder, file_name) == image_path {
        return Ok(image_path.to_string());
    }

    let as_path = Path::new(file_name);
    let stem = as_path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Map image has no filename")?;
    let ext = as_path
        .extension()
        .and_then(|e| e.to_str())
        .ok_or("Map image has no extension")?;

    let (resolved_stem, dest_full) = resolve_map_filename(stem, ext, &dest_dir);
    fs::rename(ledger_path.join(image_path), &dest_full)
        .map_err(|e| format!("move map image: {}", e))?;

    Ok(join_in_folder(
        dest_folder,
        &format!("{}.{}", resolved_stem, ext),
    ))
}

#[tauri::command]
#[specta::specta]
pub fn move_map(map_id: i32, dest_folder: String, ledger: State<AppLedger>) -> Result<Map, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.clone().ok_or("No ledger open")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;

    let m: Map = maps::table
        .find(map_id)
        .first(conn)
        .map_err(|e| e.to_string())?;
    // A map with no image has no row in the Files tree to drag, so this is
    // unreachable from the tree — it is still worth refusing plainly.
    let image_path = m.image_path.ok_or("This map has no image to move")?;

    let new_image_path = move_map_image_inner(&ledger_path, &image_path, &dest_folder)?;
    if new_image_path == image_path {
        return maps::table.find(map_id).first(conn).map_err(|e| e.to_string());
    }

    let modified_at = Utc::now().to_rfc3339();
    diesel::update(maps::table.find(map_id))
        .set((
            maps::image_path.eq(&new_image_path),
            maps::modified_at.eq(&modified_at),
        ))
        .returning(Map::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

// ── Map commands ─────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn create_map(
    title: String,
    source_image_path: String,
    dest_path: String,
    ledger: State<AppLedger>,
) -> Result<Map, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.clone().ok_or("No ledger open")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;

    let source = std::path::Path::new(&source_image_path);
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();

    let initial_dest = ledger_path.join(&dest_path);
    let parent_dir = initial_dest.parent().ok_or("Cannot determine parent directory")?;
    fs::create_dir_all(parent_dir).map_err(|e| e.to_string())?;

    let (_, dest_full) = resolve_map_filename(&title, &ext, parent_dir);
    fs::copy(&source_image_path, &dest_full).map_err(|e| e.to_string())?;

    let (img_width, img_height) =
        image::image_dimensions(&dest_full).map_err(|e| e.to_string())?;

    let resolved_path = dest_full
        .strip_prefix(&ledger_path)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    let new_map = NewMap {
        title: &title,
        image_path: Some(&resolved_path),
        image_width: Some(img_width as i32),
        image_height: Some(img_height as i32),
    };

    let created: Map = diesel::insert_into(maps::table)
        .values(&new_map)
        .returning(Map::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())?;

    if let Some(index) = &state.search_index {
        let _ = crate::search::index_map(index, &created);
    }

    Ok(created)
}

#[tauri::command]
#[specta::specta]
pub fn create_map_empty(title: String, ledger: State<AppLedger>) -> Result<Map, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;

    let new_map = NewMap {
        title: &title,
        image_path: None,
        image_width: None,
        image_height: None,
    };

    let created: Map = diesel::insert_into(maps::table)
        .values(&new_map)
        .returning(Map::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())?;

    if let Some(index) = &state.search_index {
        let _ = crate::search::index_map(index, &created);
    }

    Ok(created)
}

#[tauri::command]
#[specta::specta]
pub fn assign_map_image(
    map_id: i32,
    source_image_path: String,
    dest_folder: Option<String>,
    ledger: State<AppLedger>,
) -> Result<Map, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.clone().ok_or("No ledger open")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;

    let m: Map = maps::table.find(map_id).first(conn).map_err(|e| e.to_string())?;

    // Clean up existing image file if one is already assigned
    if let Some(ref old_ip) = m.image_path {
        let old_full = ledger_path.join(old_ip);
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
            let dir = ledger_path.join(folder);
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            dir
        }
        None => ledger_path.clone(),
    };
    let (_, dest_full) = resolve_map_filename(&m.title, &ext, &dest_dir);
    fs::copy(&source_image_path, &dest_full).map_err(|e| e.to_string())?;

    let (img_width, img_height) =
        image::image_dimensions(&dest_full).map_err(|e| e.to_string())?;

    let resolved_path = dest_full
        .strip_prefix(&ledger_path)
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
#[specta::specta]
pub fn get_maps(ledger: State<AppLedger>) -> Result<Vec<Map>, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    maps::table.load::<Map>(conn).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn update_map(map: Map, ledger: State<AppLedger>) -> Result<Map, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    let updated: Map = diesel::update(maps::table.find(map.id))
        .set(&map)
        .returning(Map::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())?;

    if let Some(index) = &state.search_index {
        let _ = crate::search::index_map(index, &updated);
    }

    Ok(updated)
}

#[tauri::command]
#[specta::specta]
pub fn delete_map(map_id: i32, ledger: State<AppLedger>) -> Result<u32, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.clone().ok_or("No ledger open")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;

    let m: Map = maps::table.find(map_id).first(conn).map_err(|e| e.to_string())?;
    if let Some(ref ip) = m.image_path {
        let full_path = ledger_path.join(ip);
        if full_path.exists() {
            fs::remove_file(&full_path).map_err(|e| e.to_string())?;
        }
    }
    let deleted = diesel::delete(maps::table.find(map_id))
        .execute(conn)
        .map_err(|e| e.to_string())?;

    if let Some(index) = &state.search_index {
        let _ = crate::search::remove_map(index, map_id);
    }

    Ok(deleted as u32)
}

#[tauri::command]
#[specta::specta]
pub fn get_map_image_data_url(map_id: i32, ledger: State<AppLedger>) -> Result<String, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.clone().ok_or("No ledger open")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;

    let m: Map = maps::table.find(map_id).first(conn).map_err(|e| e.to_string())?;
    let image_path = m.image_path.ok_or("Map has no image assigned")?;
    let full_path = ledger_path.join(&image_path);
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
#[specta::specta]
pub fn get_pins(map_id: i32, ledger: State<AppLedger>) -> Result<Vec<Pin>, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    pins::table
        .filter(pins::map_id.eq(map_id))
        .load::<Pin>(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn create_pin(
    map_id: i32,
    x: f32,
    y: f32,
    title: String,
    description: Option<String>,
    category_id: Option<i32>,
    note_id: Option<i32>,
    ledger: State<AppLedger>,
) -> Result<Pin, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
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
#[specta::specta]
pub fn update_pin(pin: Pin, ledger: State<AppLedger>) -> Result<Pin, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    diesel::update(pins::table.find(pin.id))
        .set(&pin)
        .returning(Pin::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn delete_pin(pin_id: i32, ledger: State<AppLedger>) -> Result<u32, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    diesel::delete(pins::table.find(pin_id))
        .execute(conn)
        .map(|n| n as u32)
        .map_err(|e| e.to_string())
}

// ── Category commands ─────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn get_pin_categories(ledger: State<AppLedger>) -> Result<Vec<PinCategory>, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    pin_categories::table
        .load::<PinCategory>(conn)
        .map_err(|e| e.to_string())
}

pub fn get_pin_categories_for_map_from_conn(
    map_id: i32,
    conn: &mut diesel::SqliteConnection,
) -> Result<Vec<PinCategory>, String> {
    pin_categories::table
        .filter(
            pin_categories::map_id
                .eq(map_id)
                .or(pin_categories::map_id.is_null()),
        )
        .load::<PinCategory>(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn get_pin_categories_for_map(
    map_id: i32,
    ledger: State<AppLedger>,
) -> Result<Vec<PinCategory>, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    get_pin_categories_for_map_from_conn(map_id, conn)
}

#[tauri::command]
#[specta::specta]
pub fn create_pin_category(
    map_id: Option<i32>,
    name: String,
    icon: String,
    color: String,
    ledger: State<AppLedger>,
) -> Result<PinCategory, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    let new_cat = NewPinCategory {
        map_id,
        name: &name,
        icon: &icon,
        color: &color,
        // Not the column's `'circle'` default, for the reason the seeded categories avoid it:
        // a circle is anchored on its own centre, so it sits on top of the place it marks.
        // A category made here can be changed to one afterwards — `update_pin_category` takes
        // the whole row, shape included — which is the right way round for a default.
        shape: "pin",
    };
    diesel::insert_into(pin_categories::table)
        .values(&new_cat)
        .returning(PinCategory::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn update_pin_category(category: PinCategory, ledger: State<AppLedger>) -> Result<PinCategory, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    diesel::update(pin_categories::table.find(category.id))
        .set(&category)
        .returning(PinCategory::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn delete_pin_category(category_id: i32, ledger: State<AppLedger>) -> Result<u32, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    diesel::delete(pin_categories::table.find(category_id))
        .execute(conn)
        .map(|n| n as u32)
        .map_err(|e| e.to_string())
}

// ── Annotation commands ───────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn get_annotations(map_id: i32, ledger: State<AppLedger>) -> Result<Vec<MapAnnotation>, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    map_annotations::table
        .filter(map_annotations::map_id.eq(map_id))
        .load::<MapAnnotation>(conn)
        .map_err(|e| e.to_string())
}

// NOTE: not #[specta::specta] — 14 params exceeds tauri-specta's SpectaFn arity
// limit. Carved out of the typed bindings and hand-wrapped in $lib/api (ADR-0009).
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
    ledger: State<AppLedger>,
) -> Result<MapAnnotation, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
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
#[specta::specta]
pub fn update_annotation(annotation: MapAnnotation, ledger: State<AppLedger>) -> Result<MapAnnotation, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    diesel::update(map_annotations::table.find(annotation.id))
        .set(&annotation)
        .returning(MapAnnotation::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn delete_annotation(annotation_id: i32, ledger: State<AppLedger>) -> Result<u32, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    diesel::delete(map_annotations::table.find(annotation_id))
        .execute(conn)
        .map(|n| n as u32)
        .map_err(|e| e.to_string())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::{get_pin_categories_for_map_from_conn, move_map_image_inner, resolve_map_filename};
    use diesel::connection::SimpleConnection;
    use diesel::{Connection, SqliteConnection};
    use std::fs;

    fn cat_test_conn() -> SqliteConnection {
        let mut conn =
            SqliteConnection::establish(":memory:").expect("in-memory db");
        conn.batch_execute(
            "PRAGMA foreign_keys = ON;
            CREATE TABLE pin_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                map_id INTEGER,
                name TEXT NOT NULL,
                icon TEXT NOT NULL DEFAULT 'star',
                color TEXT NOT NULL DEFAULT '#ffffff',
                shape TEXT NOT NULL DEFAULT 'circle'
            );",
        )
        .expect("create pin_categories table");
        conn
    }

    #[test]
    fn get_pin_categories_for_map_returns_map_specific_and_global() {
        let mut conn = cat_test_conn();
        conn.batch_execute(
            "INSERT INTO pin_categories (map_id, name) VALUES
                (5, 'Town'), (NULL, 'Global'), (99, 'Other');",
        )
        .unwrap();
        let cats = get_pin_categories_for_map_from_conn(5, &mut conn).unwrap();
        let names: Vec<&str> = cats.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"Town"), "map-specific category missing");
        assert!(names.contains(&"Global"), "global category missing");
        assert!(!names.contains(&"Other"), "other-map category should be excluded");
    }

    #[test]
    fn get_pin_categories_for_map_returns_only_global_when_no_map_specific() {
        let mut conn = cat_test_conn();
        conn.batch_execute(
            "INSERT INTO pin_categories (map_id, name) VALUES (NULL, 'Global'), (99, 'Other');",
        )
        .unwrap();
        let cats = get_pin_categories_for_map_from_conn(5, &mut conn).unwrap();
        assert_eq!(cats.len(), 1);
        assert_eq!(cats[0].name, "Global");
    }

    #[test]
    fn get_pin_categories_for_map_returns_empty_when_no_matching_categories() {
        let mut conn = cat_test_conn();
        conn.batch_execute(
            "INSERT INTO pin_categories (map_id, name) VALUES (99, 'Other');",
        )
        .unwrap();
        let cats = get_pin_categories_for_map_from_conn(5, &mut conn).unwrap();
        assert!(cats.is_empty());
    }

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

    // ── move_map tests (#163) ─────────────────────────────────────────────────

    #[test]
    fn move_map_image_carries_the_file_into_the_destination_folder() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("World Map.jpg"), "").unwrap();
        fs::create_dir(dir.path().join("territories")).unwrap();

        let new_path =
            move_map_image_inner(dir.path(), "World Map.jpg", "territories").unwrap();

        assert_eq!(new_path, "territories/World Map.jpg");
        assert!(!dir.path().join("World Map.jpg").exists());
        assert!(dir.path().join("territories/World Map.jpg").exists());
    }

    #[test]
    fn move_map_image_to_the_ledger_root_takes_an_empty_destination() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("territories")).unwrap();
        fs::write(dir.path().join("territories/World Map.jpg"), "").unwrap();

        let new_path =
            move_map_image_inner(dir.path(), "territories/World Map.jpg", "").unwrap();

        assert_eq!(new_path, "World Map.jpg");
        assert!(dir.path().join("World Map.jpg").exists());
    }

    #[test]
    fn move_map_image_deduplicates_a_name_the_destination_already_holds() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("World Map.jpg"), "moved").unwrap();
        fs::create_dir(dir.path().join("territories")).unwrap();
        fs::write(dir.path().join("territories/World Map.jpg"), "sitting there").unwrap();

        let new_path =
            move_map_image_inner(dir.path(), "World Map.jpg", "territories").unwrap();

        assert_eq!(
            new_path, "territories/World Map 2.jpg",
            "a filename the GM never sees is deduplicated, not refused",
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("territories/World Map.jpg")).unwrap(),
            "sitting there",
            "the map already there keeps its image",
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("territories/World Map 2.jpg")).unwrap(),
            "moved",
        );
    }

    #[test]
    fn move_map_image_onto_its_current_folder_leaves_the_name_alone() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("territories")).unwrap();
        fs::write(dir.path().join("territories/World Map.jpg"), "").unwrap();

        let new_path =
            move_map_image_inner(dir.path(), "territories/World Map.jpg", "territories")
                .expect("a drop onto the folder it already sits in is a no-op");

        assert_eq!(
            new_path, "territories/World Map.jpg",
            "and must not dedup itself to 'World Map 2.jpg'",
        );
        assert!(dir.path().join("territories/World Map.jpg").exists());
        assert!(!dir.path().join("territories/World Map 2.jpg").exists());
    }

    #[test]
    fn move_map_image_rejects_a_destination_outside_the_ledger() {
        let outer = tempfile::tempdir().unwrap();
        let ledger = outer.path().join("ledger");
        fs::create_dir(&ledger).unwrap();
        fs::create_dir(outer.path().join("elsewhere")).unwrap();
        fs::write(ledger.join("World Map.jpg"), "").unwrap();

        let result = move_map_image_inner(&ledger, "World Map.jpg", "../elsewhere");

        assert!(result.is_err(), "expected a traversal destination to be rejected");
        assert!(ledger.join("World Map.jpg").exists());
        assert!(!outer.path().join("elsewhere/World Map.jpg").exists());
    }
}
