use crate::db::schema::recent_entities::dsl as re;
use crate::ledger::AppLedger;
use chrono::Utc;
use diesel::prelude::*;
use serde::Serialize;
use tauri::State;

#[derive(Queryable, Selectable, Serialize, specta::Type, Debug, Clone)]
#[diesel(table_name = crate::db::schema::recent_entities)]
pub struct RecentEntityResult {
    pub entity_kind: String,
    pub entity_id: i32,
    pub title: String,
    pub accessed_at: String,
}

pub(crate) fn upsert_recent(
    conn: &mut SqliteConnection,
    kind: &str,
    id: i32,
    title: &str,
) -> Result<(), String> {
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    diesel::insert_into(re::recent_entities)
        .values((
            re::entity_kind.eq(kind),
            re::entity_id.eq(id),
            re::title.eq(title),
            re::accessed_at.eq(&now),
        ))
        .on_conflict((re::entity_kind, re::entity_id))
        .do_update()
        .set((re::title.eq(title), re::accessed_at.eq(&now)))
        .execute(conn)
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn trim_recent(conn: &mut SqliteConnection, max: i64) -> Result<(), String> {
    diesel::sql_query(format!(
        "DELETE FROM recent_entities WHERE rowid NOT IN \
         (SELECT rowid FROM recent_entities ORDER BY accessed_at DESC LIMIT {})",
        max
    ))
    .execute(conn)
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn load_recent(
    conn: &mut SqliteConnection,
    limit: i64,
) -> Result<Vec<RecentEntityResult>, String> {
    re::recent_entities
        .order(re::accessed_at.desc())
        .limit(limit)
        .load::<RecentEntityResult>(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn record_recent(
    kind: String,
    id: i32,
    title: String,
    ledger: State<AppLedger>,
) -> Result<(), String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    upsert_recent(conn, &kind, id, &title)?;
    trim_recent(conn, 20)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_recent_entities(ledger: State<AppLedger>) -> Result<Vec<RecentEntityResult>, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    load_recent(conn, 20)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::establish_connection;
    use tempfile::tempdir;

    fn setup_conn() -> (tempfile::TempDir, SqliteConnection) {
        let tmp = tempdir().unwrap();
        let conn = establish_connection(tmp.path()).unwrap();
        (tmp, conn)
    }

    #[test]
    fn record_and_retrieve_single_entity() {
        let (_tmp, mut conn) = setup_conn();
        upsert_recent(&mut conn, "note", 1, "My Note").unwrap();
        let results = load_recent(&mut conn, 20).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].entity_kind, "note");
        assert_eq!(results[0].entity_id, 1);
        assert_eq!(results[0].title, "My Note");
    }

    #[test]
    fn cross_entity_intermingled_mru_order() {
        let (_tmp, mut conn) = setup_conn();
        upsert_recent(&mut conn, "note", 1, "First Note").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        upsert_recent(&mut conn, "map", 2, "Second Map").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        upsert_recent(&mut conn, "scene", 3, "Third Scene").unwrap();

        let results = load_recent(&mut conn, 20).unwrap();
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].entity_kind, "scene");
        assert_eq!(results[1].entity_kind, "map");
        assert_eq!(results[2].entity_kind, "note");
    }

    #[test]
    fn re_recording_entity_moves_it_to_top() {
        let (_tmp, mut conn) = setup_conn();
        upsert_recent(&mut conn, "note", 1, "Note A").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        upsert_recent(&mut conn, "note", 2, "Note B").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        upsert_recent(&mut conn, "note", 1, "Note A").unwrap();

        let results = load_recent(&mut conn, 20).unwrap();
        assert_eq!(results[0].entity_id, 1);
        assert_eq!(results[1].entity_id, 2);
    }

    #[test]
    fn trims_to_max_20_entries() {
        let (_tmp, mut conn) = setup_conn();
        for i in 0i32..25 {
            upsert_recent(&mut conn, "note", i, &format!("Note {}", i)).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        trim_recent(&mut conn, 20).unwrap();
        let results = load_recent(&mut conn, 20).unwrap();
        assert_eq!(results.len(), 20);
        assert_eq!(results[0].entity_id, 24);
    }
}
