// Ledger-global tag index.
//
// The `note_tags` table is a derived index. Markdown frontmatter is the source
// of truth; this table is fully regenerable by `note_index::rebuild_all_from_ledger`.
// Wiping `.grimoire/index.db` (or just the `note_tags` table) and re-opening
// the ledger reconstructs the index from a fresh frontmatter scan.
//
// Tag-string keyed: rows are (note_path, tag); `SELECT DISTINCT tag FROM
// note_tags` is the natural "list all tags" query. Pins will use the same
// shape with a sibling table.

use crate::commands::frontmatter;
use crate::commands::graph_styles::{
    carry_style_through_retag, load_style_rows, restore_style_rows, TagStyleRow,
};
use crate::db::models::Note;
use crate::db::schema::note_tags::dsl as nt;
use crate::db::schema::notes::dsl as nd;
use crate::db::schema::pin_tags::dsl as pt;
use crate::ledger::{with_open_ledger, AppLedger};
use crate::note_mutation::CommitItem;
use diesel::prelude::*;
use diesel::SqliteConnection;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;
use tauri::State;

#[derive(Serialize, specta::Type, Debug, Clone)]
pub struct RetagResult {
    #[specta(type = i32)]
    pub note_count: usize,
    #[specta(type = i32)]
    pub pin_count: usize,
    /// True when the target was already a tag — the toast says "Merged".
    pub merged: bool,
    /// Everything the retag changed, as it was: hand it to `undo_retag`.
    pub undo: RetagUndo,
}

/// What a retag overwrote. Opaque to the frontend, which only hands it back.
#[derive(Serialize, Deserialize, specta::Type, Debug, Clone)]
pub struct RetagUndo {
    pub from_tag: String,
    pub to_tag: Option<String>,
    /// Each affected note's tag list before the retag.
    pub notes: Vec<TagsBefore<String>>,
    /// Each affected pin's tag list before the retag.
    pub pins: Vec<TagsBefore<i32>>,
    /// The style rows for both names before the retag.
    pub styles: Vec<TagStyleRow>,
}

#[derive(Serialize, Deserialize, specta::Type, Debug, Clone)]
pub struct TagsBefore<K> {
    pub key: K,
    pub tags: Vec<String>,
}

/// Validate a tag target name against the ledger-wide allowlist: letters, digits, -, _, /.
pub fn validate_tag_name(tag: &str) -> Result<(), String> {
    if tag.is_empty() {
        return Err("Tag name cannot be empty".to_string());
    }
    for c in tag.chars() {
        if !c.is_ascii_alphanumeric() && c != '-' && c != '_' && c != '/' {
            return Err(format!(
                "Invalid tag name '{}': tags may only contain letters, digits, -, _, /",
                tag
            ));
        }
    }
    Ok(())
}

/// Put back what a retag changed: each note's and pin's tags, and both names'
/// graph styles. A note deleted or renamed since is skipped, as is a deleted pin —
/// Undo restores what is still there to restore.
#[tauri::command]
#[specta::specta]
pub fn undo_retag(undo: RetagUndo, ledger: State<AppLedger>) -> Result<(), String> {
    with_open_ledger(&ledger, |l| undo_retag_on_conn(l.conn, l.index, l.path, &undo))
}

pub fn undo_retag_on_conn(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
    ledger_path: &Path,
    undo: &RetagUndo,
) -> Result<(), String> {
    let mut items: Vec<CommitItem> = Vec::with_capacity(undo.notes.len());
    for before in &undo.notes {
        let full_path = ledger_path.join(&before.key);
        let Ok(content) = fs::read_to_string(&full_path) else {
            continue;
        };
        let Ok(note) = nd::notes.filter(nd::path.eq(&before.key)).first::<Note>(conn) else {
            continue;
        };
        let content = frontmatter::apply_tags(&content, &before.tags);
        items.push(CommitItem { full_path, note, content });
    }
    if !items.is_empty() {
        crate::note_mutation::commit_many(conn, index, items)?;
    }

    for before in &undo.pins {
        let exists: i64 = crate::db::schema::pins::table
            .filter(crate::db::schema::pins::id.eq(before.key))
            .count()
            .get_result(conn)
            .map_err(|e| e.to_string())?;
        if exists > 0 {
            upsert_pin_tags(conn, before.key, &before.tags)?;
        }
    }

    let mut names = vec![undo.from_tag.as_str()];
    names.extend(undo.to_tag.as_deref());
    conn.transaction(|c| restore_style_rows(c, &names, &undo.styles))
        .map_err(|e: diesel::result::Error| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn retag_tag(
    from_tag: String,
    to_tag: Option<String>,
    ledger: State<AppLedger>,
) -> Result<RetagResult, String> {
    with_open_ledger(&ledger, |l| {
        retag_tag_on_conn(l.conn, l.index, l.path, &from_tag, to_tag.as_deref())
    })
}

/// Apply a retag to one entity's tag list: every case-insensitive match of
/// `from_lower` is replaced by `to_tag` (or dropped when `None`). The result is
/// deduplicated case-insensitively while preserving order, which is what folds a
/// merge target that already coexists with `from` down to a single entry.
fn rebuild_tags(current: &[String], from_lower: &str, to_tag: Option<&str>) -> Vec<String> {
    let mut new_tags: Vec<String> = Vec::new();
    let mut seen_lower: BTreeSet<String> = BTreeSet::new();
    for tag in current {
        let replacement = if tag.to_lowercase() == from_lower {
            to_tag
        } else {
            Some(tag.as_str())
        };
        if let Some(t) = replacement {
            if seen_lower.insert(t.to_lowercase()) {
                new_tags.push(t.to_string());
            }
        }
    }
    new_tags
}

/// Ledger-global retag: rename, merge, or delete a tag across all notes (frontmatter)
/// and pins (pin_tags rows). `to_tag = None` is a delete.
///
/// All note index writes are routed through `reconcile_many` — one atomic SQLite
/// transaction across N notes, one Tantivy commit.
pub fn retag_tag_on_conn(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
    ledger_path: &Path,
    from_tag: &str,
    to_tag: Option<&str>,
) -> Result<RetagResult, String> {
    if let Some(to) = to_tag {
        validate_tag_name(to)?;
    }

    let from_lower = from_tag.to_lowercase();

    // ── Notes ─────────────────────────────────────────────────────────────────
    let all_note_rows: Vec<(String, String)> = nt::note_tags
        .select((nt::note_path, nt::tag))
        .load(conn)
        .map_err(|e| e.to_string())?;
    let all_pin_rows: Vec<(i32, String)> = pt::pin_tags
        .select((pt::pin_id, pt::tag))
        .load(conn)
        .map_err(|e| e.to_string())?;

    // A merge is a retag onto a name already in use. A change of case only is
    // still a rename — it is the same tag.
    let merged = to_tag.is_some_and(|to| {
        let to_lower = to.to_lowercase();
        to_lower != from_lower
            && all_note_rows
                .iter()
                .map(|(_, t)| t)
                .chain(all_pin_rows.iter().map(|(_, t)| t))
                .any(|t| t.to_lowercase() == to_lower)
    });

    let style_names: Vec<String> =
        std::iter::once(from_lower.clone()).chain(to_tag.map(str::to_lowercase)).collect();
    let styles_before: Vec<TagStyleRow> = load_style_rows(conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|r| style_names.contains(&r.tag.to_lowercase()))
        .collect();
    let mut notes_before: Vec<TagsBefore<String>> = Vec::new();
    let mut pins_before: Vec<TagsBefore<i32>> = Vec::new();

    let mut seen_paths: BTreeSet<String> = BTreeSet::new();
    for (path, tag) in &all_note_rows {
        if tag.to_lowercase() == from_lower {
            seen_paths.insert(path.clone());
        }
    }
    let affected_paths: Vec<String> = seen_paths.into_iter().collect();
    let note_count = affected_paths.len();

    if note_count > 0 {
        // Route the bulk rewrite through the note_mutation envelope: each file
        // is written via the Write Chokepoint (echo-suppressed, unlike the old
        // raw `fs::write`) and all N notes reconcile in one batch.
        let mut items: Vec<CommitItem> = Vec::with_capacity(note_count);
        for note_path in &affected_paths {
            let full_path = ledger_path.join(note_path);
            let content = fs::read_to_string(&full_path)
                .map_err(|e| format!("Failed to read '{note_path}': {e}"))?;

            let current_tags = frontmatter::read_tags(&content);
            let new_tags = rebuild_tags(&current_tags, &from_lower, to_tag);
            let new_content = frontmatter::apply_tags(&content, &new_tags);
            notes_before.push(TagsBefore { key: note_path.clone(), tags: current_tags });

            let note: Note = nd::notes
                .filter(nd::path.eq(note_path))
                .first(conn)
                .map_err(|e| format!("Note '{note_path}' not in DB: {e}"))?;

            items.push(CommitItem { full_path, note, content: new_content });
        }

        crate::note_mutation::commit_many(conn, index, items)?;
    }

    // ── Pins ──────────────────────────────────────────────────────────────────
    let mut seen_pins: BTreeSet<i32> = BTreeSet::new();
    for (pin_id, tag) in &all_pin_rows {
        if tag.to_lowercase() == from_lower {
            seen_pins.insert(*pin_id);
        }
    }
    let affected_pins: Vec<i32> = seen_pins.into_iter().collect();
    let pin_count = affected_pins.len();

    for pin_id in &affected_pins {
        let current_tags: Vec<String> = pt::pin_tags
            .filter(pt::pin_id.eq(pin_id))
            .select(pt::tag)
            .load(conn)
            .map_err(|e| e.to_string())?;

        let new_tags = rebuild_tags(&current_tags, &from_lower, to_tag);

        upsert_pin_tags(conn, *pin_id, &new_tags)?;
        pins_before.push(TagsBefore { key: *pin_id, tags: current_tags });
    }

    // ── Graph style ───────────────────────────────────────────────────────────
    // The colour goes where the tag goes — see `carry_style_through_retag`.
    conn.transaction(|c| carry_style_through_retag(c, from_tag, to_tag, merged))
        .map_err(|e: diesel::result::Error| e.to_string())?;

    Ok(RetagResult {
        note_count,
        pin_count,
        merged,
        undo: RetagUndo {
            from_tag: from_tag.to_string(),
            to_tag: to_tag.map(str::to_string),
            notes: notes_before,
            pins: pins_before,
            styles: styles_before,
        },
    })
}

#[derive(Serialize, specta::Type, Debug, Clone)]
pub struct TagUsageEntry {
    pub tag: String,
    #[specta(type = i32)]
    pub note_count: i64,
    #[specta(type = i32)]
    pub pin_count: i64,
}

#[tauri::command]
#[specta::specta]
pub fn get_tag_usage_counts(ledger: State<AppLedger>) -> Result<Vec<TagUsageEntry>, String> {
    with_open_ledger(&ledger, |l| get_tag_usage_counts_from_conn(l.conn))
}

pub fn get_tag_usage_counts_from_conn(
    conn: &mut SqliteConnection,
) -> Result<Vec<TagUsageEntry>, String> {
    let note_rows: Vec<String> = nt::note_tags
        .select(nt::tag)
        .load(conn)
        .map_err(|e| e.to_string())?;
    let pin_rows: Vec<String> = pt::pin_tags
        .select(pt::tag)
        .load(conn)
        .map_err(|e| e.to_string())?;

    let mut note_counts: BTreeMap<String, i64> = BTreeMap::new();
    let mut pin_counts: BTreeMap<String, i64> = BTreeMap::new();
    // First-seen casing wins (same policy as list_all_tags_from_conn).
    let mut canonical: BTreeMap<String, String> = BTreeMap::new();

    for tag in &note_rows {
        let lower = tag.to_lowercase();
        *note_counts.entry(lower.clone()).or_insert(0) += 1;
        canonical.entry(lower).or_insert_with(|| tag.clone());
    }
    for tag in &pin_rows {
        let lower = tag.to_lowercase();
        *pin_counts.entry(lower.clone()).or_insert(0) += 1;
        canonical.entry(lower.clone()).or_insert_with(|| tag.clone());
    }

    let all_keys: BTreeSet<String> = note_counts
        .keys()
        .chain(pin_counts.keys())
        .cloned()
        .collect();
    let mut result: Vec<TagUsageEntry> = all_keys
        .iter()
        .map(|lower| TagUsageEntry {
            tag: canonical[lower].clone(),
            note_count: note_counts.get(lower).copied().unwrap_or(0),
            pin_count: pin_counts.get(lower).copied().unwrap_or(0),
        })
        .collect();
    result.sort_by(|a, b| a.tag.to_lowercase().cmp(&b.tag.to_lowercase()));
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub fn list_all_tags(ledger: State<AppLedger>) -> Result<Vec<String>, String> {
    with_open_ledger(&ledger, |l| list_all_tags_from_conn(l.conn))
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
    with_open_ledger(&ledger, |l| {
        pt::pin_tags
            .filter(pt::pin_id.eq(pin_id))
            .select(pt::tag)
            .load::<String>(l.conn)
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
#[specta::specta]
pub fn set_pin_tags(
    pin_id: i32,
    tags: Vec<String>,
    ledger: State<AppLedger>,
) -> Result<(), String> {
    with_open_ledger(&ledger, |l| upsert_pin_tags(l.conn, pin_id, &tags))
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
            CREATE TABLE notes (
                id INTEGER PRIMARY KEY NOT NULL,
                path TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL DEFAULT '',
                icon TEXT,
                cover_image TEXT,
                parent_path TEXT,
                archived BOOLEAN NOT NULL DEFAULT 0,
                modified_at TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE note_tags (
                note_path TEXT NOT NULL,
                tag TEXT NOT NULL,
                PRIMARY KEY (note_path, tag)
            );
            CREATE TABLE note_links (
                source_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
                target_path TEXT NOT NULL,
                PRIMARY KEY (source_id, target_path)
            );
            CREATE TABLE note_aliases (
                note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
                alias TEXT NOT NULL,
                PRIMARY KEY (note_id, alias)
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
            );
            CREATE TABLE tag_graph_styles (
                tag    TEXT    NOT NULL PRIMARY KEY,
                color  TEXT,
                hidden INTEGER NOT NULL DEFAULT 0,
                slot   INTEGER
            );",
        )
        .expect("create tables");
        conn
    }

    fn insert_note(conn: &mut SqliteConnection, id: i32, path: &str, title: &str) {
        conn.batch_execute(&format!(
            "INSERT INTO notes (id, path, title) VALUES ({id}, '{path}', '{title}')"
        ))
        .unwrap();
    }

    // Test fixture: seed the derived `note_tags` table directly. Production
    // writes go solely through `note_index`; this only populates rows so the
    // retag / usage-count / list-all tests below have data to read.
    fn seed_note_tags(
        conn: &mut SqliteConnection,
        note_path: &str,
        tags: &[String],
    ) -> Result<(), String> {
        diesel::delete(nt::note_tags.filter(nt::note_path.eq(note_path)))
            .execute(conn)
            .map_err(|e| e.to_string())?;
        for t in tags {
            diesel::insert_into(nt::note_tags)
                .values((nt::note_path.eq(note_path), nt::tag.eq(t)))
                .execute(conn)
                .map_err(|e| e.to_string())?;
        }
        Ok(())
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
        let mut conn = test_conn();
        seed_note_tags(&mut conn, "a.md", &["note-tag".to_string()]).unwrap();
        insert_pin(&mut conn, 1);
        upsert_pin_tags(&mut conn, 1, &["pin-only".to_string()]).unwrap();

        let all = list_all_tags_from_conn(&mut conn).unwrap();
        assert!(all.contains(&"note-tag".to_string()), "note tag missing: {all:?}");
        assert!(all.contains(&"pin-only".to_string()), "pin-only tag missing: {all:?}");
    }

    // ── get_tag_usage_counts tests ───────────────────────────────────────────

    #[test]
    fn usage_counts_empty_when_no_tags() {
        let mut conn = test_conn();
        let result = get_tag_usage_counts_from_conn(&mut conn).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn usage_counts_note_count_reflects_distinct_notes() {
        let mut conn = test_conn();
        seed_note_tags(&mut conn, "a.md", &["creature".to_string()]).unwrap();
        seed_note_tags(&mut conn, "b.md", &["creature".to_string()]).unwrap();
        let result = get_tag_usage_counts_from_conn(&mut conn).unwrap();
        let entry = result.iter().find(|e| e.tag == "creature").unwrap();
        assert_eq!(entry.note_count, 2);
        assert_eq!(entry.pin_count, 0);
    }

    #[test]
    fn usage_counts_pin_count_reflects_distinct_pins() {
        let mut conn = test_conn();
        insert_pin(&mut conn, 1);
        insert_pin(&mut conn, 2);
        upsert_pin_tags(&mut conn, 1, &["location".to_string()]).unwrap();
        upsert_pin_tags(&mut conn, 2, &["location".to_string()]).unwrap();
        let result = get_tag_usage_counts_from_conn(&mut conn).unwrap();
        let entry = result.iter().find(|e| e.tag == "location").unwrap();
        assert_eq!(entry.note_count, 0);
        assert_eq!(entry.pin_count, 2);
    }

    #[test]
    fn usage_counts_combines_note_and_pin_counts() {
        let mut conn = test_conn();
        seed_note_tags(&mut conn, "a.md", &["npc".to_string()]).unwrap();
        insert_pin(&mut conn, 1);
        upsert_pin_tags(&mut conn, 1, &["npc".to_string()]).unwrap();
        let result = get_tag_usage_counts_from_conn(&mut conn).unwrap();
        let entry = result.iter().find(|e| e.tag == "npc").unwrap();
        assert_eq!(entry.note_count, 1);
        assert_eq!(entry.pin_count, 1);
    }

    #[test]
    fn usage_counts_deduplicates_case_insensitively() {
        let mut conn = test_conn();
        seed_note_tags(&mut conn, "a.md", &["NPC".to_string()]).unwrap();
        insert_pin(&mut conn, 1);
        upsert_pin_tags(&mut conn, 1, &["npc".to_string()]).unwrap();
        let result = get_tag_usage_counts_from_conn(&mut conn).unwrap();
        let npc_entries: Vec<_> = result.iter().filter(|e| e.tag.to_lowercase() == "npc").collect();
        assert_eq!(npc_entries.len(), 1, "should merge case variants: {result:?}");
        let entry = npc_entries[0];
        assert_eq!(entry.note_count, 1);
        assert_eq!(entry.pin_count, 1);
    }

    #[test]
    fn usage_counts_sorted_alphabetically() {
        let mut conn = test_conn();
        seed_note_tags(&mut conn, "a.md", &["zebra".to_string(), "ant".to_string()]).unwrap();
        let result = get_tag_usage_counts_from_conn(&mut conn).unwrap();
        assert_eq!(result[0].tag, "ant");
        assert_eq!(result[1].tag, "zebra");
    }

    #[test]
    fn list_all_tags_deduplicates_across_note_and_pin_sources() {
        let mut conn = test_conn();
        seed_note_tags(&mut conn, "a.md", &["shared".to_string()]).unwrap();
        insert_pin(&mut conn, 1);
        upsert_pin_tags(&mut conn, 1, &["shared".to_string()]).unwrap();

        let all = list_all_tags_from_conn(&mut conn).unwrap();
        let count = all.iter().filter(|t| t.to_lowercase() == "shared").count();
        assert_eq!(count, 1, "shared tag should appear exactly once: {all:?}");
    }

    // ── validate_tag_name tests ───────────────────────────────────────────────

    #[test]
    fn validate_empty_tag_name_is_error() {
        assert!(validate_tag_name("").is_err());
    }

    #[test]
    fn validate_tag_name_rejects_spaces_and_special_chars() {
        assert!(validate_tag_name("bad tag").is_err());
        assert!(validate_tag_name("tag!").is_err());
        assert!(validate_tag_name("tag@place").is_err());
    }

    #[test]
    fn validate_tag_name_accepts_letters_digits_and_allowed_punctuation() {
        assert!(validate_tag_name("npc").is_ok());
        assert!(validate_tag_name("NPC").is_ok());
        assert!(validate_tag_name("tag-1").is_ok());
        assert!(validate_tag_name("tag_two").is_ok());
        assert!(validate_tag_name("group/sub").is_ok());
        assert!(validate_tag_name("abc123").is_ok());
    }

    // ── retag_tag_on_conn tests ───────────────────────────────────────────────

    #[test]
    fn retag_rename_rewrites_notes_and_pins() {
        let dir = TempDir::new().unwrap();
        fs::write(
            dir.path().join("dragon.md"),
            "---\ntags: [creature, fire]\n---\nBody",
        )
        .unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "dragon.md", "Dragon");
        insert_pin(&mut conn, 1);
        seed_note_tags(&mut conn, "dragon.md", &["creature".to_string(), "fire".to_string()])
            .unwrap();
        upsert_pin_tags(&mut conn, 1, &["creature".to_string()]).unwrap();

        let result =
            retag_tag_on_conn(&mut conn, None, dir.path(), "creature", Some("monster")).unwrap();
        assert_eq!(result.note_count, 1);
        assert_eq!(result.pin_count, 1);

        // File updated
        let content = fs::read_to_string(dir.path().join("dragon.md")).unwrap();
        let tags = frontmatter::read_tags(&content);
        assert!(tags.contains(&"monster".to_string()), "expected monster in {tags:?}");
        assert!(!tags.contains(&"creature".to_string()), "unexpected creature in {tags:?}");
        assert!(tags.contains(&"fire".to_string()), "fire should be retained");

        // note_tags index updated
        let note_rows: Vec<(String, String)> = nt::note_tags.load(&mut conn).unwrap();
        assert!(note_rows.iter().any(|(_, t)| t == "monster"));
        assert!(!note_rows.iter().any(|(_, t)| t.to_lowercase() == "creature"));

        // pin_tags updated
        let pin_rows: Vec<(i32, String)> = pt::pin_tags.load(&mut conn).unwrap();
        assert!(pin_rows.iter().any(|(_, t)| t == "monster"));
        assert!(!pin_rows.iter().any(|(_, t)| t.to_lowercase() == "creature"));
    }

    #[test]
    fn retag_delete_removes_tag_everywhere() {
        let dir = TempDir::new().unwrap();
        fs::write(
            dir.path().join("a.md"),
            "---\ntags: [npc, creature]\n---\nBody",
        )
        .unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        insert_pin(&mut conn, 1);
        seed_note_tags(
            &mut conn,
            "a.md",
            &["npc".to_string(), "creature".to_string()],
        )
        .unwrap();
        upsert_pin_tags(&mut conn, 1, &["npc".to_string()]).unwrap();

        let result = retag_tag_on_conn(&mut conn, None, dir.path(), "npc", None).unwrap();
        assert_eq!(result.note_count, 1);
        assert_eq!(result.pin_count, 1);

        // 'npc' removed from note file; 'creature' retained
        let content = fs::read_to_string(dir.path().join("a.md")).unwrap();
        let tags = frontmatter::read_tags(&content);
        assert!(!tags.iter().any(|t| t.to_lowercase() == "npc"));
        assert!(tags.contains(&"creature".to_string()));

        // note_tags index cleaned up
        let note_rows: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        assert!(!note_rows.iter().any(|t| t.to_lowercase() == "npc"));

        // pin_tags cleaned up
        let pin_rows: Vec<(i32, String)> = pt::pin_tags.load(&mut conn).unwrap();
        assert!(pin_rows.is_empty());
    }

    #[test]
    fn retag_merge_deduplicates_per_entity() {
        let dir = TempDir::new().unwrap();
        // Note already has both 'npc' and 'character'
        fs::write(
            dir.path().join("a.md"),
            "---\ntags: [npc, character]\n---\nBody",
        )
        .unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        seed_note_tags(
            &mut conn,
            "a.md",
            &["npc".to_string(), "character".to_string()],
        )
        .unwrap();

        let result =
            retag_tag_on_conn(&mut conn, None, dir.path(), "npc", Some("character")).unwrap();
        assert_eq!(result.note_count, 1);
        assert_eq!(result.pin_count, 0);

        let content = fs::read_to_string(dir.path().join("a.md")).unwrap();
        let tags = frontmatter::read_tags(&content);
        // Exactly one 'character', no 'npc'
        assert_eq!(
            tags.iter().filter(|t| t.to_lowercase() == "character").count(),
            1,
            "should have exactly one character: {tags:?}"
        );
        assert!(!tags.iter().any(|t| t.to_lowercase() == "npc"), "npc should be gone: {tags:?}");

        let note_rows: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        assert_eq!(
            note_rows.iter().filter(|t| t.to_lowercase() == "character").count(),
            1
        );
    }

    #[test]
    fn retag_case_only_rewrites_display_form() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "---\ntags: [npc]\n---\nBody").unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        seed_note_tags(&mut conn, "a.md", &["npc".to_string()]).unwrap();

        let result = retag_tag_on_conn(&mut conn, None, dir.path(), "npc", Some("NPC")).unwrap();
        assert_eq!(result.note_count, 1);

        let content = fs::read_to_string(dir.path().join("a.md")).unwrap();
        let tags = frontmatter::read_tags(&content);
        assert!(tags.contains(&"NPC".to_string()), "expected NPC: {tags:?}");
        assert!(!tags.contains(&"npc".to_string()), "old npc should be gone: {tags:?}");

        let note_rows: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        assert!(note_rows.contains(&"NPC".to_string()));
        assert!(!note_rows.contains(&"npc".to_string()));
    }

    #[test]
    fn retag_counts_all_affected_notes_and_pins() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "---\ntags: [loc]\n---\n").unwrap();
        fs::write(dir.path().join("b.md"), "---\ntags: [loc]\n---\n").unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        insert_note(&mut conn, 2, "b.md", "B");
        insert_pin(&mut conn, 1);
        insert_pin(&mut conn, 2);
        seed_note_tags(&mut conn, "a.md", &["loc".to_string()]).unwrap();
        seed_note_tags(&mut conn, "b.md", &["loc".to_string()]).unwrap();
        upsert_pin_tags(&mut conn, 1, &["loc".to_string()]).unwrap();
        upsert_pin_tags(&mut conn, 2, &["loc".to_string()]).unwrap();

        let result =
            retag_tag_on_conn(&mut conn, None, dir.path(), "loc", Some("location")).unwrap();
        assert_eq!(result.note_count, 2);
        assert_eq!(result.pin_count, 2);
    }

    #[test]
    fn retag_invalid_target_name_returns_error() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();

        let err = retag_tag_on_conn(&mut conn, None, dir.path(), "npc", Some("bad tag!"))
            .unwrap_err();
        assert!(err.contains("Invalid tag name"), "unexpected error: {err}");
    }

    #[test]
    fn retag_no_op_when_tag_not_present() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "---\ntags: [npc]\n---\n").unwrap();
        let mut conn = test_conn();
        seed_note_tags(&mut conn, "a.md", &["npc".to_string()]).unwrap();

        let result =
            retag_tag_on_conn(&mut conn, None, dir.path(), "ghost", Some("phantom")).unwrap();
        assert_eq!(result.note_count, 0);
        assert_eq!(result.pin_count, 0);
    }

    #[test]
    fn retag_says_merged_only_when_the_target_was_already_a_tag() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "---
tags: [npc]
---
").unwrap();
        fs::write(dir.path().join("b.md"), "---
tags: [person]
---
").unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        insert_note(&mut conn, 2, "b.md", "B");
        seed_note_tags(&mut conn, "a.md", &["npc".to_string()]).unwrap();
        seed_note_tags(&mut conn, "b.md", &["person".to_string()]).unwrap();

        let renamed = retag_tag_on_conn(&mut conn, None, dir.path(), "npc", Some("NPC")).unwrap();
        assert!(!renamed.merged, "a change of case is a rename");
        let merged =
            retag_tag_on_conn(&mut conn, None, dir.path(), "NPC", Some("person")).unwrap();
        assert!(merged.merged);
    }

    #[test]
    fn retag_carries_the_graph_style_with_the_tag() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "---
tags: [npc]
---
").unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        seed_note_tags(&mut conn, "a.md", &["npc".to_string()]).unwrap();
        crate::commands::graph_styles::set_tag_graph_color_on_conn(&mut conn, "npc", Some("#abcdef"))
            .unwrap();

        retag_tag_on_conn(&mut conn, None, dir.path(), "npc", Some("person")).unwrap();
        let rows = load_style_rows(&mut conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].tag, "person");
        assert_eq!(rows[0].color.as_deref(), Some("#abcdef"));
    }

    #[test]
    fn undo_puts_a_merge_back_tags_and_styles_both() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "---
tags: [npc, city]
---
Body").unwrap();
        fs::write(dir.path().join("b.md"), "---
tags: [person]
---
Body").unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        insert_note(&mut conn, 2, "b.md", "B");
        insert_pin(&mut conn, 1);
        seed_note_tags(&mut conn, "a.md", &["npc".to_string(), "city".to_string()]).unwrap();
        seed_note_tags(&mut conn, "b.md", &["person".to_string()]).unwrap();
        upsert_pin_tags(&mut conn, 1, &["npc".to_string()]).unwrap();
        crate::commands::graph_styles::set_tag_graph_color_on_conn(&mut conn, "npc", Some("#111111"))
            .unwrap();

        let result =
            retag_tag_on_conn(&mut conn, None, dir.path(), "npc", Some("person")).unwrap();
        assert!(result.merged);
        undo_retag_on_conn(&mut conn, None, dir.path(), &result.undo).unwrap();

        let tags = frontmatter::read_tags(&fs::read_to_string(dir.path().join("a.md")).unwrap());
        assert_eq!(tags, vec!["npc".to_string(), "city".to_string()]);
        let pin: Vec<String> = pt::pin_tags.select(pt::tag).load(&mut conn).unwrap();
        assert_eq!(pin, vec!["npc".to_string()]);
        let rows = load_style_rows(&mut conn).unwrap();
        assert_eq!(rows.iter().find(|r| r.tag == "npc").unwrap().color.as_deref(), Some("#111111"));
    }

    #[test]
    fn undo_skips_a_note_deleted_in_the_meantime() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "---
tags: [npc]
---
").unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        seed_note_tags(&mut conn, "a.md", &["npc".to_string()]).unwrap();

        let result =
            retag_tag_on_conn(&mut conn, None, dir.path(), "npc", Some("person")).unwrap();
        fs::remove_file(dir.path().join("a.md")).unwrap();
        undo_retag_on_conn(&mut conn, None, dir.path(), &result.undo).unwrap();
    }
}
