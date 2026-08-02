//! Keeping the scene name cached in a note's ` ```scene ` fence true (#185).
//!
//! A [[Scene]] reference carries the scene's **id** (the truth) and its **name** (a
//! legible copy the database owns), so that a GM reading the note in Obsidian sees
//! a name and a full-text search for that name finds the note. A copy with an owner
//! elsewhere is either synced or lying, and a stale name does not fail loudly — it
//! *lies*, finding the note under a name the scene no longer has and missing its
//! current one. So renaming a scene rewrites the name wherever it appears.
//!
//! ## Two things about this module that were argued about
//!
//! **It is a second *caller* of an existing writer, not a second writer.** The
//! bytes go out through [`crate::note_mutation::commit_backlink_rewrites`] — the
//! same batched write-and-reconcile a note rename's backlink rewrites use — so the
//! rule that only the editor writes note bytes holds in the shape it already had,
//! and every condition of that path is inherited rather than re-implemented:
//! writes go through the [[Write Chokepoint]] (so the Ledger Watcher reads them as
//! Grimoire's own echo rather than as external edits), and the four Derived Indexes
//! are reconciled in one transaction.
//!
//! **Flagged when the decision was taken and still true: this is a bulk note edit
//! with no prompt.** A note open in an editor with unsaved changes keeps its buffer,
//! and its next autosave writes the old name back — the same edge the planned
//! repair-backlinks tool exists for. It is not made worse by being here: a rename
//! touches only the notes that reference the renamed scene, which is a far smaller
//! set than a folder move's backlinks.
//!
//! **The grammar is duplicated in Rust, and that is a real cost.** ADR-0016 §3 says
//! a block's parser is the editor's; this rewrite has to find a fence in a *file*
//! from the backend, so it holds the smallest possible reading of the format — find
//! the fence, find its `Id:` line, replace its `#` line — and touches nothing else
//! in the body. Every other line a GM put in there survives verbatim, which is
//! stronger than what the editor's own round trip promises. If the scene fence
//! grammar changes, this file changes with it; `scene-block.test.ts` and the tests
//! below are the pair that will disagree loudly.

use crate::db::models::Note;
use crate::db::schema::notes::dsl as nd;
use diesel::prelude::*;
use diesel::SqliteConnection;
use std::path::Path;

/// Rewrite the cached name of scene `scene_id` to `new_name` in every note that
/// references it, returning how many notes were rewritten.
///
/// Notes whose fences already carry the new name are not written — the count is what
/// actually changed on disk, so a rename that renames nothing is silent.
///
/// [[Template]]s are deliberately out of scope: they have no `notes` row to
/// reconcile, exactly as a note rename's backlink rewrite leaves them alone. A
/// template holding a scene reference keeps whatever name it was authored with,
/// which is wrong in the same small way and in the same place as everywhere else
/// that path does not reach.
pub fn propagate_rename(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
    ledger_path: &Path,
    scene_id: i32,
    new_name: &str,
) -> Result<usize, String> {
    let notes: Vec<Note> = nd::notes.load(conn).map_err(|e| e.to_string())?;

    let mut rewrites: Vec<(Note, String)> = Vec::new();
    for note in notes {
        // A note whose file cannot be read is skipped rather than failing the
        // rename: the scene *is* renamed either way, and refusing the rename over
        // one unreadable note would trade a stale copy for a blocked gesture.
        let full_path = ledger_path.join(&note.path);
        let content = match std::fs::read_to_string(&full_path) {
            Ok(content) => content,
            Err(_) => continue,
        };
        if let Some(rewritten) = rename_in_text(&content, scene_id, new_name) {
            rewrites.push((note, rewritten));
        }
    }

    crate::note_mutation::commit_backlink_rewrites(conn, index, ledger_path, rewrites)
}

// ── The text rewrite ─────────────────────────────────────────────────────────

/// One note's text with scene `scene_id`'s cached name brought up to date, or
/// `None` when nothing in it needed changing.
///
/// Exposed to this module's tests as the whole of the format knowledge, so what the
/// backend believes about the fence is asserted in one place.
fn rename_in_text(text: &str, scene_id: i32, new_name: &str) -> Option<String> {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut out: Vec<String> = Vec::with_capacity(lines.len());
    let mut changed = false;

    let mut i = 0;
    while i < lines.len() {
        let open = match open_fence(lines[i]) {
            Some(open) => open,
            None => {
                out.push(lines[i].to_string());
                i += 1;
                continue;
            }
        };

        // The raw body lines, kept as they are so an untouched fence is re-emitted
        // byte for byte rather than reconstructed.
        let mut raw: Vec<&str> = Vec::new();
        let mut j = i + 1;
        while j < lines.len() && !is_close_fence(lines[j], &open) {
            raw.push(lines[j]);
            j += 1;
        }

        out.push(lines[i].to_string());
        match rename_in_body(&raw, &open, scene_id, new_name) {
            Some(new_body) => {
                changed = true;
                out.extend(new_body);
            }
            None => out.extend(raw.iter().map(|line| line.to_string())),
        }
        // The closing fence, when there is one — an unterminated fence runs to the
        // end of the file and there is nothing left to copy.
        if j < lines.len() {
            out.push(lines[j].to_string());
        }
        i = j + 1;
    }

    changed.then(|| out.join("\n"))
}

/// One fence body with the name line brought up to date, or `None` when this fence
/// is not the renamed scene's, or already says the right thing.
fn rename_in_body(
    raw: &[&str],
    open: &Open,
    scene_id: i32,
    new_name: &str,
) -> Option<Vec<String>> {
    let mut references = false;
    let mut name_at: Option<usize> = None;
    for (at, line) in raw.iter().enumerate() {
        let body = strip_prefix(line, &open.prefix);
        if id_of(body) == Some(scene_id) {
            references = true;
        } else if name_at.is_none() && body.starts_with("# ") {
            name_at = Some(at);
        }
    }
    if !references {
        return None;
    }

    // A name is one line in this format and a database column is not constrained to
    // one, so the copy is flattened — the same normalisation the editor's serializer
    // applies to the same value.
    let one_line = new_name.replace(['\r', '\n'], " ");
    let desired = (!one_line.is_empty()).then(|| reattach(&open.prefix, &format!("# {one_line}")));

    let mut body: Vec<String> = raw.iter().map(|line| line.to_string()).collect();
    match (name_at, desired) {
        // The line is there and says something else: replace it and nothing else.
        (Some(at), Some(line)) => body[at] = line,
        // A scene renamed to nothing has no name to cache.
        (Some(at), None) => {
            body.remove(at);
        }
        // No name line yet — a fence written by a migration that could not resolve
        // the id, or one a GM hand-authored with the id alone. The name goes above
        // the body, which is where the serializer puts it.
        (None, Some(line)) => body.insert(0, line),
        (None, None) => {}
    }

    (body != raw.iter().map(|l| l.to_string()).collect::<Vec<_>>()).then_some(body)
}

/// `Id: 7` — the scene a body line names, when it names one. The same reading as
/// the editor's: a bare non-negative integer and nothing else.
fn id_of(body_line: &str) -> Option<i32> {
    let rest = body_line.strip_prefix("Id:")?.trim_start();
    if rest.is_empty() || !rest.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    rest.parse::<i32>().ok()
}

// ── Finding the fences ───────────────────────────────────────────────────────
//
// Same shape as the Timeline migration's, and the same reason for each part: a
// fence may be nested inside a Callout (#158), and the info string must be the
// block's name and nothing else, which is the byte-identity rule the editor's own
// claim follows (`fence-claim.ts`).

struct Open {
    prefix: String,
    fence_char: char,
    len: usize,
}

fn nesting_len(line: &str) -> usize {
    line.len()
        - line
            .trim_start_matches([' ', '\t', '>'])
            .len()
}

fn open_fence(line: &str) -> Option<Open> {
    let (prefix, rest) = line.split_at(nesting_len(line));
    let fence_char = rest.chars().next()?;
    if fence_char != '`' && fence_char != '~' {
        return None;
    }
    let len = rest.chars().take_while(|c| *c == fence_char).count();
    if len < 3 || rest[len..].trim() != "scene" {
        return None;
    }
    Some(Open {
        prefix: prefix.to_string(),
        fence_char,
        len,
    })
}

fn is_close_fence(line: &str, open: &Open) -> bool {
    let rest = &line[nesting_len(line)..];
    let run = rest.chars().take_while(|c| *c == open.fence_char).count();
    run >= open.len && rest[run..].trim().is_empty()
}

fn strip_prefix<'a>(line: &'a str, prefix: &str) -> &'a str {
    match line.strip_prefix(prefix) {
        Some(rest) => rest,
        None => &line[nesting_len(line)..],
    }
}

fn reattach(prefix: &str, line: &str) -> String {
    format!("{prefix}{line}")
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── The text rewrite ─────────────────────────────────────────────────────

    #[test]
    fn the_cached_name_follows_the_rename() {
        assert_eq!(
            rename_in_text("```scene\n# Boss Battle\nId: 7\n```", 7, "Final Stand").unwrap(),
            "```scene\n# Final Stand\nId: 7\n```"
        );
    }

    #[test]
    fn a_fence_already_carrying_the_new_name_is_not_rewritten() {
        // What keeps the count honest: the number reported is the number of notes
        // whose bytes changed, so a rename that renames nothing writes nothing.
        assert!(rename_in_text("```scene\n# Boss Battle\nId: 7\n```", 7, "Boss Battle").is_none());
    }

    #[test]
    fn a_fence_with_no_name_yet_gains_one() {
        // A fence the migration wrote when the id resolved to no scene, or one a GM
        // hand-authored with the id alone.
        assert_eq!(
            rename_in_text("```scene\nId: 7\n```", 7, "Final Stand").unwrap(),
            "```scene\n# Final Stand\nId: 7\n```"
        );
    }

    #[test]
    fn a_scene_renamed_to_nothing_loses_its_cached_name() {
        assert_eq!(
            rename_in_text("```scene\n# Boss Battle\nId: 7\n```", 7, "").unwrap(),
            "```scene\nId: 7\n```"
        );
    }

    #[test]
    fn a_name_holding_a_newline_is_flattened_onto_one_line() {
        assert_eq!(
            rename_in_text("```scene\n# Boss Battle\nId: 7\n```", 7, "Final\nStand").unwrap(),
            "```scene\n# Final Stand\nId: 7\n```"
        );
    }

    #[test]
    fn another_scenes_fence_is_left_alone() {
        assert!(rename_in_text("```scene\n# Town Market\nId: 2\n```", 7, "Final Stand").is_none());
    }

    #[test]
    fn every_fence_referencing_the_scene_in_one_note_is_rewritten() {
        let before = "```scene\n# Boss Battle\nId: 7\n```\n\n\
                      Prose.\n\n\
                      ```scene\n# Town Market\nId: 2\n```\n\n\
                      ```scene\n# Boss Battle\nId: 7\n```";
        assert_eq!(
            rename_in_text(before, 7, "Final Stand").unwrap(),
            "```scene\n# Final Stand\nId: 7\n```\n\n\
             Prose.\n\n\
             ```scene\n# Town Market\nId: 2\n```\n\n\
             ```scene\n# Final Stand\nId: 7\n```"
        );
    }

    #[test]
    fn prose_around_the_fence_is_untouched_to_the_byte() {
        let before = "---\ntags: [session]\n---\n# The Ambush\n\n\
                      ```scene\n# Boss Battle\nId: 7\n```\n\nPress play.\n";
        assert_eq!(
            rename_in_text(before, 7, "Final Stand").unwrap(),
            "---\ntags: [session]\n---\n# The Ambush\n\n\
             ```scene\n# Final Stand\nId: 7\n```\n\nPress play.\n"
        );
    }

    #[test]
    fn a_fence_nested_inside_a_callout_keeps_its_quoting() {
        assert_eq!(
            rename_in_text(
                "> [!encounter] The Ambush\n>\n> ```scene\n> # Boss Battle\n> Id: 7\n> ```",
                7,
                "Final Stand"
            )
            .unwrap(),
            "> [!encounter] The Ambush\n>\n> ```scene\n> # Final Stand\n> Id: 7\n> ```"
        );
    }

    #[test]
    fn a_line_the_format_does_not_recognise_survives_verbatim() {
        // Stronger than the editor's own round trip, and deliberately so: a rename is
        // not a gesture the GM aimed at this note, so it may not tidy it.
        assert_eq!(
            rename_in_text(
                "```scene\n# Boss Battle\nId: 7\nNote to self: check the volumes\n```",
                7,
                "Final Stand"
            )
            .unwrap(),
            "```scene\n# Final Stand\nId: 7\nNote to self: check the volumes\n```"
        );
    }

    #[test]
    fn a_note_with_no_scene_fence_is_untouched() {
        assert!(rename_in_text("# Prose\n\nAnd a [[link]].\n", 7, "Final Stand").is_none());
    }

    #[test]
    fn a_fence_that_is_not_a_scene_fence_is_untouched() {
        for text in [
            "```timeline\n# Boss Battle\nId: 7\n```",
            "```\n# Boss Battle\nId: 7\n```",
            "```scene extra\n# Boss Battle\nId: 7\n```",
        ] {
            assert!(rename_in_text(text, 7, "Final Stand").is_none(), "text={text}");
        }
    }

    #[test]
    fn a_scene_id_written_as_prose_is_not_a_reference() {
        // `Id: 7` outside a scene fence is a GM's Infobox row, not a reference.
        assert!(rename_in_text("```infobox\nId: 7\n```", 7, "Final Stand").is_none());
        assert!(rename_in_text("Id: 7\n", 7, "Final Stand").is_none());
    }

    #[test]
    fn an_id_line_that_is_not_a_whole_number_names_no_scene() {
        for line in ["Id:", "Id: seven", "Id: 7.0", "Id: -7", "Id: 7 8"] {
            assert!(id_of(line).is_none(), "line={line}");
        }
        assert_eq!(id_of("Id: 7"), Some(7));
        assert_eq!(id_of("Id:7"), Some(7));
    }

    // ── Through the shared writer ────────────────────────────────────────────

    #[test]
    fn the_rename_writes_through_the_chokepoint_and_reconciles() {
        // The property that makes this a second *caller* rather than a second writer:
        // the bytes go out through `commit_backlink_rewrites`, so the Ledger Watcher
        // recognises them as Grimoire's own echo instead of raising a Conflict Banner
        // on every note that mentioned the scene — and the note's own derived rows
        // are reconciled against what was written.
        use crate::db::schema::note_links::dsl as nl;
        use diesel::connection::SimpleConnection;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let index = crate::search::rebuild_index(dir.path(), &[], &[], &[]).unwrap();
        let mut conn = SqliteConnection::establish(":memory:").unwrap();
        conn.batch_execute(
            "CREATE TABLE notes (
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
            );
            INSERT INTO notes (id, path, title) VALUES (1, 'Session.md', 'Session');
            INSERT INTO notes (id, path, title) VALUES (2, 'Prose.md', 'Prose');",
        )
        .unwrap();

        let referencing = "```scene\n# Boss Battle\nId: 7\n```\n\nSee [[Prose.md]].";
        std::fs::write(dir.path().join("Session.md"), referencing).unwrap();
        std::fs::write(dir.path().join("Prose.md"), "No scenes here.").unwrap();

        let count =
            propagate_rename(&mut conn, Some(&index), dir.path(), 7, "Final Stand").unwrap();

        assert_eq!(count, 1, "only the note that references the scene is rewritten");
        let after = std::fs::read_to_string(dir.path().join("Session.md")).unwrap();
        assert_eq!(after, "```scene\n# Final Stand\nId: 7\n```\n\nSee [[Prose.md]].");
        assert!(
            crate::note_write::is_recent_write(&dir.path().join("Session.md"), after.as_bytes()),
            "the rewrite must be echo-suppressed, or the watcher reads it as an external edit"
        );
        // The note that says nothing about the scene is not written at all.
        assert_eq!(
            std::fs::read_to_string(dir.path().join("Prose.md")).unwrap(),
            "No scenes here."
        );
        // And the rewritten note's derived rows were reconciled against its new bytes.
        assert_eq!(
            nl::note_links
                .select(nl::target_path)
                .load::<String>(&mut conn)
                .unwrap(),
            vec!["Prose.md"]
        );
    }

    #[test]
    fn a_rename_no_note_mentions_writes_nothing() {
        use diesel::connection::SimpleConnection;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let mut conn = SqliteConnection::establish(":memory:").unwrap();
        conn.batch_execute(
            "CREATE TABLE notes (
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
            );
            INSERT INTO notes (id, path, title) VALUES (1, 'Prose.md', 'Prose');",
        )
        .unwrap();
        std::fs::write(dir.path().join("Prose.md"), "No scenes here.").unwrap();

        assert_eq!(
            propagate_rename(&mut conn, None, dir.path(), 7, "Final Stand").unwrap(),
            0
        );
        assert!(
            !crate::note_write::is_recent_write(
                &dir.path().join("Prose.md"),
                b"No scenes here."
            ),
            "a rename nothing references must not write a single note"
        );
    }

    #[test]
    fn a_note_whose_file_cannot_be_read_is_skipped_rather_than_failing_the_rename() {
        use diesel::connection::SimpleConnection;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let mut conn = SqliteConnection::establish(":memory:").unwrap();
        conn.batch_execute(
            "CREATE TABLE notes (
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
            );
            INSERT INTO notes (id, path, title) VALUES (1, 'Gone.md', 'Gone');
            INSERT INTO notes (id, path, title) VALUES (2, 'Session.md', 'Session');",
        )
        .unwrap();
        // 'Gone.md' has a row and no file — deleted outside Grimoire.
        std::fs::write(
            dir.path().join("Session.md"),
            "```scene\n# Boss Battle\nId: 7\n```",
        )
        .unwrap();

        assert_eq!(
            propagate_rename(&mut conn, None, dir.path(), 7, "Final Stand").unwrap(),
            1,
            "the scene is renamed either way; one unreadable note may not block it"
        );
    }
}
