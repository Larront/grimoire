// Ledger-global tag index.
//
// The `note_tags` table is a derived index. Markdown frontmatter is the source
// of truth; this table is fully regenerable by `rebuild_note_tags_from_ledger`.
// Wiping `.grimoire/index.db` (or just the `note_tags` table) and re-opening
// the ledger reconstructs the index from a fresh frontmatter scan.
//
// Tag-string keyed: rows are (note_path, tag); `SELECT DISTINCT tag FROM
// note_tags` is the natural "list all tags" query. Pins will use the same
// shape with a sibling table.

use crate::commands::frontmatter;
use crate::db::schema::note_tags::dsl as nt;
use crate::db::schema::pin_tags::dsl as pt;
use crate::ledger::AppLedger;
use diesel::prelude::*;
use diesel::SqliteConnection;
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use tauri::State;

/// Walk the ledger scanning every `.md` file for frontmatter tags, then replace
/// the `note_tags` table contents with the fresh scan. Hidden directories
/// (anything starting with '.') are skipped.
pub fn rebuild_note_tags_from_ledger(
    ledger_path: &Path,
    conn: &mut SqliteConnection,
) -> Result<(), String> {
    let mut rows: Vec<(String, String)> = Vec::new();
    collect_md_tags(ledger_path, "", &mut rows)?;

    conn.transaction::<_, diesel::result::Error, _>(|c| {
        diesel::delete(nt::note_tags).execute(c)?;
        if !rows.is_empty() {
            // De-dupe (note_path, lowercased-tag) so insert respects PK.
            let mut seen: BTreeSet<(String, String)> = BTreeSet::new();
            let unique: Vec<_> = rows
                .into_iter()
                .filter(|(path, tag)| seen.insert((path.clone(), tag.to_lowercase())))
                .collect();
            for chunk in unique.chunks(100) {
                let values: Vec<_> = chunk
                    .iter()
                    .map(|(path, tag)| (nt::note_path.eq(path), nt::tag.eq(tag)))
                    .collect();
                diesel::insert_into(nt::note_tags)
                    .values(&values)
                    .execute(c)?;
            }
        }
        Ok(())
    })
    .map_err(|e| e.to_string())
}

fn collect_md_tags(
    dir: &Path,
    relative: &str,
    out: &mut Vec<(String, String)>,
) -> Result<(), String> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        // Ledger may be brand new / empty — not an error.
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let entry_path = entry.path();
        let child_rel = if relative.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", relative, name)
        };
        if entry_path.is_dir() {
            collect_md_tags(&entry_path, &child_rel, out)?;
        } else if name.ends_with(".md") {
            if let Ok(content) = fs::read_to_string(&entry_path) {
                for tag in frontmatter::read_tags(&content) {
                    out.push((child_rel.clone(), tag));
                }
            }
        }
    }
    Ok(())
}

/// Replace this note's rows in the index with `tags`. Called from
/// `write_note_tags` after the file write succeeds.
pub fn upsert_note_tags(
    conn: &mut SqliteConnection,
    note_path: &str,
    tags: &[String],
) -> Result<(), String> {
    conn.transaction::<_, diesel::result::Error, _>(|c| {
        diesel::delete(nt::note_tags.filter(nt::note_path.eq(note_path))).execute(c)?;
        let mut seen: BTreeSet<String> = BTreeSet::new();
        for t in tags {
            if seen.insert(t.to_lowercase()) {
                diesel::insert_into(nt::note_tags)
                    .values((nt::note_path.eq(note_path), nt::tag.eq(t)))
                    .execute(c)?;
            }
        }
        Ok(())
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn list_all_tags(ledger: State<AppLedger>) -> Result<Vec<String>, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    list_all_tags_from_conn(conn)
}

pub fn list_all_tags_from_conn(conn: &mut SqliteConnection) -> Result<Vec<String>, String> {
    let note: Vec<String> = nt::note_tags
        .select(nt::tag)
        .load::<String>(conn)
        .map_err(|e| e.to_string())?;
    let pin: Vec<String> = pt::pin_tags
        .select(pt::tag)
        .load::<String>(conn)
        .map_err(|e| e.to_string())?;
    let mut all: Vec<String> = note.into_iter().chain(pin).collect();
    all.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    all.dedup_by(|a, b| a.to_lowercase() == b.to_lowercase());
    Ok(all)
}

/// Replace all tag rows for the given pin.
pub fn upsert_pin_tags(
    conn: &mut SqliteConnection,
    pin_id: i32,
    tags: &[String],
) -> Result<(), String> {
    conn.transaction::<_, diesel::result::Error, _>(|c| {
        diesel::delete(pt::pin_tags.filter(pt::pin_id.eq(pin_id))).execute(c)?;
        let mut seen: BTreeSet<String> = BTreeSet::new();
        for t in tags {
            if seen.insert(t.to_lowercase()) {
                diesel::insert_into(pt::pin_tags)
                    .values((pt::pin_id.eq(pin_id), pt::tag.eq(t)))
                    .execute(c)?;
            }
        }
        Ok(())
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn get_pin_tags(pin_id: i32, ledger: State<AppLedger>) -> Result<Vec<String>, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    pt::pin_tags
        .filter(pt::pin_id.eq(pin_id))
        .select(pt::tag)
        .load::<String>(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn set_pin_tags(
    pin_id: i32,
    tags: Vec<String>,
    ledger: State<AppLedger>,
) -> Result<(), String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    upsert_pin_tags(conn, pin_id, &tags)
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::connection::SimpleConnection;
    use diesel::Connection;
    use std::fs;
    use tempfile::TempDir;

    fn test_conn() -> SqliteConnection {
        let mut conn =
            SqliteConnection::establish(":memory:").expect("failed to open in-memory db");
        conn.batch_execute(
            "PRAGMA foreign_keys = ON;
            CREATE TABLE note_tags (
                note_path TEXT NOT NULL,
                tag TEXT NOT NULL,
                PRIMARY KEY (note_path, tag)
            );
            CREATE TABLE pins (
                id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                map_id INTEGER NOT NULL,
                x REAL NOT NULL,
                y REAL NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                category_id INTEGER,
                note_id INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                shape TEXT,
                icon TEXT,
                color TEXT
            );
            CREATE TABLE pin_tags (
                pin_id INTEGER NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
                tag TEXT NOT NULL,
                PRIMARY KEY (pin_id, tag)
            );",
        )
        .expect("create tables");
        conn
    }

    #[test]
    fn rebuild_from_empty_ledger_yields_no_rows() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        rebuild_note_tags_from_ledger(dir.path(), &mut conn).unwrap();
        let rows: Vec<(String, String)> =
            nt::note_tags.load(&mut conn).unwrap();
        assert!(rows.is_empty());
    }

    #[test]
    fn rebuild_picks_up_inline_frontmatter_tags() {
        let dir = TempDir::new().unwrap();
        fs::write(
            dir.path().join("dragon.md"),
            "---\ntags: [creature, fire]\n---\nBody",
        )
        .unwrap();
        fs::create_dir(dir.path().join("npcs")).unwrap();
        fs::write(
            dir.path().join("npcs").join("ash.md"),
            "---\ntags: [npc, allied]\n---\nBody",
        )
        .unwrap();

        let mut conn = test_conn();
        rebuild_note_tags_from_ledger(dir.path(), &mut conn).unwrap();

        let mut rows: Vec<(String, String)> =
            nt::note_tags.load(&mut conn).unwrap();
        rows.sort();
        assert_eq!(
            rows,
            vec![
                ("dragon.md".to_string(), "creature".to_string()),
                ("dragon.md".to_string(), "fire".to_string()),
                ("npcs/ash.md".to_string(), "allied".to_string()),
                ("npcs/ash.md".to_string(), "npc".to_string()),
            ]
        );
    }

    #[test]
    fn rebuild_is_idempotent_and_replaces_existing_rows() {
        let dir = TempDir::new().unwrap();
        fs::write(
            dir.path().join("a.md"),
            "---\ntags: [one]\n---\n",
        )
        .unwrap();
        let mut conn = test_conn();
        rebuild_note_tags_from_ledger(dir.path(), &mut conn).unwrap();

        // Tag changes on disk; rebuild reflects the new state.
        fs::write(
            dir.path().join("a.md"),
            "---\ntags: [two]\n---\n",
        )
        .unwrap();
        rebuild_note_tags_from_ledger(dir.path(), &mut conn).unwrap();

        let rows: Vec<(String, String)> =
            nt::note_tags.load(&mut conn).unwrap();
        assert_eq!(rows, vec![("a.md".to_string(), "two".to_string())]);
    }

    #[test]
    fn rebuild_skips_hidden_directories() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join(".grimoire")).unwrap();
        fs::write(
            dir.path().join(".grimoire").join("hidden.md"),
            "---\ntags: [should_not_appear]\n---\n",
        )
        .unwrap();
        let mut conn = test_conn();
        rebuild_note_tags_from_ledger(dir.path(), &mut conn).unwrap();
        let rows: Vec<(String, String)> =
            nt::note_tags.load(&mut conn).unwrap();
        assert!(rows.is_empty());
    }

    #[test]
    fn upsert_replaces_rows_for_one_note_only() {
        let mut conn = test_conn();
        upsert_note_tags(&mut conn, "a.md", &["one".to_string(), "two".to_string()]).unwrap();
        upsert_note_tags(&mut conn, "b.md", &["three".to_string()]).unwrap();
        // Replace a.md's set
        upsert_note_tags(&mut conn, "a.md", &["four".to_string()]).unwrap();

        let mut rows: Vec<(String, String)> =
            nt::note_tags.load(&mut conn).unwrap();
        rows.sort();
        assert_eq!(
            rows,
            vec![
                ("a.md".to_string(), "four".to_string()),
                ("b.md".to_string(), "three".to_string()),
            ]
        );
    }

    #[test]
    fn upsert_to_empty_set_clears_rows() {
        let mut conn = test_conn();
        upsert_note_tags(&mut conn, "a.md", &["one".to_string()]).unwrap();
        upsert_note_tags(&mut conn, "a.md", &[]).unwrap();
        let rows: Vec<(String, String)> =
            nt::note_tags.load(&mut conn).unwrap();
        assert!(rows.is_empty());
    }

    #[test]
    fn upsert_deduplicates_case_insensitively() {
        let mut conn = test_conn();
        upsert_note_tags(
            &mut conn,
            "a.md",
            &["NPC".to_string(), "npc".to_string(), "Allied".to_string()],
        )
        .unwrap();
        let mut rows: Vec<String> = nt::note_tags
            .select(nt::tag)
            .load(&mut conn)
            .unwrap();
        rows.sort();
        assert_eq!(rows, vec!["Allied".to_string(), "NPC".to_string()]);
    }

    #[test]
    fn garbage_collection_via_rebuild_drops_orphan_tags() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "---\ntags: [keep, drop]\n---\n").unwrap();
        let mut conn = test_conn();
        rebuild_note_tags_from_ledger(dir.path(), &mut conn).unwrap();

        // Remove `drop` from the note. After rebuild it should disappear from
        // the index entirely — no orphan retention.
        fs::write(dir.path().join("a.md"), "---\ntags: [keep]\n---\n").unwrap();
        rebuild_note_tags_from_ledger(dir.path(), &mut conn).unwrap();

        let rows: Vec<String> = nt::note_tags
            .select(nt::tag)
            .load(&mut conn)
            .unwrap();
        assert_eq!(rows, vec!["keep".to_string()]);
    }

    // ── pin_tags tests ───────────────────────────────────────────────────────

    fn insert_pin(conn: &mut SqliteConnection, id: i32) {
        conn.batch_execute(&format!(
            "INSERT INTO pins (id, map_id, x, y, title, created_at) \
             VALUES ({id}, 1, 0.0, 0.0, 'Pin {id}', '2026-01-01')"
        ))
        .unwrap();
    }

    #[test]
    fn upsert_pin_tags_replaces_rows_for_one_pin_only() {
        let mut conn = test_conn();
        insert_pin(&mut conn, 1);
        insert_pin(&mut conn, 2);

        upsert_pin_tags(&mut conn, 1, &["one".to_string(), "two".to_string()]).unwrap();
        upsert_pin_tags(&mut conn, 2, &["three".to_string()]).unwrap();
        // Replace pin 1's set; pin 2 should be untouched.
        upsert_pin_tags(&mut conn, 1, &["four".to_string()]).unwrap();

        let mut rows: Vec<(i32, String)> = pt::pin_tags.load(&mut conn).unwrap();
        rows.sort();
        assert_eq!(
            rows,
            vec![
                (1, "four".to_string()),
                (2, "three".to_string()),
            ]
        );
    }

    #[test]
    fn upsert_pin_tags_to_empty_set_clears_rows() {
        let mut conn = test_conn();
        insert_pin(&mut conn, 1);
        upsert_pin_tags(&mut conn, 1, &["one".to_string()]).unwrap();
        upsert_pin_tags(&mut conn, 1, &[]).unwrap();
        let rows: Vec<(i32, String)> = pt::pin_tags.load(&mut conn).unwrap();
        assert!(rows.is_empty());
    }

    #[test]
    fn upsert_pin_tags_deduplicates_case_insensitively() {
        let mut conn = test_conn();
        insert_pin(&mut conn, 1);
        upsert_pin_tags(
            &mut conn,
            1,
            &["NPC".to_string(), "npc".to_string(), "Allied".to_string()],
        )
        .unwrap();
        let mut rows: Vec<String> = pt::pin_tags.select(pt::tag).load(&mut conn).unwrap();
        rows.sort();
        assert_eq!(rows, vec!["Allied".to_string(), "NPC".to_string()]);
    }

    #[test]
    fn deleting_a_pin_cascades_to_delete_its_tag_rows() {
        let mut conn = test_conn();
        insert_pin(&mut conn, 1);
        upsert_pin_tags(&mut conn, 1, &["creature".to_string(), "fire".to_string()]).unwrap();

        // Verify rows exist before delete.
        let before: Vec<(i32, String)> = pt::pin_tags.load(&mut conn).unwrap();
        assert_eq!(before.len(), 2);

        conn.batch_execute("DELETE FROM pins WHERE id = 1").unwrap();

        let after: Vec<(i32, String)> = pt::pin_tags.load(&mut conn).unwrap();
        assert!(after.is_empty(), "cascade delete should have removed pin_tags rows");
    }

    #[test]
    fn list_all_tags_includes_pin_only_tags() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "---\ntags: [note-tag]\n---\n").unwrap();
        let mut conn = test_conn();
        rebuild_note_tags_from_ledger(dir.path(), &mut conn).unwrap();
        insert_pin(&mut conn, 1);
        upsert_pin_tags(&mut conn, 1, &["pin-only".to_string()]).unwrap();

        let all = list_all_tags_from_conn(&mut conn).unwrap();
        assert!(all.contains(&"note-tag".to_string()), "note tag missing: {all:?}");
        assert!(all.contains(&"pin-only".to_string()), "pin-only tag missing: {all:?}");
    }

    #[test]
    fn list_all_tags_deduplicates_across_note_and_pin_sources() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "---\ntags: [shared]\n---\n").unwrap();
        let mut conn = test_conn();
        rebuild_note_tags_from_ledger(dir.path(), &mut conn).unwrap();
        insert_pin(&mut conn, 1);
        upsert_pin_tags(&mut conn, 1, &["shared".to_string()]).unwrap();

        let all = list_all_tags_from_conn(&mut conn).unwrap();
        let count = all.iter().filter(|t| t.to_lowercase() == "shared").count();
        assert_eq!(count, 1, "shared tag should appear exactly once: {all:?}");
    }
}
