//! Quick Notes (#230) — the pen a GM parks a mid-session thought in.
//!
//! **A Quick Note is a row, not a note** ([ADR-0018](../../../docs/adr/0018-quick-notes-are-rows-not-notes.md)).
//! It has no path, no title and no file, so nothing here writes to disk, nothing
//! here touches `notes`, and — the rule the whole feature rests on — nothing here
//! reaches `note_index.rs`, `search.rs` or `commands/links.rs`. A `[[wikilink]]`
//! inside a Quick Note is drawn by the pane and deliberately never filed: the
//! Link Index, the Search Index and the graph are blind to this table, without
//! exception. A diff here that imported one of those modules would be the rule
//! leaking.
//!
//! No [[Ledger Format Version]] bump either: no note file changes shape, so
//! ADR-0017's consent flow does not apply and a dated migration adds the table
//! like any other.
//!
//! The DB work sits in free functions taking a connection, and the commands are
//! the thin `with_open_ledger` wrappers over them — which is what lets the rules
//! below (a blank line is not a thought; the list comes back in capture order) be
//! tested against a real migrated database.

use chrono::Utc;
use diesel::prelude::*;
use tauri::State;

use crate::db::models::{NewQuickNote, QuickNote};
use crate::db::schema::quick_notes;
use crate::ledger::{with_open_ledger, AppLedger};

/// Every Quick Note in the ledger, oldest first.
///
/// One order, ascending, for both surfaces that read it: the pane groups by
/// capture day and shows the newest day first, and doing that flip in the pane
/// keeps *one* sort here and one place that decides what "newest day first,
/// chronological within a day" means. `id` breaks a tie, because two lines
/// captured inside the same second are still in the order they were typed.
pub fn load_quick_notes(conn: &mut SqliteConnection) -> QueryResult<Vec<QuickNote>> {
    quick_notes::table
        .order((quick_notes::captured_at.asc(), quick_notes::id.asc()))
        .load::<QuickNote>(conn)
}

/// Write one captured line, stamped with the moment it arrived.
///
/// The body is trimmed and a blank one is refused: the surfaces already decline
/// to commit an empty box, and a row holding nothing but whitespace would be a
/// thought the GM cannot read and cannot tell apart from the next one.
pub fn insert_quick_note(conn: &mut SqliteConnection, body: &str) -> Result<QuickNote, String> {
    let body = body.trim();
    if body.is_empty() {
        return Err("ERR_EMPTY_QUICK_NOTE: a Quick Note needs some text".into());
    }
    diesel::insert_into(quick_notes::table)
        .values(NewQuickNote {
            body: body.to_string(),
            captured_at: Utc::now().to_rfc3339(),
        })
        .returning(QuickNote::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn list_quick_notes(ledger: State<AppLedger>) -> Result<Vec<QuickNote>, String> {
    with_open_ledger(&ledger, |l| {
        load_quick_notes(l.conn).map_err(|e| e.to_string())
    })
}

#[tauri::command]
#[specta::specta]
pub fn create_quick_note(body: String, ledger: State<AppLedger>) -> Result<QuickNote, String> {
    with_open_ledger(&ledger, |l| insert_quick_note(l.conn, &body))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::MIGRATIONS;
    use diesel_migrations::MigrationHarness;

    fn setup_db() -> SqliteConnection {
        let mut conn = SqliteConnection::establish(":memory:").expect("in-memory DB");
        conn.run_pending_migrations(MIGRATIONS).expect("migrations");
        conn
    }

    /// Stamp a row's capture time directly — the only way to write a Quick Note
    /// into the past, which is what a day-grouping claim needs.
    fn captured_at(conn: &mut SqliteConnection, id: i32, when: &str) {
        diesel::update(quick_notes::table.find(id))
            .set(quick_notes::captured_at.eq(when))
            .execute(conn)
            .unwrap();
    }

    #[test]
    fn create_persists_the_line_and_stamps_it() {
        let mut conn = setup_db();
        let note = insert_quick_note(&mut conn, "[[Mira Ashvale]] should know about the fires")
            .expect("create");

        assert_eq!(note.body, "[[Mira Ashvale]] should know about the fires");
        assert!(
            chrono::DateTime::parse_from_rfc3339(&note.captured_at).is_ok(),
            "captured_at is RFC-3339, not {}",
            note.captured_at,
        );

        // The row survives the write, which is the whole promise of the pen.
        let stored = load_quick_notes(&mut conn).unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].id, note.id);
        assert_eq!(stored[0].body, note.body);
    }

    #[test]
    fn create_trims_surrounding_whitespace() {
        let mut conn = setup_db();
        let note = insert_quick_note(&mut conn, "  the marsh fires spread west  ").unwrap();
        assert_eq!(note.body, "the marsh fires spread west");
    }

    #[test]
    fn create_refuses_a_blank_line() {
        let mut conn = setup_db();
        let err = insert_quick_note(&mut conn, "   \n  ").unwrap_err();
        assert!(err.starts_with("ERR_EMPTY_QUICK_NOTE"), "{err}");
        assert!(
            load_quick_notes(&mut conn).unwrap().is_empty(),
            "an empty box writes nothing",
        );
    }

    #[test]
    fn list_returns_capture_order_across_days() {
        let mut conn = setup_db();
        let first = insert_quick_note(&mut conn, "first").unwrap();
        let second = insert_quick_note(&mut conn, "second").unwrap();
        let third = insert_quick_note(&mut conn, "third").unwrap();

        // Written out of order on purpose: the query's order, not the insert's,
        // is what the pane groups.
        captured_at(&mut conn, second.id, "2026-08-18T09:00:00+00:00");
        captured_at(&mut conn, third.id, "2026-08-19T09:00:00+00:00");
        captured_at(&mut conn, first.id, "2026-08-19T22:00:00+00:00");

        let bodies: Vec<String> = load_quick_notes(&mut conn)
            .unwrap()
            .into_iter()
            .map(|n| n.body)
            .collect();
        assert_eq!(bodies, vec!["second", "third", "first"]);
    }

    #[test]
    fn list_breaks_a_same_instant_tie_by_id() {
        let mut conn = setup_db();
        let a = insert_quick_note(&mut conn, "typed first").unwrap();
        let b = insert_quick_note(&mut conn, "typed second").unwrap();
        captured_at(&mut conn, a.id, "2026-08-20T10:00:00+00:00");
        captured_at(&mut conn, b.id, "2026-08-20T10:00:00+00:00");

        let bodies: Vec<String> = load_quick_notes(&mut conn)
            .unwrap()
            .into_iter()
            .map(|n| n.body)
            .collect();
        assert_eq!(bodies, vec!["typed first", "typed second"]);
    }
}
