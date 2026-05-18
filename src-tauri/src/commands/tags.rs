// Vault-global tag index.
//
// The `note_tags` table is a derived index. Markdown frontmatter is the source
// of truth; this table is fully regenerable by `rebuild_note_tags_from_vault`.
// Wiping `.grimoire/index.db` (or just the `note_tags` table) and re-opening
// the vault reconstructs the index from a fresh frontmatter scan.
//
// Tag-string keyed: rows are (note_path, tag); `SELECT DISTINCT tag FROM
// note_tags` is the natural "list all tags" query. Pins will use the same
// shape with a sibling table.

use crate::commands::frontmatter;
use crate::db::schema::note_tags::dsl as nt;
use crate::vault::AppVault;
use diesel::prelude::*;
use diesel::SqliteConnection;
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use tauri::State;

/// Walk the vault scanning every `.md` file for frontmatter tags, then replace
/// the `note_tags` table contents with the fresh scan. Hidden directories
/// (anything starting with '.') are skipped.
pub fn rebuild_note_tags_from_vault(
    vault_path: &Path,
    conn: &mut SqliteConnection,
) -> Result<(), String> {
    let mut rows: Vec<(String, String)> = Vec::new();
    collect_md_tags(vault_path, "", &mut rows)?;

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
        // Vault may be brand new / empty — not an error.
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
pub fn list_all_tags(vault: State<AppVault>) -> Result<Vec<String>, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    // Pick one display casing per normalized tag (lowest sort order for stability).
    let mut all: Vec<String> = nt::note_tags
        .select(nt::tag)
        .load::<String>(conn)
        .map_err(|e| e.to_string())?;
    all.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    let mut out: Vec<String> = Vec::new();
    let mut last_norm: Option<String> = None;
    for t in all {
        let norm = t.to_lowercase();
        if last_norm.as_deref() != Some(norm.as_str()) {
            last_norm = Some(norm);
            out.push(t);
        }
    }
    Ok(out)
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
            "CREATE TABLE note_tags (
                note_path TEXT NOT NULL,
                tag TEXT NOT NULL,
                PRIMARY KEY (note_path, tag)
            );",
        )
        .expect("create note_tags");
        conn
    }

    #[test]
    fn rebuild_from_empty_vault_yields_no_rows() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        rebuild_note_tags_from_vault(dir.path(), &mut conn).unwrap();
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
        rebuild_note_tags_from_vault(dir.path(), &mut conn).unwrap();

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
        rebuild_note_tags_from_vault(dir.path(), &mut conn).unwrap();

        // Tag changes on disk; rebuild reflects the new state.
        fs::write(
            dir.path().join("a.md"),
            "---\ntags: [two]\n---\n",
        )
        .unwrap();
        rebuild_note_tags_from_vault(dir.path(), &mut conn).unwrap();

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
        rebuild_note_tags_from_vault(dir.path(), &mut conn).unwrap();
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
        rebuild_note_tags_from_vault(dir.path(), &mut conn).unwrap();

        // Remove `drop` from the note. After rebuild it should disappear from
        // the index entirely — no orphan retention.
        fs::write(dir.path().join("a.md"), "---\ntags: [keep]\n---\n").unwrap();
        rebuild_note_tags_from_vault(dir.path(), &mut conn).unwrap();

        let rows: Vec<String> = nt::note_tags
            .select(nt::tag)
            .load(&mut conn)
            .unwrap();
        assert_eq!(rows, vec!["keep".to_string()]);
    }
}
