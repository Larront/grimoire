// note_index — owns the Derived Index family behind a single `reconcile` operation.
//
// `DerivedFacets` parses the note content exactly once; `reconcile` writes
// note_links, note_aliases, and note_tags inside a single SQLite transaction,
// then updates the Tantivy Search Index on a best-effort basis.
//
// A failed Search Index write is *recorded here* rather than reported upwards
// (issue #205). The seam used to hand every caller back a `ReconcileOutcome
// { search_stale }` and leave them to remember `mark_stale_if_needed`, which nine
// call sites did and one — the manual rebuild command — did not. That apparatus
// maintained a `.grimoire/search.stale` file nothing ever read: the marker cannot
// change what the app does, because `open_ledger` rebuilds the whole index from a
// ledger walk on every open whether it is there or not. Making it matter would
// have meant *skipping* that rebuild, which is the one thing standing between the
// GM and a vault edited while Grimoire was closed. So the marker is gone and the
// failure goes to the log, through `search::best_effort` — the same call maps and
// scenes make, so a miss looks the same wherever it happened (#216).

use crate::commands::frontmatter;
use crate::commands::links::extract_wikilinks;
use crate::db::models::{Map, Note, Scene};
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

/// Write the three derived-index tables for `note` inside an already-open
/// transaction. `old_path_to_clear` is `Some(p)` only when `p ≠ note.path`
/// (prevents a double-clear when prev_path == note.path).
fn write_facets(
    c: &mut SqliteConnection,
    note: &Note,
    facets: &DerivedFacets,
    old_path_to_clear: Option<&str>,
) -> Result<(), diesel::result::Error> {
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
) -> Result<(), String> {
    let facets = DerivedFacets::extract(content);
    let old_path_to_clear = prev_path.filter(|&p| p != note.path.as_str());

    conn.transaction::<_, diesel::result::Error, _>(|c| {
        write_facets(c, note, &facets, old_path_to_clear)
    })
    .map_err(|e| e.to_string())?;

    // Best-effort Tantivy write — failure must not abort the SQLite writes above
    crate::search::best_effort(index, &format!("note '{}'", note.path), |idx| {
        crate::search::index_note(idx, note, &facets.body_text, &facets.tags)
    });

    Ok(())
}

/// One item in a bulk reconcile batch.
pub struct ReconcileManyItem {
    pub note: Note,
    pub content: String,
    pub prev_path: Option<String>,
}

/// Bulk reconcile: extract all facets, write every item's derived indexes in
/// **one** SQLite transaction, then issue **one** batched Tantivy commit.
///
/// An empty slice does nothing at all — in particular it does not log a miss,
/// because a batch with no items has nothing that failed to reach the index.
pub fn reconcile_many(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
    items: &[ReconcileManyItem],
) -> Result<(), String> {
    if items.is_empty() {
        return Ok(());
    }

    let extracted: Vec<DerivedFacets> = items
        .iter()
        .map(|item| DerivedFacets::extract(&item.content))
        .collect();

    conn.transaction::<_, diesel::result::Error, _>(|c| {
        for (item, facets) in items.iter().zip(extracted.iter()) {
            let old_path_to_clear = item
                .prev_path
                .as_deref()
                .filter(|&p| p != item.note.path.as_str());
            write_facets(c, &item.note, facets, old_path_to_clear)?;
        }
        Ok(())
    })
    .map_err(|e| e.to_string())?;

    let what = format!("{} note(s)", items.len());
    crate::search::best_effort(index, &what, |idx| {
        let batch: Vec<(&Note, &str, &[String])> = items
            .iter()
            .zip(extracted.iter())
            .map(|(item, facets)| {
                (&item.note, facets.body_text.as_str(), facets.tags.as_slice())
            })
            .collect();
        crate::search::index_notes_batch(idx, &batch)
    });

    Ok(())
}

/// The per-file rows accumulated by a single ledger walk, ready for bulk insert.
/// Tags are path-keyed (collected for every `.md` file); links, aliases, and the
/// search `note_data` are note_id-keyed and only collected when a DB row exists.
#[derive(Default)]
struct CollectedFacets {
    tag_rows: Vec<(String, String)>,
    link_rows: Vec<(i32, String)>,
    alias_rows: Vec<(i32, String)>,
    note_data: Vec<(Note, String, Vec<String>)>,
}

/// Walk the ledger once, parse each `.md` file into `DerivedFacets` exactly once,
/// and populate all four derived indexes (note_tags, note_links, note_aliases,
/// Tantivy Search). SQLite inserts are chunked/bulk inside a single transaction.
/// The Search rebuild is non-fatal — failure returns `Ok(None)`.
pub fn rebuild_all_from_ledger(
    ledger_path: &std::path::Path,
    conn: &mut SqliteConnection,
    maps: &[Map],
    scenes: &[Scene],
) -> Result<Option<tantivy::Index>, String> {
    use crate::db::schema::notes::dsl as notes_dsl;

    let note_rows: Vec<Note> = notes_dsl::notes.load(conn).map_err(|e| e.to_string())?;

    let path_to_note: std::collections::HashMap<String, &Note> =
        note_rows.iter().map(|note| (note.path.clone(), note)).collect();

    let mut facets = CollectedFacets::default();
    collect_all_facets(ledger_path, "", &path_to_note, &mut facets)?;

    conn.transaction::<_, diesel::result::Error, _>(|c| {
        diesel::delete(nt::note_tags).execute(c)?;
        diesel::delete(nl::note_links).execute(c)?;
        diesel::delete(na::note_aliases).execute(c)?;

        let mut seen_tags: BTreeSet<(String, String)> = BTreeSet::new();
        let unique_tags: Vec<_> = facets
            .tag_rows
            .into_iter()
            .filter(|(path, tag)| seen_tags.insert((path.clone(), tag.to_lowercase())))
            .collect();
        for chunk in unique_tags.chunks(100) {
            let vals: Vec<_> = chunk
                .iter()
                .map(|(path, tag)| (nt::note_path.eq(path.as_str()), nt::tag.eq(tag.as_str())))
                .collect();
            diesel::insert_into(nt::note_tags).values(&vals).execute(c)?;
        }

        for chunk in facets.link_rows.chunks(100) {
            let vals: Vec<_> = chunk
                .iter()
                .map(|(sid, tp)| (nl::source_id.eq(*sid), nl::target_path.eq(tp.as_str())))
                .collect();
            diesel::insert_into(nl::note_links).values(&vals).execute(c)?;
        }

        let mut seen_aliases: BTreeSet<(i32, String)> = BTreeSet::new();
        let unique_aliases: Vec<_> = facets
            .alias_rows
            .into_iter()
            .filter(|(nid, alias)| seen_aliases.insert((*nid, alias.to_lowercase())))
            .collect();
        for chunk in unique_aliases.chunks(100) {
            let vals: Vec<_> = chunk
                .iter()
                .map(|(nid, alias)| (na::note_id.eq(*nid), na::alias.eq(alias.as_str())))
                .collect();
            diesel::insert_into(na::note_aliases).values(&vals).execute(c)?;
        }

        Ok(())
    })
    .map_err(|e| e.to_string())?;

    let search_index =
        crate::search::rebuild_index_from_note_data(ledger_path, &facets.note_data, maps, scenes)
            .ok();

    Ok(search_index)
}

fn collect_all_facets(
    dir: &std::path::Path,
    relative: &str,
    path_to_note: &std::collections::HashMap<String, &Note>,
    facets: &mut CollectedFacets,
) -> Result<(), String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
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
            collect_all_facets(&entry_path, &child_rel, path_to_note, facets)?;
        } else if name.ends_with(".md") {
            if let Ok(content) = std::fs::read_to_string(&entry_path) {
                let extracted = DerivedFacets::extract(&content);
                for tag in &extracted.tags {
                    facets.tag_rows.push((child_rel.clone(), tag.clone()));
                }
                if let Some(&note) = path_to_note.get(&child_rel) {
                    for target in &extracted.links {
                        facets.link_rows.push((note.id, target.clone()));
                    }
                    for alias in &extracted.aliases {
                        facets.alias_rows.push((note.id, alias.clone()));
                    }
                    facets
                        .note_data
                        .push((note.clone(), extracted.body_text, extracted.tags));
                }
            }
        }
    }
    Ok(())
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
) -> Result<(), String> {
    conn.transaction::<_, diesel::result::Error, _>(|c| {
        diesel::delete(nt::note_tags.filter(nt::note_path.eq(note_path))).execute(c)?;
        diesel::delete(nl::note_links.filter(nl::source_id.eq(note_id))).execute(c)?;
        diesel::delete(na::note_aliases.filter(na::note_id.eq(note_id))).execute(c)?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;

    crate::search::best_effort(index, &format!("removal of note '{note_path}'"), |idx| {
        crate::search::remove_note(idx, note_id)
    });

    Ok(())
}

/// The bulk form of [`remove`]: clear the Derived Index for many notes at once —
/// one SQLite transaction for all three tables, one Tantivy commit for all the
/// documents. Same ordering obligation as [`remove`]: call it while the `notes`
/// rows still exist.
///
/// A folder delete is the caller this exists for. Going through [`remove`] per note
/// costs a writer acquisition and a commit each (`search::remove_doc`), which for a
/// folder of a few hundred notes is a long stall with the ledger mutex held —
/// the same cost `index_notes_batch` exists to avoid on the write side.
pub fn remove_many(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
    doomed: &[(i32, String)],
) -> Result<(), String> {
    if doomed.is_empty() {
        return Ok(());
    }

    conn.transaction::<_, diesel::result::Error, _>(|c| {
        for (note_id, note_path) in doomed {
            diesel::delete(nt::note_tags.filter(nt::note_path.eq(note_path))).execute(c)?;
            diesel::delete(nl::note_links.filter(nl::source_id.eq(note_id))).execute(c)?;
            diesel::delete(na::note_aliases.filter(na::note_id.eq(note_id))).execute(c)?;
        }
        Ok(())
    })
    .map_err(|e| e.to_string())?;

    let ids: Vec<i32> = doomed.iter().map(|(id, _)| *id).collect();
    let what = format!("removal of {} note(s)", ids.len());
    crate::search::best_effort(index, &what, |idx| {
        crate::search::remove_notes_batch(idx, &ids)
    });

    Ok(())
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
    fn reconcile_deduplicates_aliases_case_insensitively() {
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        // Case variants of the same alias must collapse to one row (first casing wins).
        let content = "---\naliases: [Captain A, captain a, Ash]\n---\nBody.";
        reconcile(&mut conn, None, &note, content, None).unwrap();

        let mut aliases: Vec<String> = na::note_aliases.select(na::alias).load(&mut conn).unwrap();
        aliases.sort();
        assert_eq!(aliases, vec!["Ash", "Captain A"]);
    }

    #[test]
    fn reconcile_deduplicates_tags_case_insensitively() {
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        // Case variants of the same tag must collapse to one row (first casing wins).
        let content = "---\ntags: [NPC, npc, Allied]\n---\nBody.";
        reconcile(&mut conn, None, &note, content, None).unwrap();

        let mut tags: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        tags.sort();
        assert_eq!(tags, vec!["Allied", "NPC"]);
    }

    /// No index to write to is the commonest miss there is, and it must not take
    /// the SQLite half of the reconcile down with it — the note's tags, links and
    /// aliases are the canonical record and are owed to the caller either way.
    #[test]
    fn reconcile_without_an_index_still_writes_the_sqlite_side() {
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        reconcile(&mut conn, None, &note, "Ash met [[Bram]]", None).unwrap();

        let links: Vec<String> = nl::note_links.select(nl::target_path).load(&mut conn).unwrap();
        assert_eq!(links, vec!["Bram"]);
    }

    #[test]
    fn reconcile_with_a_valid_index_makes_the_note_findable() {
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        let dir = TempDir::new().unwrap();
        let index = crate::search::rebuild_index(dir.path(), &[], &[], &[]).unwrap();

        reconcile(&mut conn, Some(&index), &note, "the captain's ledger", None).unwrap();

        let hits = crate::search::search_notes_in_index(&index, dir.path(), "captain", 10).unwrap();
        assert_eq!(hits.len(), 1, "a reconciled note must be searchable");
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

    // ── remove_many ──────────────────────────────────────────────────────────

    #[test]
    fn remove_many_clears_every_named_note_and_leaves_the_rest() {
        let mut conn = test_conn();
        let doomed = make_note(1, "creatures/dragon.md");
        let doomed_two = make_note(2, "creatures/wyvern.md");
        let bystander = make_note(3, "top-level.md");
        for note in [&doomed, &doomed_two, &bystander] {
            insert_note(&mut conn, note);
            reconcile(
                &mut conn,
                None,
                note,
                "---\ntags: [beast]\naliases: [Scaly]\n---\n[[somewhere.md]]",
                None,
            )
            .unwrap();
        }

        remove_many(
            &mut conn,
            None,
            &[
                (doomed.id, doomed.path.clone()),
                (doomed_two.id, doomed_two.path.clone()),
            ],
        )
        .unwrap();

        let tag_paths: Vec<String> = nt::note_tags.select(nt::note_path).load(&mut conn).unwrap();
        assert_eq!(tag_paths, vec!["top-level.md"]);
        let link_sources: Vec<i32> = nl::note_links.select(nl::source_id).load(&mut conn).unwrap();
        assert_eq!(link_sources, vec![3]);
        let alias_ids: Vec<i32> = na::note_aliases.select(na::note_id).load(&mut conn).unwrap();
        assert_eq!(alias_ids, vec![3]);
    }

    #[test]
    fn remove_many_of_nothing_succeeds() {
        let mut conn = test_conn();
        remove_many(&mut conn, None, &[]).unwrap();
    }

    /// A removal with no index still has a SQLite half to carry out, and the note's
    /// derived rows are what the palette and the backlinks pane read out of the
    /// database — leaving them behind would keep a deleted note visible.
    #[test]
    fn remove_many_without_an_index_still_clears_the_sqlite_side() {
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);
        reconcile(&mut conn, None, &note, "---\ntags: [npc]\n---\n[[Bram]]", None).unwrap();

        remove_many(&mut conn, None, &[(note.id, note.path.clone())]).unwrap();

        let tags: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        assert!(tags.is_empty(), "note_tags must be cleared without an index");
        let links: Vec<String> = nl::note_links.select(nl::target_path).load(&mut conn).unwrap();
        assert!(links.is_empty(), "note_links must be cleared without an index");
    }

    // ── reconcile — Tantivy best-effort ──────────────────────────────────────

    #[test]
    fn tantivy_failure_leaves_sqlite_intact() {
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        // Empty schema — index_note will fail because required fields are missing
        let bad_schema = tantivy::schema::Schema::builder().build();
        let bad_index = tantivy::Index::create_in_ram(bad_schema);

        let content = "---\ntags: [npc]\naliases: [Captain]\n---\n[[target.md]].";
        // The failure is logged inside the seam (#205) and must not become the
        // caller's problem: the reconcile the GM asked for still succeeded.
        reconcile(&mut conn, Some(&bad_index), &note, content, None).unwrap();

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
    fn remove_with_a_valid_index_takes_the_note_out_of_search() {
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        let dir = TempDir::new().unwrap();
        let index = crate::search::rebuild_index(dir.path(), &[], &[], &[]).unwrap();
        reconcile(&mut conn, Some(&index), &note, "the captain's ledger", None).unwrap();

        remove(&mut conn, Some(&index), note.id, &note.path).unwrap();

        let hits = crate::search::search_notes_in_index(&index, dir.path(), "captain", 10).unwrap();
        assert!(hits.is_empty(), "a removed note must stop being searchable");
    }

    /// The Search Index write is best-effort, and a failed one must not turn a
    /// delete the GM asked for into an error. It is recorded in the log instead
    /// (#205) and healed by the rebuild at the next open.
    #[test]
    fn a_failed_search_delete_does_not_fail_the_remove() {
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        let bad_schema = tantivy::schema::Schema::builder().build();
        let bad_index = tantivy::Index::create_in_ram(bad_schema);

        remove(&mut conn, Some(&bad_index), note.id, &note.path).unwrap();
    }

    // ── rebuild_all_from_ledger ───────────────────────────────────────────────

    #[test]
    fn rebuild_all_from_empty_ledger_yields_no_rows() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        rebuild_all_from_ledger(dir.path(), &mut conn, &[], &[]).unwrap();

        let tags: Vec<(String, String)> = nt::note_tags.load(&mut conn).unwrap();
        let links: Vec<(i32, String)> = nl::note_links.load(&mut conn).unwrap();
        let aliases: Vec<(i32, String)> = na::note_aliases.load(&mut conn).unwrap();
        assert!(tags.is_empty());
        assert!(links.is_empty());
        assert!(aliases.is_empty());
    }

    #[test]
    fn rebuild_all_populates_tags_links_aliases_from_single_walk() {
        let dir = TempDir::new().unwrap();
        std::fs::write(
            dir.path().join("ash.md"),
            "---\ntags: [npc, allied]\naliases: [Captain Ash]\n---\nSee [[dragon.md]].",
        )
        .unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, &make_note(1, "ash.md"));

        rebuild_all_from_ledger(dir.path(), &mut conn, &[], &[]).unwrap();

        let mut tags: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        tags.sort();
        assert_eq!(tags, vec!["allied", "npc"]);

        let links: Vec<String> = nl::note_links.select(nl::target_path).load(&mut conn).unwrap();
        assert_eq!(links, vec!["dragon.md"]);

        let aliases: Vec<String> = na::note_aliases.select(na::alias).load(&mut conn).unwrap();
        assert_eq!(aliases, vec!["Captain Ash"]);
    }

    #[test]
    fn rebuild_all_replaces_stale_entries_on_second_call() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("a.md"), "---\ntags: [old]\n---\n[[old.md]].").unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, &make_note(1, "a.md"));

        rebuild_all_from_ledger(dir.path(), &mut conn, &[], &[]).unwrap();

        std::fs::write(dir.path().join("a.md"), "---\ntags: [new]\n---\n[[new.md]].").unwrap();
        rebuild_all_from_ledger(dir.path(), &mut conn, &[], &[]).unwrap();

        let tags: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        assert_eq!(tags, vec!["new"]);

        let links: Vec<String> = nl::note_links.select(nl::target_path).load(&mut conn).unwrap();
        assert_eq!(links, vec!["new.md"]);
    }

    #[test]
    fn rebuild_all_skips_hidden_directories() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir(dir.path().join(".grimoire")).unwrap();
        std::fs::write(
            dir.path().join(".grimoire").join("hidden.md"),
            "---\ntags: [should_not_appear]\n---\n",
        )
        .unwrap();

        let mut conn = test_conn();
        rebuild_all_from_ledger(dir.path(), &mut conn, &[], &[]).unwrap();

        let rows: Vec<(String, String)> = nt::note_tags.load(&mut conn).unwrap();
        assert!(rows.is_empty(), "hidden directory must be skipped");
    }

    #[test]
    fn rebuild_all_note_without_db_row_skips_links_and_aliases() {
        let dir = TempDir::new().unwrap();
        // File on disk but no corresponding notes row — links/aliases can't be keyed
        std::fs::write(
            dir.path().join("ghost.md"),
            "---\ntags: [orphan]\naliases: [Ghost]\n---\nSee [[other.md]].",
        )
        .unwrap();

        let mut conn = test_conn();
        // Do NOT insert a notes row for ghost.md

        rebuild_all_from_ledger(dir.path(), &mut conn, &[], &[]).unwrap();

        // Tags are path-keyed so they are written even without a DB row
        let tags: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        assert_eq!(tags, vec!["orphan"], "tags must be written even for unknown notes");

        // Links and aliases require a note ID, so they must be absent
        let links: Vec<String> = nl::note_links.select(nl::target_path).load(&mut conn).unwrap();
        assert!(links.is_empty(), "links must not be written without a DB row");

        let aliases: Vec<String> = na::note_aliases.select(na::alias).load(&mut conn).unwrap();
        assert!(aliases.is_empty(), "aliases must not be written without a DB row");
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

    // ── reconcile_many ────────────────────────────────────────────────────────

    #[test]
    fn reconcile_many_writes_all_four_indexes_for_each_item() {
        let mut conn = test_conn();
        let note1 = make_note(1, "alpha.md");
        let note2 = make_note(2, "beta.md");
        insert_note(&mut conn, &note1);
        insert_note(&mut conn, &note2);

        let dir = TempDir::new().unwrap();
        let index = crate::search::rebuild_index(dir.path(), &[], &[], &[]).unwrap();

        let items = vec![
            ReconcileManyItem {
                note: note1.clone(),
                content: "---\ntags: [npc]\naliases: [Alpha]\n---\n[[target.md]].".to_string(),
                prev_path: None,
            },
            ReconcileManyItem {
                note: note2.clone(),
                content: "---\ntags: [location]\naliases: [Beta Base]\n---\n[[alpha.md]].".to_string(),
                prev_path: None,
            },
        ];

        reconcile_many(&mut conn, Some(&index), &items).unwrap();

        let tags1: Vec<String> = nt::note_tags
            .filter(nt::note_path.eq("alpha.md"))
            .select(nt::tag)
            .load(&mut conn)
            .unwrap();
        assert_eq!(tags1, vec!["npc"]);

        let aliases1: Vec<String> = na::note_aliases
            .filter(na::note_id.eq(1))
            .select(na::alias)
            .load(&mut conn)
            .unwrap();
        assert_eq!(aliases1, vec!["Alpha"]);

        let links1: Vec<String> = nl::note_links
            .filter(nl::source_id.eq(1))
            .select(nl::target_path)
            .load(&mut conn)
            .unwrap();
        assert_eq!(links1, vec!["target.md"]);

        let tags2: Vec<String> = nt::note_tags
            .filter(nt::note_path.eq("beta.md"))
            .select(nt::tag)
            .load(&mut conn)
            .unwrap();
        assert_eq!(tags2, vec!["location"]);

        let r1 = crate::search::search_notes_in_index(&index, dir.path(), "tag:npc", 10).unwrap();
        assert_eq!(r1.len(), 1);
        assert_eq!(r1[0].id, 1);

        let r2 = crate::search::search_notes_in_index(&index, dir.path(), "tag:location", 10).unwrap();
        assert_eq!(r2.len(), 1);
        assert_eq!(r2[0].id, 2);
    }

    #[test]
    fn reconcile_many_folder_rename_rekeyes_note_tags_and_updates_tantivy_path() {
        let mut conn = test_conn();
        let note = make_note(1, "new.md");
        insert_note(&mut conn, &note);
        // Seed old-path tags
        conn.batch_execute("INSERT INTO note_tags (note_path, tag) VALUES ('old.md', 'npc')")
            .unwrap();

        let dir = TempDir::new().unwrap();
        let index = crate::search::rebuild_index(dir.path(), &[], &[], &[]).unwrap();

        let items = vec![ReconcileManyItem {
            note: note.clone(),
            content: "---\ntags: [npc]\n---\nBody.".to_string(),
            prev_path: Some("old.md".to_string()),
        }];

        reconcile_many(&mut conn, Some(&index), &items).unwrap();

        let old_tags: Vec<String> = nt::note_tags
            .filter(nt::note_path.eq("old.md"))
            .select(nt::tag)
            .load(&mut conn)
            .unwrap();
        assert!(old_tags.is_empty(), "old path tags must be cleared");

        let new_tags: Vec<String> = nt::note_tags
            .filter(nt::note_path.eq("new.md"))
            .select(nt::tag)
            .load(&mut conn)
            .unwrap();
        assert_eq!(new_tags, vec!["npc"]);

        let results =
            crate::search::search_notes_in_index(&index, dir.path(), "tag:npc", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "new.md", "Tantivy must store the new path");
    }

    #[test]
    fn reconcile_many_atomicity_failed_item_rolls_back_sqlite() {
        let mut conn = test_conn();
        let note1 = make_note(1, "alpha.md");
        insert_note(&mut conn, &note1);
        // note2 id=999 not in DB → FK violation on note_links when content has a wikilink
        let note2 = make_note(999, "ghost.md");

        let items = vec![
            ReconcileManyItem {
                note: note1.clone(),
                content: "---\ntags: [npc]\n---\nBody.".to_string(),
                prev_path: None,
            },
            ReconcileManyItem {
                note: note2,
                content: "---\ntags: [loc]\n---\nSee [[link.md]].".to_string(),
                prev_path: None,
            },
        ];

        let result = reconcile_many(&mut conn, None, &items);
        assert!(result.is_err(), "must fail on FK violation");

        // Transaction must be rolled back — note1 writes must not persist
        let links: Vec<(i32, String)> = nl::note_links.load(&mut conn).unwrap();
        assert!(links.is_empty(), "note_links must be rolled back on batch failure");
    }

    #[test]
    fn reconcile_many_empty_slice_is_noop() {
        let mut conn = test_conn();
        reconcile_many(&mut conn, None, &[]).unwrap();
    }

    #[test]
    fn template_note_with_tags_is_indexed_by_reconcile() {
        let mut conn = test_conn();
        let note = make_note(1, "quest.md");
        insert_note(&mut conn, &note);

        let dir = TempDir::new().unwrap();
        let index = crate::search::rebuild_index(dir.path(), &[], &[], &[]).unwrap();

        let template_content =
            "---\ntags: [quest, main-story]\n---\n# Quest Template\nDescribe the quest.";
        reconcile(&mut conn, Some(&index), &note, template_content, None).unwrap();

        let results =
            crate::search::search_notes_in_index(&index, dir.path(), "tag:quest", 10).unwrap();
        assert_eq!(results.len(), 1, "note must be findable by tag from template content");
        assert_eq!(results[0].id, 1);

        let mut tags: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        tags.sort();
        assert_eq!(tags, vec!["main-story", "quest"]);
    }
}
