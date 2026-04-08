use diesel::dsl::sql;
use diesel::prelude::*;
use diesel::sql_types::Integer;
use std::path::PathBuf;
use tauri::State;

use crate::db::models::{NewScene, NewSceneSlot, Scene, SceneSlot, SceneWithCount, UpdateScene, UpdateSceneSlot};
use crate::db::schema::{scene_slots, scenes};
use crate::vault::AppVault;

#[tauri::command]
pub fn get_scenes(vault: State<AppVault>) -> Result<Vec<Scene>, String> {
    let mut state = vault.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    scenes::table
        .order(scenes::id.asc())
        .load::<Scene>(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_scene(name: String, vault: State<AppVault>) -> Result<Scene, String> {
    let mut state = vault.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    diesel::insert_into(scenes::table)
        .values(NewScene { name })
        .returning(Scene::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_scene(id: i32, name: String, vault: State<AppVault>) -> Result<Scene, String> {
    let mut state = vault.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    diesel::update(scenes::table.find(id))
        .set(UpdateScene { name })
        .returning(Scene::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_scene(id: i32, vault: State<AppVault>) -> Result<(), String> {
    let mut state = vault.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    diesel::delete(scenes::table.find(id))
        .execute(conn)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_scene_favorite(id: i32, vault: State<AppVault>) -> Result<(), String> {
    let mut state = vault.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    diesel::update(scenes::table.find(id))
        .set(scenes::favorited.eq(sql::<Integer>("1 - favorited")))
        .execute(conn)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_scenes_with_slot_counts(vault: State<AppVault>) -> Result<Vec<SceneWithCount>, String> {
    let mut state = vault.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    diesel::sql_query(
        "SELECT s.id, s.name, s.favorited, s.created_at, COUNT(ss.id) AS slot_count \
         FROM scenes s \
         LEFT JOIN scene_slots ss ON ss.scene_id = s.id \
         GROUP BY s.id \
         ORDER BY s.id ASC"
    )
    .load::<SceneWithCount>(conn)
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_scene_slots(scene_id: i32, vault: State<AppVault>) -> Result<Vec<SceneSlot>, String> {
    let mut state = vault.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    scene_slots::table
        .filter(scene_slots::scene_id.eq(scene_id))
        .order(scene_slots::slot_order.asc())
        .load::<SceneSlot>(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_scene_slot(
    scene_id: i32,
    source: String,
    source_id: String,
    label: String,
    volume: f64,
    loop_: bool,
    slot_order: i32,
    shuffle: bool,
    vault: State<AppVault>,
) -> Result<SceneSlot, String> {
    let mut state = vault.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    diesel::insert_into(scene_slots::table)
        .values(NewSceneSlot {
            scene_id,
            source,
            source_id,
            label,
            volume: volume as f32,
            is_loop: loop_ as i32,
            slot_order,
            shuffle: shuffle as i32,
        })
        .returning(SceneSlot::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_scene_slot(
    id: i32,
    label: String,
    volume: f64,
    loop_: bool,
    slot_order: i32,
    shuffle: bool,
    vault: State<AppVault>,
) -> Result<SceneSlot, String> {
    let mut state = vault.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    diesel::update(scene_slots::table.find(id))
        .set(UpdateSceneSlot {
            label,
            volume: volume as f32,
            is_loop: loop_ as i32,
            slot_order,
            shuffle: shuffle as i32,
        })
        .returning(SceneSlot::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_scene_slot(id: i32, vault: State<AppVault>) -> Result<(), String> {
    let mut state = vault.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    diesel::delete(scene_slots::table.find(id))
        .execute(conn)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_scene_slots(
    scene_id: i32,
    ordered_ids: Vec<i32>,
    vault: State<AppVault>,
) -> Result<(), String> {
    let mut state = vault.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
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
pub fn copy_audio_file(absolute_path: String, vault: State<AppVault>) -> Result<String, String> {
    let src = PathBuf::from(&absolute_path);
    let file_name = src
        .file_name()
        .ok_or("Invalid file path")?
        .to_string_lossy()
        .to_string();

    // Brief lock: resolve conflict-free destination path while holding lock,
    // then drop before the expensive fs::copy. Matches spec's split-lock pattern.
    let (dest, relative) = {
        let state = vault.lock().map_err(|e| e.to_string())?;
        let vault_path = state.path.as_ref().ok_or("No vault open")?;
        let audio_dir = vault_path.join("audio");
        std::fs::create_dir_all(&audio_dir).map_err(|e| e.to_string())?;
        let dest = resolve_audio_filename(&audio_dir, &file_name);
        let relative = format!("audio/{}", dest.file_name().unwrap().to_string_lossy());
        (dest, relative)
    }; // lock dropped here — fs::copy runs without holding mutex

    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(relative)
}

// Naming matches maps.rs: "stem counter.ext" (no parentheses), e.g. "forest 2.mp3"
pub fn resolve_audio_filename(audio_dir: &PathBuf, file_name: &str) -> PathBuf {
    let stem = PathBuf::from(file_name)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let ext = PathBuf::from(file_name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let candidate = audio_dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let mut counter = 2u32;
    loop {
        let path = audio_dir.join(format!("{} {}{}", stem, counter, ext));
        if !path.exists() {
            return path;
        }
        counter += 1;
    }
}

#[tauri::command]
pub fn get_audio_absolute_path(
    relative_path: String,
    vault: State<AppVault>,
) -> Result<String, String> {
    let state = vault.lock().map_err(|e| e.to_string())?;
    let vault_path = state.path.as_ref().ok_or("No vault open")?;
    vault_path
        .join(&relative_path)
        .to_str()
        .map(|s| s.to_string())
        .ok_or("Path contains invalid UTF-8".to_string())
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
                is_loop: 1,
                slot_order: 0,
                shuffle: 0,
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
            is_loop: 1,
            slot_order: order,
            shuffle: 0,
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
    fn test_resolve_audio_filename_no_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let result = resolve_audio_filename(&dir.path().to_path_buf(), "forest.mp3");
        assert_eq!(result, dir.path().join("forest.mp3"));
    }

    #[test]
    fn test_resolve_audio_filename_one_conflict() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("forest.mp3"), b"").unwrap();
        let result = resolve_audio_filename(&dir.path().to_path_buf(), "forest.mp3");
        // Matches maps.rs convention: "stem counter" (no parentheses)
        assert_eq!(result, dir.path().join("forest 2.mp3"));
    }

    #[test]
    fn test_resolve_audio_filename_multi_conflict() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("forest.mp3"), b"").unwrap();
        std::fs::write(dir.path().join("forest 2.mp3"), b"").unwrap();
        std::fs::write(dir.path().join("forest 3.mp3"), b"").unwrap();
        let result = resolve_audio_filename(&dir.path().to_path_buf(), "forest.mp3");
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
                    is_loop: 1,
                    slot_order: i,
                    shuffle: 0,
                })
                .execute(&mut conn)
                .unwrap();
        }
        let results: Vec<crate::db::models::SceneWithCount> = diesel::sql_query(
            "SELECT s.id, s.name, s.favorited, s.created_at, COUNT(ss.id) AS slot_count \
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
}
