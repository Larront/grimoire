// note_index — owns the Derived Index family behind a single `reconcile` operation.
//
// `DerivedFacets` parses the note content exactly once; `reconcile` writes
// note_links, note_aliases, and note_tags inside a single SQLite transaction,
// then updates the Tantivy Search Index on a best-effort basis.
//
// Acting on `ReconcileOutcome::search_stale` is deferred to a later slice.

use crate::commands::frontmatter;
use crate::commands::links::extract_wikilinks;
use crate::db::models::Note;
use crate::db::schema::note_aliases::dsl as na;
use crate::db::schema::note_links::dsl as nl;
use crate::db::schema::note_tags::dsl as nt;
use diesel::prelude::*;
use diesel::SqliteConnection;
use std::collections::BTreeSet;

struct DerivedFacets {
    links: Vec<String>,
    aliases: Vec<String>,
    tags: Vec<String>,
    body_text: String,
}

impl DerivedFacets {
    fn extract(content: &str) -> Self {
        Self {
            links: extract_wikilinks(content),
            aliases: frontmatter::read_aliases(content),
            tags: frontmatter::read_tags(content),
            body_text: crate::search::extract_plain_text(content),
        }
    }
}

pub struct ReconcileOutcome {
    pub search_stale: bool,
}

pub fn stale_marker_path(ledger_path: &std::path::Path) -> std::path::PathBuf {
    ledger_path.join(".grimoire").join("search.stale")
}

/// Write the persisted stale marker (best-effort; ignores I/O errors).
pub fn write_search_stale_marker(ledger_path: &std::path::Path) {
    let marker = stale_marker_path(ledger_path);
    if let Some(parent) = marker.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&marker, "");
}

/// Remove the persisted stale marker (best-effort; ignores I/O errors).
pub fn clear_search_stale_marker(ledger_path: &std::path::Path) {
    let _ = std::fs::remove_file(stale_marker_path(ledger_path));
}

/// Persist the stale marker when a reconcile/remove outcome reports that the
/// best-effort Tantivy write failed. No-op otherwise. This is the command
/// layer's hook onto the staleness the seam only *reports* (per ADR-0004).
pub fn mark_stale_if_needed(outcome: &ReconcileOutcome, ledger_path: &std::path::Path) {
    if outcome.search_stale {
        write_search_stale_marker(ledger_path);
    }
}

/// Reconcile the persisted stale marker against a launch-time rebuild result:
/// a successful rebuild clears the marker; a failed rebuild leaves it in place
/// so the next launch retries. Clearing an absent marker is a harmless no-op.
pub fn clear_stale_marker_if_rebuilt(ledger_path: &std::path::Path, rebuild_succeeded: bool) {
    if rebuild_succeeded {
        clear_search_stale_marker(ledger_path);
    }
}

/// Write all derived indexes for `note` in a single atomic SQLite transaction,
/// then update Tantivy on a best-effort basis.
///
/// `prev_path` — when `Some` and different from `note.path`, the old path's
/// `note_tags` rows are cleared before writing (path re-key invariant).
pub fn reconcile(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
    note: &Note,
    content: &str,
    prev_path: Option<&str>,
) -> Result<ReconcileOutcome, String> {
    let facets = DerivedFacets::extract(content);

    let old_path_to_clear = prev_path.filter(|&p| p != note.path.as_str());

    conn.transaction::<_, diesel::result::Error, _>(|c| {
        if let Some(old_path) = old_path_to_clear {
            diesel::delete(nt::note_tags.filter(nt::note_path.eq(old_path))).execute(c)?;
        }

        // note_links
        diesel::delete(nl::note_links.filter(nl::source_id.eq(note.id))).execute(c)?;
        for target in &facets.links {
            diesel::insert_into(nl::note_links)
                .values((nl::source_id.eq(note.id), nl::target_path.eq(target)))
                .execute(c)?;
        }

        // note_aliases (case-insensitive dedup)
        diesel::delete(na::note_aliases.filter(na::note_id.eq(note.id))).execute(c)?;
        let mut seen_aliases: BTreeSet<String> = BTreeSet::new();
        for alias in &facets.aliases {
            if seen_aliases.insert(alias.to_lowercase()) {
                diesel::insert_into(na::note_aliases)
                    .values((na::note_id.eq(note.id), na::alias.eq(alias)))
                    .execute(c)?;
            }
        }

        // note_tags (case-insensitive dedup, path-keyed)
        diesel::delete(nt::note_tags.filter(nt::note_path.eq(&note.path))).execute(c)?;
        let mut seen_tags: BTreeSet<String> = BTreeSet::new();
        for tag in &facets.tags {
            if seen_tags.insert(tag.to_lowercase()) {
                diesel::insert_into(nt::note_tags)
                    .values((nt::note_path.eq(&note.path), nt::tag.eq(tag)))
                    .execute(c)?;
            }
        }

        Ok(())
    })
    .map_err(|e| e.to_string())?;

    // Best-effort Tantivy write — failure must not abort the SQLite writes above
    let search_stale = match index {
        Some(idx) => {
            crate::search::index_note(idx, note, &facets.body_text, &facets.tags).is_err()
        }
        None => true,
    };

    Ok(ReconcileOutcome { search_stale })
}

/// Explicitly clear all three Derived Index tables for `note_id`/`note_path`
/// and remove the note's Search Index document, then return a `ReconcileOutcome`.
///
/// Callers must call this while the `notes` row still exists so that the clears
/// are provably not relying on FK cascade — the cascade is a harmless no-op after.
pub fn remove(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
    note_id: i32,
    note_path: &str,
) -> Result<ReconcileOutcome, String> {
    conn.transaction::<_, diesel::result::Error, _>(|c| {
        diesel::delete(nt::note_tags.filter(nt::note_path.eq(note_path))).execute(c)?;
        diesel::delete(nl::note_links.filter(nl::source_id.eq(note_id))).execute(c)?;
        diesel::delete(na::note_aliases.filter(na::note_id.eq(note_id))).execute(c)?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;

    let search_stale = match index {
        Some(idx) => crate::search::remove_note(idx, note_id).is_err(),
        None => true,
    };

    Ok(ReconcileOutcome { search_stale })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::Note;
    use diesel::connection::SimpleConnection;
    use diesel::Connection;
    use tempfile::TempDir;

    fn test_conn() -> SqliteConnection {
        let mut conn =
            SqliteConnection::establish(":memory:").expect("in-memory db");
        conn.batch_execute(
            "PRAGMA foreign_keys = ON;
            CREATE TABLE notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                icon TEXT,
                cover_image TEXT,
                parent_path TEXT,
                archived INTEGER NOT NULL DEFAULT 0,
                modified_at TEXT NOT NULL DEFAULT (datetime('now'))
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
            CREATE TABLE note_tags (
                note_path TEXT NOT NULL,
                tag TEXT NOT NULL,
                PRIMARY KEY (note_path, tag)
            );",
        )
        .expect("create tables");
        conn
    }

    fn make_note(id: i32, path: &str) -> Note {
        Note {
            id,
            path: path.to_string(),
            title: "Test Note".to_string(),
            icon: None,
            cover_image: None,
            parent_path: None,
            archived: false,
            modified_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    fn insert_note(conn: &mut SqliteConnection, note: &Note) {
        conn.batch_execute(&format!(
            "INSERT INTO notes (id, path, title) VALUES ({}, '{}', '{}')",
            note.id, note.path, note.title
        ))
        .unwrap();
    }

    // ── DerivedFacets ─────────────────────────────────────────────────────────

    #[test]
    fn derived_facets_extracts_all_fields_from_one_parse() {
        let content =
            "---\ntags: [npc, allied]\naliases: [Captain Ash]\n---\nSee [[dragon.md]] for details.";
        let facets = DerivedFacets::extract(content);
        assert_eq!(facets.tags, vec!["npc", "allied"]);
        assert_eq!(facets.aliases, vec!["Captain Ash"]);
        assert_eq!(facets.links, vec!["dragon.md"]);
        assert!(facets.body_text.contains("See"));
        assert!(!facets.body_text.contains("---"), "frontmatter must be stripped from body");
    }

    #[test]
    fn derived_facets_empty_content_gives_empty_fields() {
        let facets = DerivedFacets::extract("");
        assert!(facets.tags.is_empty());
        assert!(facets.aliases.is_empty());
        assert!(facets.links.is_empty());
        assert!(facets.body_text.is_empty());
    }

    #[test]
    fn derived_facets_body_only_content() {
        let content = "Just plain body text.";
        let facets = DerivedFacets::extract(content);
        assert!(facets.tags.is_empty());
        assert!(facets.aliases.is_empty());
        assert!(facets.links.is_empty());
        assert_eq!(facets.body_text, "Just plain body text.");
    }

    // ── reconcile — all four indexes written ──────────────────────────────────

    #[test]
    fn reconcile_writes_note_links() {
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        let content = "See [[dragon.md]] and [[castle.md]].";
        reconcile(&mut conn, None, &note, content, None).unwrap();

        let mut links: Vec<String> = nl::note_links
            .select(nl::target_path)
            .load(&mut conn)
            .unwrap();
        links.sort();
        assert_eq!(links, vec!["castle.md", "dragon.md"]);
    }

    #[test]
    fn reconcile_writes_note_aliases() {
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        let content = "---\naliases: [Captain Ash, The Wizard]\n---\nBody.";
        reconcile(&mut conn, None, &note, content, None).unwrap();

        let mut aliases: Vec<String> = na::note_aliases
            .select(na::alias)
            .load(&mut conn)
            .unwrap();
        aliases.sort();
        assert_eq!(aliases, vec!["Captain Ash", "The Wizard"]);
    }

    #[test]
    fn reconcile_writes_note_tags() {
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        let content = "---\ntags: [npc, allied]\n---\nBody.";
        reconcile(&mut conn, None, &note, content, None).unwrap();

        let mut tags: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        tags.sort();
        assert_eq!(tags, vec!["allied", "npc"]);
    }

    #[test]
    fn reconcile_returns_search_stale_true_when_no_index() {
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        let outcome = reconcile(&mut conn, None, &note, "body", None).unwrap();
        assert!(outcome.search_stale);
    }

    #[test]
    fn reconcile_with_valid_index_returns_search_stale_false() {
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        let dir = TempDir::new().unwrap();
        let index = crate::search::rebuild_index(dir.path(), &[], &[], &[]).unwrap();

        let outcome = reconcile(&mut conn, Some(&index), &note, "body", None).unwrap();
        assert!(!outcome.search_stale, "valid Tantivy write must not be stale");
    }

    // ── reconcile — transaction atomicity ────────────────────────────────────

    #[test]
    fn reconcile_all_three_sqlite_writes_succeed_together() {
        let mut conn = test_conn();
        let note = make_note(1, "test.md");
        insert_note(&mut conn, &note);

        let content =
            "---\ntags: [creature]\naliases: [Drake]\n---\nLinks [[other.md]].";
        reconcile(&mut conn, None, &note, content, None).unwrap();

        let links: Vec<(i32, String)> = nl::note_links.load(&mut conn).unwrap();
        let aliases: Vec<(i32, String)> = na::note_aliases.load(&mut conn).unwrap();
        let tags: Vec<(String, String)> = nt::note_tags.load(&mut conn).unwrap();

        assert!(!links.is_empty(), "note_links must be written");
        assert!(!aliases.is_empty(), "note_aliases must be written");
        assert!(!tags.is_empty(), "note_tags must be written");
    }

    #[test]
    fn reconcile_replaces_previous_rows_on_second_call() {
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        reconcile(&mut conn, None, &note, "---\ntags: [old]\n---\n[[old.md]].", None).unwrap();
        reconcile(&mut conn, None, &note, "---\ntags: [new]\n---\n[[new.md]].", None).unwrap();

        let links: Vec<String> = nl::note_links.select(nl::target_path).load(&mut conn).unwrap();
        assert_eq!(links, vec!["new.md"]);

        let tags: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        assert_eq!(tags, vec!["new"]);
    }

    // ── reconcile — Tantivy best-effort ──────────────────────────────────────

    #[test]
    fn tantivy_failure_leaves_sqlite_intact_and_surfaces_search_stale() {
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        // Empty schema — index_note will fail because required fields are missing
        let bad_schema = tantivy::schema::Schema::builder().build();
        let bad_index = tantivy::Index::create_in_ram(bad_schema);

        let content = "---\ntags: [npc]\naliases: [Captain]\n---\n[[target.md]].";
        let outcome = reconcile(&mut conn, Some(&bad_index), &note, content, None).unwrap();

        assert!(outcome.search_stale, "Tantivy failure must surface as search_stale");

        // All SQLite writes must have succeeded despite the Tantivy failure
        let tags: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        assert_eq!(tags, vec!["npc"], "note_tags must be written even on Tantivy failure");

        let aliases: Vec<String> = na::note_aliases.select(na::alias).load(&mut conn).unwrap();
        assert_eq!(aliases, vec!["Captain"], "note_aliases must be written even on Tantivy failure");

        let links: Vec<String> = nl::note_links.select(nl::target_path).load(&mut conn).unwrap();
        assert_eq!(links, vec!["target.md"], "note_links must be written even on Tantivy failure");
    }

    // ── reconcile — prev_path re-keying ──────────────────────────────────────

    #[test]
    fn prev_path_different_clears_old_note_tags() {
        let mut conn = test_conn();
        let note = make_note(1, "new.md");
        insert_note(&mut conn, &note);

        // Seed old path tags directly
        conn.batch_execute(
            "INSERT INTO note_tags (note_path, tag) VALUES ('old.md', 'oldtag')",
        )
        .unwrap();

        let content = "---\ntags: [newtag]\n---\nBody.";
        reconcile(&mut conn, None, &note, content, Some("old.md")).unwrap();

        // old.md tags must be cleared
        let old_tags: Vec<String> = nt::note_tags
            .filter(nt::note_path.eq("old.md"))
            .select(nt::tag)
            .load(&mut conn)
            .unwrap();
        assert!(old_tags.is_empty(), "old path tags must be cleared on re-key");

        // new.md tags must be written
        let new_tags: Vec<String> = nt::note_tags
            .filter(nt::note_path.eq("new.md"))
            .select(nt::tag)
            .load(&mut conn)
            .unwrap();
        assert_eq!(new_tags, vec!["newtag"]);
    }

    #[test]
    fn prev_path_same_as_note_path_no_spurious_clear() {
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        let content = "---\ntags: [npc]\n---\nBody.";
        // When prev_path == note.path there should be no double-clear issue
        reconcile(&mut conn, None, &note, content, Some("ash.md")).unwrap();

        let tags: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        assert_eq!(tags, vec!["npc"]);
    }

    // ── regression: update_note wikilink hole ────────────────────────────────

    /// Before #65, update_note never refreshed note_links; only write_note_content
    /// called reconcile. This test documents the invariant: calling reconcile with
    /// prev_path: Some(old) (the update_note pattern) updates note_links correctly.
    #[test]
    fn update_via_reconcile_refreshes_note_links_regression() {
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        // Initial state: no wikilinks (simulates create_note with empty content)
        reconcile(&mut conn, None, &note, "", None).unwrap();
        let initial_links: Vec<String> =
            nl::note_links.select(nl::target_path).load(&mut conn).unwrap();
        assert!(initial_links.is_empty(), "new note must start with no links");

        // Simulate update_note: content changes to add wikilinks
        let updated_content = "See [[dragon.md]] and [[castle.md]].";
        reconcile(&mut conn, None, &note, updated_content, Some("ash.md")).unwrap();

        let mut links: Vec<String> =
            nl::note_links.select(nl::target_path).load(&mut conn).unwrap();
        links.sort();
        assert_eq!(
            links,
            vec!["castle.md", "dragon.md"],
            "note_links must be refreshed after content update"
        );
    }

    /// rename_note regression: reconcile with prev_path: Some(old) re-asserts all
    /// four indexes for the renamed note — old-path note_tags cleared, new-path
    /// note_tags written, note_links and note_aliases re-asserted from content.
    #[test]
    fn rename_via_reconcile_reasserts_all_four_indexes_regression() {
        let mut conn = test_conn();
        // Note is now at new.md after the rename
        let note = make_note(1, "new.md");
        insert_note(&mut conn, &note);

        // Seed old-path tags that must be cleared by reconcile(prev_path: Some("old.md"))
        conn.batch_execute(
            "INSERT INTO note_tags (note_path, tag) VALUES ('old.md', 'stale')",
        )
        .unwrap();

        let content = "---\ntags: [keeper]\naliases: [The Keeper]\n---\nSee [[dragon.md]].";
        reconcile(&mut conn, None, &note, content, Some("old.md")).unwrap();

        // old.md tags must be gone
        let old_tags: Vec<String> = nt::note_tags
            .filter(nt::note_path.eq("old.md"))
            .select(nt::tag)
            .load(&mut conn)
            .unwrap();
        assert!(old_tags.is_empty(), "old-path note_tags must be cleared on rename");

        // new.md tags must be written
        let new_tags: Vec<String> = nt::note_tags
            .filter(nt::note_path.eq("new.md"))
            .select(nt::tag)
            .load(&mut conn)
            .unwrap();
        assert_eq!(new_tags, vec!["keeper"]);

        // note_links must be re-asserted
        let links: Vec<String> = nl::note_links.select(nl::target_path).load(&mut conn).unwrap();
        assert_eq!(links, vec!["dragon.md"], "note_links must be re-asserted on rename");

        // note_aliases must be re-asserted
        let aliases: Vec<String> = na::note_aliases.select(na::alias).load(&mut conn).unwrap();
        assert_eq!(aliases, vec!["The Keeper"], "note_aliases must be re-asserted on rename");
    }

    // ── remove ───────────────────────────────────────────────────────────────

    /// Acceptance criterion: rows must be gone BEFORE the `notes` row is deleted,
    /// proving remove() does not rely on FK cascade.
    #[test]
    fn remove_clears_all_three_indexes_before_notes_row_deleted() {
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        // Populate all three indexes via reconcile
        let content = "---\ntags: [npc]\naliases: [The Ash]\n---\nSee [[dragon.md]].";
        reconcile(&mut conn, None, &note, content, None).unwrap();

        // Verify indexes are populated
        let tags: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        assert!(!tags.is_empty(), "setup: note_tags must be populated");

        // Call remove() — notes row still exists at this point
        remove(&mut conn, None, note.id, &note.path).unwrap();

        // All three indexes must be empty NOW, before deleting the notes row
        let tags: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        assert!(tags.is_empty(), "note_tags must be cleared by remove() explicitly");

        let links: Vec<String> = nl::note_links.select(nl::target_path).load(&mut conn).unwrap();
        assert!(links.is_empty(), "note_links must be cleared by remove() explicitly");

        let aliases: Vec<String> = na::note_aliases.select(na::alias).load(&mut conn).unwrap();
        assert!(aliases.is_empty(), "note_aliases must be cleared by remove() explicitly");
    }

    #[test]
    fn remove_returns_search_stale_true_when_no_index() {
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        let outcome = remove(&mut conn, None, note.id, &note.path).unwrap();
        assert!(outcome.search_stale);
    }

    #[test]
    fn remove_with_valid_index_returns_search_stale_false() {
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        let dir = TempDir::new().unwrap();
        let index = crate::search::rebuild_index(dir.path(), &[], &[], &[]).unwrap();

        let outcome = remove(&mut conn, Some(&index), note.id, &note.path).unwrap();
        assert!(!outcome.search_stale, "valid Tantivy delete must not be stale");
    }

    // ── stale marker utilities ────────────────────────────────────────────────

    #[test]
    fn write_search_stale_marker_creates_file() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join(".grimoire")).unwrap();
        write_search_stale_marker(dir.path());
        assert!(stale_marker_path(dir.path()).exists(), "marker file must be created");
    }

    #[test]
    fn clear_search_stale_marker_removes_file() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join(".grimoire")).unwrap();
        write_search_stale_marker(dir.path());
        clear_search_stale_marker(dir.path());
        assert!(!stale_marker_path(dir.path()).exists(), "marker file must be removed");
    }

    #[test]
    fn clear_search_stale_marker_is_noop_when_absent() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join(".grimoire")).unwrap();
        clear_search_stale_marker(dir.path()); // must not panic
        assert!(!stale_marker_path(dir.path()).exists());
    }

    #[test]
    fn prev_path_none_no_re_key_attempted() {
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        // Seed a sibling note's tags — must survive
        conn.batch_execute(
            "INSERT INTO note_tags (note_path, tag) VALUES ('other.md', 'sibling')",
        )
        .unwrap();

        reconcile(&mut conn, None, &note, "---\ntags: [npc]\n---\nBody.", None).unwrap();

        // sibling's tags must be untouched
        let sibling: Vec<String> = nt::note_tags
            .filter(nt::note_path.eq("other.md"))
            .select(nt::tag)
            .load(&mut conn)
            .unwrap();
        assert_eq!(sibling, vec!["sibling"]);
    }
}
