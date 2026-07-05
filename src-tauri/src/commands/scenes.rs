use diesel::dsl::sql;
use diesel::prelude::*;
use diesel::sql_types::Integer;
use std::path::{Path, PathBuf};
use tauri::State;

use crate::db::models::{NewScene, NewSceneSlot, Scene, SceneSlot, SceneWithCount, UpdateScene, UpdateSceneSlot, UpdateSceneThumbnail};
use crate::db::schema::{scene_slots, scenes};
use crate::ledger::AppLedger;

/// Validates that `relative` resolves to a path inside `ledger_root`.
/// Both sides are canonicalized so the starts_with check works correctly on Windows
/// (where canonicalize returns \\?\ extended-length paths).
fn validate_path(ledger_root: &Path, relative: &str) -> Result<PathBuf, String> {
    let canonical_root = ledger_root
        .canonicalize()
        .map_err(|e| format!("Invalid ledger root: {e}"))?;
    let joined = ledger_root.join(relative);
    let canonical = joined
        .canonicalize()
        .map_err(|e| format!("Invalid path: {e}"))?;
    if !canonical.starts_with(&canonical_root) {
        return Err("Path escapes ledger root".to_string());
    }
    Ok(canonical)
}

#[tauri::command]
#[specta::specta]
pub fn get_scenes(ledger: State<AppLedger>) -> Result<Vec<Scene>, String> {
    let mut state = ledger.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    scenes::table
        .order(scenes::id.asc())
        .load::<Scene>(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn create_scene(name: String, ledger: State<AppLedger>) -> Result<Scene, String> {
    let mut state = ledger.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    let created: Scene = diesel::insert_into(scenes::table)
        .values(NewScene { name })
        .returning(Scene::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())?;

    if let Some(index) = &state.search_index {
        let _ = crate::search::index_scene(index, &created);
    }

    Ok(created)
}

#[tauri::command]
#[specta::specta]
pub fn update_scene(id: i32, name: String, ledger: State<AppLedger>) -> Result<Scene, String> {
    let mut state = ledger.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    let updated: Scene = diesel::update(scenes::table.find(id))
        .set(UpdateScene { name })
        .returning(Scene::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())?;

    if let Some(index) = &state.search_index {
        let _ = crate::search::index_scene(index, &updated);
    }

    Ok(updated)
}

#[tauri::command]
#[specta::specta]
pub fn delete_scene(id: i32, ledger: State<AppLedger>) -> Result<(), String> {
    let mut state = ledger.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    diesel::delete(scenes::table.find(id))
        .execute(conn)
        .map_err(|e| e.to_string())?;

    if let Some(index) = &state.search_index {
        let _ = crate::search::remove_scene(index, id);
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn toggle_scene_favorite(id: i32, ledger: State<AppLedger>) -> Result<(), String> {
    let mut state = ledger.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    diesel::update(scenes::table.find(id))
        .set(scenes::favorited.eq(sql::<Integer>("1 - favorited")))
        .execute(conn)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn get_scenes_with_slot_counts(ledger: State<AppLedger>) -> Result<Vec<SceneWithCount>, String> {
    let mut state = ledger.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    diesel::sql_query(
        "SELECT s.id, s.name, s.favorited, s.created_at, COUNT(ss.id) AS slot_count, \
         s.thumbnail_path, s.thumbnail_color, s.thumbnail_icon \
         FROM scenes s \
         LEFT JOIN scene_slots ss ON ss.scene_id = s.id \
         GROUP BY s.id \
         ORDER BY s.id ASC"
    )
    .load::<SceneWithCount>(conn)
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn get_scene_slots(scene_id: i32, ledger: State<AppLedger>) -> Result<Vec<SceneSlot>, String> {
    let mut state = ledger.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    scene_slots::table
        .filter(scene_slots::scene_id.eq(scene_id))
        .order(scene_slots::slot_order.asc())
        .load::<SceneSlot>(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn create_scene_slot(
    scene_id: i32,
    source: String,
    source_id: String,
    label: String,
    volume: f64,
    loop_: bool,
    slot_order: i32,
    shuffle: bool,
    ledger: State<AppLedger>,
) -> Result<SceneSlot, String> {
    let mut state = ledger.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    diesel::insert_into(scene_slots::table)
        .values(NewSceneSlot {
            scene_id,
            source,
            source_id,
            label,
            volume: volume as f32,
            is_loop: loop_,
            slot_order,
            shuffle,
        })
        .returning(SceneSlot::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn update_scene_slot(
    id: i32,
    label: String,
    volume: f64,
    loop_: bool,
    slot_order: i32,
    shuffle: bool,
    ledger: State<AppLedger>,
) -> Result<SceneSlot, String> {
    let mut state = ledger.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    diesel::update(scene_slots::table.find(id))
        .set(UpdateSceneSlot {
            label,
            volume: volume as f32,
            is_loop: loop_,
            slot_order,
            shuffle,
        })
        .returning(SceneSlot::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn delete_scene_slot(id: i32, ledger: State<AppLedger>) -> Result<(), String> {
    let mut state = ledger.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    diesel::delete(scene_slots::table.find(id))
        .execute(conn)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn reorder_scene_slots(
    scene_id: i32,
    ordered_ids: Vec<i32>,
    ledger: State<AppLedger>,
) -> Result<(), String> {
    let mut state = ledger.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    conn.transaction(|conn| {
        for (order, &slot_id) in ordered_ids.iter().enumerate() {
            diesel::update(
                scene_slots::table
                    .filter(scene_slots::id.eq(slot_id))
                    .filter(scene_slots::scene_id.eq(scene_id)),
            )
            .set(scene_slots::slot_order.eq(order as i32))
            .execute(conn)?;
        }
        Ok(())
    })
    .map_err(|e: diesel::result::Error| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn copy_audio_file(absolute_path: String, ledger: State<AppLedger>) -> Result<String, String> {
    let src = PathBuf::from(&absolute_path);
    let file_name = src
        .file_name()
        .ok_or("Invalid file path")?
        .to_string_lossy()
        .to_string();

    // Brief lock: resolve conflict-free destination path while holding lock,
    // then drop before the expensive fs::copy. Matches spec's split-lock pattern.
    let (dest, relative) = {
        let state = ledger.lock().map_err(|e| e.to_string())?;
        let ledger_path = state.path.as_ref().ok_or("No ledger open")?;
        let audio_dir = ledger_path.join(".grimoire").join("audio");
        std::fs::create_dir_all(&audio_dir).map_err(|e| e.to_string())?;
        let dest = resolve_filename(&audio_dir, &file_name);
        let dest_name = dest
            .file_name()
            .ok_or("Invalid destination filename")?
            .to_string_lossy();
        let relative = format!(".grimoire/audio/{}", dest_name);
        (dest, relative)
    }; // lock dropped here — fs::copy runs without holding mutex

    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(relative)
}

/// Drag-and-drop sibling of `copy_audio_file`. A file dropped onto the webview
/// (HTML5 drag-drop, `dragDropEnabled: false`) exposes only its bytes, not an OS
/// path, so the front end reads the bytes and hands them here. Writes into the
/// same `.grimoire/audio/` directory and returns the same ledger-relative path,
/// so the add-track flow is identical whether a track is picked or dropped.
#[tauri::command]
#[specta::specta]
pub fn copy_audio_bytes(
    bytes: Vec<u8>,
    file_name: String,
    ledger: State<AppLedger>,
) -> Result<String, String> {
    // Brief lock to resolve a conflict-free destination, then drop before writing.
    let (dest, relative) = {
        let state = ledger.lock().map_err(|e| e.to_string())?;
        let ledger_path = state.path.as_ref().ok_or("No ledger open")?;
        let audio_dir = ledger_path.join(".grimoire").join("audio");
        std::fs::create_dir_all(&audio_dir).map_err(|e| e.to_string())?;
        let dest = resolve_filename(&audio_dir, &file_name);
        let dest_name = dest
            .file_name()
            .ok_or("Invalid destination filename")?
            .to_string_lossy();
        let relative = format!(".grimoire/audio/{}", dest_name);
        (dest, relative)
    }; // lock dropped here — fs::write runs without holding mutex

    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(relative)
}

// "stem counter.ext" convention (no parens), e.g. "forest 2.mp3" — matches maps.rs
fn resolve_filename(dir: &Path, file_name: &str) -> PathBuf {
    let stem = Path::new(file_name)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let ext = Path::new(file_name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let mut counter = 2u32;
    loop {
        let path = dir.join(format!("{} {}{}", stem, counter, ext));
        if !path.exists() {
            return path;
        }
        counter += 1;
    }
}

#[tauri::command]
#[specta::specta]
pub fn get_audio_absolute_path(
    relative_path: String,
    ledger: State<AppLedger>,
) -> Result<String, String> {
    let state = ledger.lock().map_err(|e| e.to_string())?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?;
    let canonical = validate_path(ledger_path, &relative_path)?;
    canonical
        .to_str()
        .map(|s| s.to_string())
        .ok_or("Path contains invalid UTF-8".to_string())
}

#[tauri::command]
#[specta::specta]
pub fn update_scene_thumbnail(
    id: i32,
    thumbnail_path: Option<String>,
    thumbnail_color: Option<String>,
    thumbnail_icon: Option<String>,
    ledger: State<AppLedger>,
) -> Result<Scene, String> {
    let mut state = ledger.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    diesel::update(scenes::table.find(id))
        .set(UpdateSceneThumbnail { thumbnail_path, thumbnail_color, thumbnail_icon })
        .returning(Scene::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn copy_thumbnail_file(absolute_path: String, ledger: State<AppLedger>) -> Result<String, String> {
    let src = PathBuf::from(&absolute_path);
    let file_name = src
        .file_name()
        .ok_or("Invalid file path")?
        .to_string_lossy()
        .to_string();

    let ext_lower = src
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !matches!(ext_lower.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif") {
        return Err("ERR_UNSUPPORTED_IMAGE: Unsupported image format".to_string());
    }

    let (dest, relative) = {
        let state = ledger.lock().map_err(|e| e.to_string())?;
        let ledger_path = state.path.as_ref().ok_or("No ledger open")?;
        let thumb_dir = ledger_path.join(".grimoire").join("thumbnails");
        std::fs::create_dir_all(&thumb_dir).map_err(|e| e.to_string())?;
        let dest = resolve_filename(&thumb_dir, &file_name);
        let dest_name = dest
            .file_name()
            .ok_or("Invalid destination filename")?
            .to_string_lossy();
        let relative = format!(".grimoire/thumbnails/{}", dest_name);
        (dest, relative)
    };

    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(relative)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{models::*, schema::*, MIGRATIONS};
    use diesel_migrations::MigrationHarness;

    fn setup_db() -> SqliteConnection {
        let mut conn = SqliteConnection::establish(":memory:").expect("in-memory DB");
        conn.run_pending_migrations(MIGRATIONS).expect("migrations");
        conn
    }

    #[test]
    fn test_create_and_get_scene() {
        let mut conn = setup_db();
        let scene: Scene = diesel::insert_into(scenes::table)
            .values(NewScene { name: "Tavern Night".to_string() })
            .returning(Scene::as_returning())
            .get_result(&mut conn)
            .unwrap();
        assert_eq!(scene.name, "Tavern Night");
        let all: Vec<Scene> = scenes::table.load(&mut conn).unwrap();
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn test_scene_slot_cascade_delete() {
        let mut conn = setup_db();
        let scene: Scene = diesel::insert_into(scenes::table)
            .values(NewScene { name: "Combat".to_string() })
            .returning(Scene::as_returning())
            .get_result(&mut conn)
            .unwrap();
        diesel::insert_into(scene_slots::table)
            .values(NewSceneSlot {
                scene_id: scene.id,
                source: "local".to_string(),
                source_id: "audio/drums.mp3".to_string(),
                label: "Drums".to_string(),
                volume: 0.8,
                is_loop: true,
                slot_order: 0,
                shuffle: false,
            })
            .execute(&mut conn)
            .unwrap();
        diesel::delete(scenes::table.find(scene.id))
            .execute(&mut conn)
            .unwrap();
        let slots: Vec<SceneSlot> = scene_slots::table.load(&mut conn).unwrap();
        assert!(slots.is_empty(), "slots should cascade-delete with scene");
    }

    #[test]
    fn test_reorder_scene_slots() {
        let mut conn = setup_db();
        let scene: Scene = diesel::insert_into(scenes::table)
            .values(NewScene { name: "Forest".to_string() })
            .returning(Scene::as_returning())
            .get_result(&mut conn)
            .unwrap();
        let make = |label: &str, order: i32| NewSceneSlot {
            scene_id: scene.id,
            source: "local".to_string(),
            source_id: format!("audio/{}.mp3", label),
            label: label.to_string(),
            volume: 0.8,
            is_loop: true,
            slot_order: order,
            shuffle: false,
        };
        let a: SceneSlot = diesel::insert_into(scene_slots::table)
            .values(make("birds", 0))
            .returning(SceneSlot::as_returning())
            .get_result(&mut conn)
            .unwrap();
        let b: SceneSlot = diesel::insert_into(scene_slots::table)
            .values(make("wind", 1))
            .returning(SceneSlot::as_returning())
            .get_result(&mut conn)
            .unwrap();
        conn.transaction(|conn| {
            for (order, &id) in [b.id, a.id].iter().enumerate() {
                diesel::update(scene_slots::table.find(id))
                    .set(scene_slots::slot_order.eq(order as i32))
                    .execute(conn)?;
            }
            Ok::<(), diesel::result::Error>(())
        })
        .unwrap();
        let slots: Vec<SceneSlot> = scene_slots::table
            .filter(scene_slots::scene_id.eq(scene.id))
            .order(scene_slots::slot_order.asc())
            .load(&mut conn)
            .unwrap();
        assert_eq!(slots[0].label, "wind");
        assert_eq!(slots[1].label, "birds");
    }

    #[test]
    fn test_resolve_filename_no_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let result = resolve_filename(dir.path(), "forest.mp3");
        assert_eq!(result, dir.path().join("forest.mp3"));
    }

    #[test]
    fn test_resolve_filename_one_conflict() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("forest.mp3"), b"").unwrap();
        let result = resolve_filename(dir.path(), "forest.mp3");
        assert_eq!(result, dir.path().join("forest 2.mp3"));
    }

    #[test]
    fn test_resolve_filename_multi_conflict() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("forest.mp3"), b"").unwrap();
        std::fs::write(dir.path().join("forest 2.mp3"), b"").unwrap();
        std::fs::write(dir.path().join("forest 3.mp3"), b"").unwrap();
        let result = resolve_filename(dir.path(), "forest.mp3");
        assert_eq!(result, dir.path().join("forest 4.mp3"));
    }

    #[test]
    fn test_toggle_scene_favorite() {
        let mut conn = setup_db();
        let scene: Scene = diesel::insert_into(scenes::table)
            .values(NewScene { name: "Dungeon".to_string() })
            .returning(Scene::as_returning())
            .get_result(&mut conn)
            .unwrap();
        assert_eq!(scene.favorited, 0);

        // First toggle: 0 → 1
        use diesel::dsl::sql;
        use diesel::sql_types::Integer;
        diesel::update(scenes::table.find(scene.id))
            .set(scenes::favorited.eq(sql::<Integer>("1 - favorited")))
            .execute(&mut conn)
            .unwrap();
        let updated: Scene = scenes::table.find(scene.id).first(&mut conn).unwrap();
        assert_eq!(updated.favorited, 1);

        // Second toggle: 1 → 0
        diesel::update(scenes::table.find(scene.id))
            .set(scenes::favorited.eq(sql::<Integer>("1 - favorited")))
            .execute(&mut conn)
            .unwrap();
        let reverted: Scene = scenes::table.find(scene.id).first(&mut conn).unwrap();
        assert_eq!(reverted.favorited, 0);
    }

    #[test]
    fn test_get_scenes_with_slot_counts() {
        let mut conn = setup_db();
        let scene_a: Scene = diesel::insert_into(scenes::table)
            .values(NewScene { name: "Forest".to_string() })
            .returning(Scene::as_returning())
            .get_result(&mut conn)
            .unwrap();
        let _scene_b: Scene = diesel::insert_into(scenes::table)
            .values(NewScene { name: "Tavern".to_string() })
            .returning(Scene::as_returning())
            .get_result(&mut conn)
            .unwrap();
        // Add 2 slots to scene_a, 0 to scene_b
        for i in 0..2 {
            diesel::insert_into(scene_slots::table)
                .values(NewSceneSlot {
                    scene_id: scene_a.id,
                    source: "local".to_string(),
                    source_id: format!("audio/track{}.mp3", i),
                    label: format!("Track {}", i),
                    volume: 0.8,
                    is_loop: true,
                    slot_order: i,
                    shuffle: false,
                })
                .execute(&mut conn)
                .unwrap();
        }
        let results: Vec<crate::db::models::SceneWithCount> = diesel::sql_query(
            "SELECT s.id, s.name, s.favorited, s.created_at, COUNT(ss.id) AS slot_count, \
             s.thumbnail_path, s.thumbnail_color, s.thumbnail_icon \
             FROM scenes s \
             LEFT JOIN scene_slots ss ON ss.scene_id = s.id \
             GROUP BY s.id ORDER BY s.id ASC"
        )
        .load(&mut conn)
        .unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].name, "Forest");
        assert_eq!(results[0].slot_count, 2);
        assert_eq!(results[1].name, "Tavern");
        assert_eq!(results[1].slot_count, 0);
    }

    #[test]
    fn test_thumbnail_round_trip() {
        let mut conn = setup_db();
        let scene: Scene = diesel::insert_into(scenes::table)
            .values(NewScene { name: "Mystic Glade".to_string() })
            .returning(Scene::as_returning())
            .get_result(&mut conn)
            .unwrap();
        assert!(scene.thumbnail_path.is_none());
        assert!(scene.thumbnail_color.is_none());
        assert!(scene.thumbnail_icon.is_none());

        let updated: Scene = diesel::update(scenes::table.find(scene.id))
            .set(UpdateSceneThumbnail {
                thumbnail_path: Some(".grimoire/thumbnails/glade.webp".to_string()),
                thumbnail_color: Some("crimson".to_string()),
                thumbnail_icon: Some("tree-pine".to_string()),
            })
            .returning(Scene::as_returning())
            .get_result(&mut conn)
            .unwrap();
        assert_eq!(updated.thumbnail_path.as_deref(), Some(".grimoire/thumbnails/glade.webp"));
        assert_eq!(updated.thumbnail_color.as_deref(), Some("crimson"));
        assert_eq!(updated.thumbnail_icon.as_deref(), Some("tree-pine"));

        // Clearing fields with null
        let cleared: Scene = diesel::update(scenes::table.find(scene.id))
            .set(UpdateSceneThumbnail {
                thumbnail_path: None,
                thumbnail_color: None,
                thumbnail_icon: None,
            })
            .returning(Scene::as_returning())
            .get_result(&mut conn)
            .unwrap();
        assert!(cleared.thumbnail_path.is_none());
        assert!(cleared.thumbnail_color.is_none());
        assert!(cleared.thumbnail_icon.is_none());
    }

    #[test]
    fn test_scenes_with_slot_counts_includes_thumbnail_fields() {
        let mut conn = setup_db();
        let scene: Scene = diesel::insert_into(scenes::table)
            .values(NewScene { name: "Dragon Lair".to_string() })
            .returning(Scene::as_returning())
            .get_result(&mut conn)
            .unwrap();
        diesel::update(scenes::table.find(scene.id))
            .set(UpdateSceneThumbnail {
                thumbnail_path: Some(".grimoire/thumbnails/lair.webp".to_string()),
                thumbnail_color: Some("ember".to_string()),
                thumbnail_icon: None,
            })
            .execute(&mut conn)
            .unwrap();

        let results: Vec<crate::db::models::SceneWithCount> = diesel::sql_query(
            "SELECT s.id, s.name, s.favorited, s.created_at, COUNT(ss.id) AS slot_count, \
             s.thumbnail_path, s.thumbnail_color, s.thumbnail_icon \
             FROM scenes s \
             LEFT JOIN scene_slots ss ON ss.scene_id = s.id \
             GROUP BY s.id ORDER BY s.id ASC"
        )
        .load(&mut conn)
        .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].thumbnail_path.as_deref(), Some(".grimoire/thumbnails/lair.webp"));
        assert_eq!(results[0].thumbnail_color.as_deref(), Some("ember"));
        assert!(results[0].thumbnail_icon.is_none());
    }

}
