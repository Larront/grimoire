use crate::db::schema::tag_graph_styles::dsl as gs;
use crate::vault::AppVault;
use diesel::prelude::*;
use diesel::SqliteConnection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TagGraphStyleResponse {
    pub color: Option<String>,
    pub hidden: bool,
}

#[tauri::command]
pub fn get_tag_graph_styles(
    vault: State<AppVault>,
) -> Result<HashMap<String, TagGraphStyleResponse>, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    get_tag_graph_styles_from_conn(conn)
}

pub fn get_tag_graph_styles_from_conn(
    conn: &mut SqliteConnection,
) -> Result<HashMap<String, TagGraphStyleResponse>, String> {
    let rows: Vec<(String, Option<String>, i32)> = gs::tag_graph_styles
        .select((gs::tag, gs::color, gs::hidden))
        .load(conn)
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(tag, color, hidden)| (tag, TagGraphStyleResponse { color, hidden: hidden != 0 }))
        .collect())
}

#[tauri::command]
pub fn set_tag_graph_style(
    tag: String,
    color: Option<String>,
    hidden: bool,
    vault: State<AppVault>,
) -> Result<(), String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    set_tag_graph_style_on_conn(conn, &tag, color.as_deref(), hidden)
}

pub fn set_tag_graph_style_on_conn(
    conn: &mut SqliteConnection,
    tag: &str,
    color: Option<&str>,
    hidden: bool,
) -> Result<(), String> {
    let hidden_val = if hidden { 1 } else { 0 };
    conn.transaction::<_, diesel::result::Error, _>(|c| {
        diesel::delete(gs::tag_graph_styles.filter(gs::tag.eq(tag))).execute(c)?;
        diesel::insert_into(gs::tag_graph_styles)
            .values((gs::tag.eq(tag), gs::color.eq(color), gs::hidden.eq(hidden_val)))
            .execute(c)?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::connection::SimpleConnection;
    use diesel::Connection;

    fn test_conn() -> SqliteConnection {
        let mut conn =
            SqliteConnection::establish(":memory:").expect("failed to open in-memory db");
        conn.batch_execute(
            "CREATE TABLE tag_graph_styles (
                tag    TEXT    NOT NULL PRIMARY KEY,
                color  TEXT,
                hidden INTEGER NOT NULL DEFAULT 0
            );",
        )
        .expect("create table");
        conn
    }

    #[test]
    fn get_returns_empty_map_when_no_rows() {
        let mut conn = test_conn();
        let result = get_tag_graph_styles_from_conn(&mut conn).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn set_inserts_a_new_row() {
        let mut conn = test_conn();
        set_tag_graph_style_on_conn(&mut conn, "npc", Some("#ff0000"), false).unwrap();
        let result = get_tag_graph_styles_from_conn(&mut conn).unwrap();
        let style = result.get("npc").expect("npc not found");
        assert_eq!(style.color.as_deref(), Some("#ff0000"));
        assert!(!style.hidden);
    }

    #[test]
    fn set_with_null_color_stores_null() {
        let mut conn = test_conn();
        set_tag_graph_style_on_conn(&mut conn, "creature", None, false).unwrap();
        let result = get_tag_graph_styles_from_conn(&mut conn).unwrap();
        let style = result.get("creature").expect("creature not found");
        assert!(style.color.is_none());
    }

    #[test]
    fn set_is_idempotent_upserts_on_second_call() {
        let mut conn = test_conn();
        set_tag_graph_style_on_conn(&mut conn, "fire", Some("#ff4400"), false).unwrap();
        set_tag_graph_style_on_conn(&mut conn, "fire", Some("#00aaff"), true).unwrap();
        let result = get_tag_graph_styles_from_conn(&mut conn).unwrap();
        assert_eq!(result.len(), 1);
        let style = result.get("fire").unwrap();
        assert_eq!(style.color.as_deref(), Some("#00aaff"));
        assert!(style.hidden);
    }

    #[test]
    fn clearing_color_resets_to_null() {
        let mut conn = test_conn();
        set_tag_graph_style_on_conn(&mut conn, "ally", Some("#00ff00"), false).unwrap();
        set_tag_graph_style_on_conn(&mut conn, "ally", None, false).unwrap();
        let result = get_tag_graph_styles_from_conn(&mut conn).unwrap();
        let style = result.get("ally").unwrap();
        assert!(style.color.is_none(), "color should be None after clear");
    }

    #[test]
    fn hidden_flag_roundtrips_correctly() {
        let mut conn = test_conn();
        set_tag_graph_style_on_conn(&mut conn, "secret", None, true).unwrap();
        let result = get_tag_graph_styles_from_conn(&mut conn).unwrap();
        assert!(result.get("secret").unwrap().hidden);

        set_tag_graph_style_on_conn(&mut conn, "secret", None, false).unwrap();
        let result2 = get_tag_graph_styles_from_conn(&mut conn).unwrap();
        assert!(!result2.get("secret").unwrap().hidden);
    }

    #[test]
    fn multiple_tags_are_independent() {
        let mut conn = test_conn();
        set_tag_graph_style_on_conn(&mut conn, "a", Some("#aaaaaa"), false).unwrap();
        set_tag_graph_style_on_conn(&mut conn, "b", Some("#bbbbbb"), true).unwrap();
        set_tag_graph_style_on_conn(&mut conn, "c", None, false).unwrap();
        let result = get_tag_graph_styles_from_conn(&mut conn).unwrap();
        assert_eq!(result.len(), 3);
        assert_eq!(result["a"].color.as_deref(), Some("#aaaaaa"));
        assert!(!result["a"].hidden);
        assert_eq!(result["b"].color.as_deref(), Some("#bbbbbb"));
        assert!(result["b"].hidden);
        assert!(result["c"].color.is_none());
    }
}
