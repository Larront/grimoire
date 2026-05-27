// Link index: note_links and note_aliases tables.
//
// Both tables are derived indices — the markdown file is the source of truth
// for wikilinks and aliases respectively. Both are fully regenerable from a
// vault scan; see ADR-0005 and CONTEXT.md §Link Index / §Note Alias.

use crate::commands::frontmatter;
use crate::db::schema::note_aliases::dsl as na;
use crate::db::schema::note_links::dsl as nl;
use crate::db::schema::notes::dsl as n;
use crate::vault::AppVault;
use diesel::prelude::*;
use diesel::SqliteConnection;
use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use tauri::State;

// ── Extraction helpers ────────────────────────────────────────────────────────

/// Extracts all unique wikilink target paths from note content.
/// Strips frontmatter before scanning; strips display text and heading
/// fragments from each match. Returns deduplicated results.
pub fn extract_wikilinks(content: &str) -> Vec<String> {
    let body = strip_frontmatter_body(content);
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut links: Vec<String> = Vec::new();
    let mut rest = body.as_str();
    while let Some(start) = rest.find("[[") {
        rest = &rest[start + 2..];
        if let Some(end) = rest.find("]]") {
            let inner = &rest[..end];
            let target = inner
                .split('|')
                .next()
                .unwrap_or(inner)
                .split('#')
                .next()
                .unwrap_or(inner)
                .trim();
            if !target.is_empty() && seen.insert(target.to_string()) {
                links.push(target.to_string());
            }
            rest = &rest[end + 2..];
        } else {
            break;
        }
    }
    links
}

fn strip_frontmatter_body(content: &str) -> String {
    if !content.starts_with("---\n") {
        return content.to_string();
    }
    let after_open = &content[4..];
    if let Some(close_idx) = after_open.find("\n---") {
        let after = &after_open[close_idx + 4..];
        after.strip_prefix('\n').unwrap_or(after).to_string()
    } else {
        content.to_string()
    }
}

// ── DB helpers ────────────────────────────────────────────────────────────────

/// Replace all link rows for `source_id` with `links`.
pub fn upsert_note_links(
    conn: &mut SqliteConnection,
    source_id: i32,
    links: &[String],
) -> Result<(), String> {
    conn.transaction::<_, diesel::result::Error, _>(|c| {
        diesel::delete(nl::note_links.filter(nl::source_id.eq(source_id))).execute(c)?;
        for target in links {
            diesel::insert_into(nl::note_links)
                .values((nl::source_id.eq(source_id), nl::target_path.eq(target)))
                .execute(c)?;
        }
        Ok(())
    })
    .map_err(|e| e.to_string())
}

/// Replace all alias rows for `note_id` with `aliases`.
pub fn upsert_note_aliases(
    conn: &mut SqliteConnection,
    note_id: i32,
    aliases: &[String],
) -> Result<(), String> {
    conn.transaction::<_, diesel::result::Error, _>(|c| {
        diesel::delete(na::note_aliases.filter(na::note_id.eq(note_id))).execute(c)?;
        let mut seen: BTreeSet<String> = BTreeSet::new();
        for alias in aliases {
            if seen.insert(alias.to_lowercase()) {
                diesel::insert_into(na::note_aliases)
                    .values((na::note_id.eq(note_id), na::alias.eq(alias)))
                    .execute(c)?;
            }
        }
        Ok(())
    })
    .map_err(|e| e.to_string())
}

/// Walk the vault scanning every `.md` file; replace both tables with the
/// results of a fresh scan. Hidden directories are skipped.
pub fn rebuild_note_links_from_vault(
    vault_path: &Path,
    conn: &mut SqliteConnection,
) -> Result<(), String> {
    // Build a path→id map so the walk can resolve source_id cheaply.
    let note_rows: Vec<(String, i32)> = n::notes
        .select((n::path, n::id))
        .load(conn)
        .map_err(|e| e.to_string())?;
    let path_to_id: std::collections::HashMap<String, i32> =
        note_rows.into_iter().collect();

    let mut link_rows: Vec<(i32, String)> = Vec::new();
    let mut alias_rows: Vec<(i32, String)> = Vec::new();
    collect_links_and_aliases(vault_path, "", &path_to_id, &mut link_rows, &mut alias_rows)?;

    conn.transaction::<_, diesel::result::Error, _>(|c| {
        diesel::delete(nl::note_links).execute(c)?;
        diesel::delete(na::note_aliases).execute(c)?;

        for chunk in link_rows.chunks(100) {
            let vals: Vec<_> = chunk
                .iter()
                .map(|(sid, tp)| (nl::source_id.eq(*sid), nl::target_path.eq(tp)))
                .collect();
            diesel::insert_into(nl::note_links)
                .values(&vals)
                .execute(c)?;
        }

        let mut seen_aliases: BTreeSet<(i32, String)> = BTreeSet::new();
        let unique_aliases: Vec<_> = alias_rows
            .into_iter()
            .filter(|(nid, alias)| seen_aliases.insert((*nid, alias.to_lowercase())))
            .collect();
        for chunk in unique_aliases.chunks(100) {
            let vals: Vec<_> = chunk
                .iter()
                .map(|(nid, alias)| (na::note_id.eq(*nid), na::alias.eq(alias)))
                .collect();
            diesel::insert_into(na::note_aliases)
                .values(&vals)
                .execute(c)?;
        }

        Ok(())
    })
    .map_err(|e| e.to_string())
}

fn collect_links_and_aliases(
    dir: &Path,
    relative: &str,
    path_to_id: &std::collections::HashMap<String, i32>,
    link_rows: &mut Vec<(i32, String)>,
    alias_rows: &mut Vec<(i32, String)>,
) -> Result<(), String> {
    let entries = match fs::read_dir(dir) {
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
            collect_links_and_aliases(&entry_path, &child_rel, path_to_id, link_rows, alias_rows)?;
        } else if name.ends_with(".md") {
            if let (Some(&note_id), Ok(content)) =
                (path_to_id.get(&child_rel), fs::read_to_string(&entry_path))
            {
                for target in extract_wikilinks(&content) {
                    link_rows.push((note_id, target));
                }
                for alias in frontmatter::read_aliases(&content) {
                    alias_rows.push((note_id, alias));
                }
            }
        }
    }
    Ok(())
}

// ── Backlink rewrite ──────────────────────────────────────────────────────────

/// Replace wikilink occurrences of `old_path` with `new_path` inside `content`.
/// Matches `[[old_path]]`, `[[old_path|display]]`, `[[old_path#heading]]`.
/// Leaves frontmatter and non-matching links untouched.
/// Returns (new_content, was_changed).
pub fn rewrite_wikilinks_in_content(content: &str, old_path: &str, new_path: &str) -> (String, bool) {
    let mut result = String::with_capacity(content.len());
    let mut rest = content;
    let mut changed = false;

    while let Some(start) = rest.find("[[") {
        result.push_str(&rest[..start + 2]);
        rest = &rest[start + 2..];
        if let Some(end) = rest.find("]]") {
            let inner = &rest[..end];
            // Split at first `|` or `#` to isolate the target
            let sep_pos = inner.find(['|', '#']).unwrap_or(inner.len());
            let raw_target = inner[..sep_pos].trim();
            if raw_target == old_path {
                result.push_str(new_path);
                result.push_str(&inner[sep_pos..]);
                changed = true;
            } else {
                result.push_str(inner);
            }
            result.push_str("]]");
            rest = &rest[end + 2..];
        } else {
            // Unclosed `[[` — emit verbatim and stop
            result.push_str(rest);
            rest = "";
            break;
        }
    }
    result.push_str(rest);
    (result, changed)
}

#[derive(QueryableByName, Debug)]
struct SourceNoteRow {
    #[diesel(sql_type = diesel::sql_types::Integer)]
    id: i32,
    #[diesel(sql_type = diesel::sql_types::Text)]
    path: String,
}

/// For every note that has a `note_links` row pointing at `old_path`:
/// reads the markdown file, rewrites `[[old_path...]]` → `[[new_path...]]`,
/// saves the file, and re-indexes the note's outbound links in the DB.
/// Returns the number of notes whose files were actually modified.
pub fn rewrite_backlinks_on_rename_on_conn(
    vault_path: &Path,
    conn: &mut SqliteConnection,
    old_path: &str,
    new_path: &str,
) -> Result<usize, String> {
    let sources: Vec<SourceNoteRow> = diesel::sql_query(
        "SELECT n.id, n.path
         FROM note_links nl
         JOIN notes n ON nl.source_id = n.id
         WHERE nl.target_path = ?1",
    )
    .bind::<diesel::sql_types::Text, _>(old_path)
    .load(conn)
    .map_err(|e| e.to_string())?;

    let mut updated_count = 0usize;
    for source in sources {
        let full_path = vault_path.join(&source.path);
        let content = match fs::read_to_string(&full_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let (new_content, changed) = rewrite_wikilinks_in_content(&content, old_path, new_path);
        if changed {
            fs::write(&full_path, &new_content).map_err(|e| e.to_string())?;
            let new_links = extract_wikilinks(&new_content);
            upsert_note_links(conn, source.id, &new_links)?;
            updated_count += 1;
        }
    }
    Ok(updated_count)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[derive(Serialize, Debug, Clone)]
pub struct AliasCollision {
    pub alias: String,
    pub other_note_id: i32,
    pub other_note_title: String,
}

#[derive(QueryableByName, Debug)]
struct AliasCollisionRow {
    #[diesel(sql_type = diesel::sql_types::Text)]
    alias: String,
    #[diesel(sql_type = diesel::sql_types::Integer)]
    other_note_id: i32,
    #[diesel(sql_type = diesel::sql_types::Text)]
    other_note_title: String,
}

pub fn get_alias_collisions_on_conn(
    conn: &mut SqliteConnection,
    note_id: i32,
) -> Result<Vec<AliasCollision>, String> {
    diesel::sql_query(
        "SELECT a1.alias, n.id as other_note_id, n.title as other_note_title
         FROM note_aliases a1
         JOIN note_aliases a2 ON LOWER(a1.alias) = LOWER(a2.alias)
         JOIN notes n ON a2.note_id = n.id
         WHERE a1.note_id = ?1
           AND a2.note_id != ?1
         ORDER BY a1.alias",
    )
    .bind::<diesel::sql_types::Integer, _>(note_id)
    .load::<AliasCollisionRow>(conn)
    .map_err(|e| e.to_string())
    .map(|rows| {
        rows.into_iter()
            .map(|r| AliasCollision {
                alias: r.alias,
                other_note_id: r.other_note_id,
                other_note_title: r.other_note_title,
            })
            .collect()
    })
}

#[tauri::command]
pub fn get_alias_collisions(
    note_id: i32,
    vault: State<AppVault>,
) -> Result<Vec<AliasCollision>, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    get_alias_collisions_on_conn(conn, note_id)
}

#[derive(Serialize, Debug, Clone)]
pub struct ResolvedNote {
    pub id: i32,
    pub title: String,
    pub path: String,
}

pub fn search_notes_by_alias_on_conn(
    conn: &mut SqliteConnection,
    query: &str,
) -> Result<Vec<crate::search::NoteSearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    let pattern = format!("{}%", query.to_lowercase());
    diesel::sql_query(
        "SELECT DISTINCT n.id, n.title, n.path
         FROM note_aliases al
         JOIN notes n ON al.note_id = n.id
         WHERE LOWER(al.alias) LIKE ?1
         ORDER BY al.alias
         LIMIT 10",
    )
    .bind::<diesel::sql_types::Text, _>(&pattern)
    .load::<ResolvedNoteRow>(conn)
    .map_err(|e| e.to_string())
    .map(|rows| {
        rows.into_iter()
            .map(|r| crate::search::NoteSearchResult {
                id: r.id,
                title: r.title,
                path: r.path,
                excerpt: None,
                match_count: 0,
            })
            .collect()
    })
}

pub fn resolve_note_by_alias_on_conn(
    conn: &mut SqliteConnection,
    alias: &str,
) -> Result<Option<ResolvedNote>, String> {
    diesel::sql_query(
        "SELECT n.id, n.title, n.path
         FROM note_aliases al
         JOIN notes n ON al.note_id = n.id
         WHERE LOWER(al.alias) = LOWER(?1)
         LIMIT 1",
    )
    .bind::<diesel::sql_types::Text, _>(alias)
    .load::<ResolvedNoteRow>(conn)
    .map_err(|e| e.to_string())
    .map(|rows| {
        rows.into_iter().next().map(|r| ResolvedNote {
            id: r.id,
            title: r.title,
            path: r.path,
        })
    })
}

#[tauri::command]
pub fn resolve_note_by_alias(
    alias: String,
    vault: State<AppVault>,
) -> Result<Option<ResolvedNote>, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    resolve_note_by_alias_on_conn(conn, &alias)
}

#[derive(Serialize, Debug, Clone)]
pub struct BacklinkNote {
    pub id: i32,
    pub path: String,
    pub title: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct OutboundLink {
    pub target_path: String,
    pub resolved_id: Option<i32>,
    pub resolved_title: Option<String>,
    pub resolved_path: Option<String>,
}

#[tauri::command]
pub fn get_backlinks(note_id: i32, vault: State<AppVault>) -> Result<Vec<BacklinkNote>, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;

    let note_path: String = n::notes
        .find(note_id)
        .select(n::path)
        .first(conn)
        .map_err(|e| e.to_string())?;

    let rows = diesel::sql_query(
        "SELECT DISTINCT n.id, n.path, n.title
         FROM note_links nl
         JOIN notes n ON nl.source_id = n.id
         WHERE nl.target_path = ?1
            OR nl.target_path IN (SELECT alias FROM note_aliases WHERE note_id = ?2)
         ORDER BY n.title",
    )
    .bind::<diesel::sql_types::Text, _>(&note_path)
    .bind::<diesel::sql_types::Integer, _>(note_id)
    .load::<BacklinkNoteRow>(conn)
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|r| BacklinkNote {
            id: r.id,
            path: r.path,
            title: r.title,
        })
        .collect())
}

#[derive(QueryableByName, Debug)]
struct BacklinkNoteRow {
    #[diesel(sql_type = diesel::sql_types::Integer)]
    id: i32,
    #[diesel(sql_type = diesel::sql_types::Text)]
    path: String,
    #[diesel(sql_type = diesel::sql_types::Text)]
    title: String,
}

#[tauri::command]
pub fn get_outbound_links(
    note_id: i32,
    vault: State<AppVault>,
) -> Result<Vec<OutboundLink>, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;

    let link_rows: Vec<String> = nl::note_links
        .filter(nl::source_id.eq(note_id))
        .select(nl::target_path)
        .load(conn)
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for target_path in link_rows {
        let resolved = n::notes
            .filter(n::path.eq(&target_path))
            .select((n::id, n::title, n::path))
            .first::<(i32, String, String)>(conn)
            .optional()
            .map_err(|e| e.to_string())?;

        let resolved = if resolved.is_none() {
            diesel::sql_query(
                "SELECT n.id, n.title, n.path
                 FROM note_aliases al
                 JOIN notes n ON al.note_id = n.id
                 WHERE al.alias = ?1
                 LIMIT 1",
            )
            .bind::<diesel::sql_types::Text, _>(&target_path)
            .load::<ResolvedNoteRow>(conn)
            .map_err(|e| e.to_string())?
            .into_iter()
            .next()
            .map(|r| (r.id, r.title, r.path))
        } else {
            resolved
        };

        result.push(OutboundLink {
            target_path,
            resolved_id: resolved.as_ref().map(|(id, _, _)| *id),
            resolved_title: resolved.as_ref().map(|(_, t, _)| t.clone()),
            resolved_path: resolved.map(|(_, _, p)| p),
        });
    }
    Ok(result)
}

#[derive(QueryableByName, Debug)]
struct ResolvedNoteRow {
    #[diesel(sql_type = diesel::sql_types::Integer)]
    id: i32,
    #[diesel(sql_type = diesel::sql_types::Text)]
    title: String,
    #[diesel(sql_type = diesel::sql_types::Text)]
    path: String,
}

#[derive(QueryableByName)]
struct BacklinkCountRow {
    #[diesel(sql_type = diesel::sql_types::BigInt)]
    cnt: i64,
}

#[tauri::command]
pub fn get_note_backlink_count(note_path: String, vault: State<AppVault>) -> Result<usize, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    let row = diesel::sql_query(
        "SELECT COUNT(DISTINCT source_id) as cnt FROM note_links WHERE target_path = ?1",
    )
    .bind::<diesel::sql_types::Text, _>(&note_path)
    .load::<BacklinkCountRow>(conn)
    .map_err(|e| e.to_string())?;
    Ok(row.into_iter().next().map(|r| r.cnt as usize).unwrap_or(0))
}

#[tauri::command]
pub fn get_note_aliases(note_id: i32, vault: State<AppVault>) -> Result<Vec<String>, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    na::note_aliases
        .filter(na::note_id.eq(note_id))
        .select(na::alias)
        .load(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_note_aliases(
    note_id: i32,
    aliases: Vec<String>,
    vault: State<AppVault>,
) -> Result<(), String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.as_ref().ok_or("No vault open")?.clone();
    let conn = state.connection.as_mut().ok_or("No vault open")?;

    let note_path: String = n::notes
        .find(note_id)
        .select(n::path)
        .first(conn)
        .map_err(|e| e.to_string())?;

    let full_path = vault_path.join(&note_path);
    let content = fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
    let new_content = frontmatter::apply_aliases(&content, &aliases);
    fs::write(&full_path, &new_content).map_err(|e| e.to_string())?;

    upsert_note_aliases(conn, note_id, &aliases)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

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

    // ── extract_wikilinks ────────────────────────────────────────────────────

    #[test]
    fn extract_wikilinks_simple() {
        assert_eq!(
            extract_wikilinks("See [[Aldric.md]] for details."),
            vec!["Aldric.md"]
        );
    }

    #[test]
    fn extract_wikilinks_strips_display_text() {
        assert_eq!(
            extract_wikilinks("[[Aldric.md|the hero]]"),
            vec!["Aldric.md"]
        );
    }

    #[test]
    fn extract_wikilinks_strips_heading_fragment() {
        assert_eq!(
            extract_wikilinks("[[Characters/Aldric.md#Background]]"),
            vec!["Characters/Aldric.md"]
        );
    }

    #[test]
    fn extract_wikilinks_strips_frontmatter() {
        let content = "---\ntags: [npc]\n---\n[[Aldric.md]]";
        assert_eq!(extract_wikilinks(content), vec!["Aldric.md"]);
    }

    #[test]
    fn extract_wikilinks_does_not_extract_from_frontmatter() {
        let content = "---\naliases: [Captain [[Ash]]]\n---\nBody";
        assert_eq!(extract_wikilinks(content), Vec::<String>::new());
    }

    #[test]
    fn extract_wikilinks_multiple_unique() {
        let content = "See [[a.md]] and [[b.md]].";
        let mut links = extract_wikilinks(content);
        links.sort();
        assert_eq!(links, vec!["a.md", "b.md"]);
    }

    #[test]
    fn extract_wikilinks_deduplicates() {
        let content = "[[a.md]] and [[a.md]] again.";
        assert_eq!(extract_wikilinks(content), vec!["a.md"]);
    }

    #[test]
    fn extract_wikilinks_empty_body() {
        assert!(extract_wikilinks("").is_empty());
        assert!(extract_wikilinks("No links here.").is_empty());
    }

    #[test]
    fn extract_wikilinks_ignores_unclosed_bracket() {
        assert!(extract_wikilinks("[[unclosed").is_empty());
    }

    // ── upsert_note_links ────────────────────────────────────────────────────

    #[test]
    fn upsert_note_links_inserts_rows() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        upsert_note_links(&mut conn, 1, &["b.md".to_string(), "c.md".to_string()]).unwrap();
        let mut rows: Vec<(i32, String)> = nl::note_links.load(&mut conn).unwrap();
        rows.sort();
        assert_eq!(
            rows,
            vec![(1, "b.md".to_string()), (1, "c.md".to_string())]
        );
    }

    #[test]
    fn upsert_note_links_replaces_rows_for_one_note_only() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        insert_note(&mut conn, 2, "b.md", "B");
        upsert_note_links(&mut conn, 1, &["x.md".to_string()]).unwrap();
        upsert_note_links(&mut conn, 2, &["y.md".to_string()]).unwrap();
        // Replace note 1's links; note 2 should be untouched.
        upsert_note_links(&mut conn, 1, &["z.md".to_string()]).unwrap();
        let mut rows: Vec<(i32, String)> = nl::note_links.load(&mut conn).unwrap();
        rows.sort();
        assert_eq!(
            rows,
            vec![(1, "z.md".to_string()), (2, "y.md".to_string())]
        );
    }

    #[test]
    fn upsert_note_links_to_empty_clears_rows() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        upsert_note_links(&mut conn, 1, &["b.md".to_string()]).unwrap();
        upsert_note_links(&mut conn, 1, &[]).unwrap();
        let rows: Vec<(i32, String)> = nl::note_links.load(&mut conn).unwrap();
        assert!(rows.is_empty());
    }

    #[test]
    fn deleting_note_cascades_to_link_rows() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        upsert_note_links(&mut conn, 1, &["b.md".to_string()]).unwrap();
        conn.batch_execute("DELETE FROM notes WHERE id = 1").unwrap();
        let rows: Vec<(i32, String)> = nl::note_links.load(&mut conn).unwrap();
        assert!(rows.is_empty(), "cascade delete should remove link rows");
    }

    // ── upsert_note_aliases ──────────────────────────────────────────────────

    #[test]
    fn upsert_note_aliases_inserts_rows() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        upsert_note_aliases(&mut conn, 1, &["Captain A".to_string()]).unwrap();
        let rows: Vec<(i32, String)> = na::note_aliases.load(&mut conn).unwrap();
        assert_eq!(rows, vec![(1, "Captain A".to_string())]);
    }

    #[test]
    fn upsert_note_aliases_deduplicates_case_insensitively() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        upsert_note_aliases(
            &mut conn,
            1,
            &["Captain A".to_string(), "captain a".to_string(), "Ash".to_string()],
        )
        .unwrap();
        let mut rows: Vec<String> = na::note_aliases
            .select(na::alias)
            .load(&mut conn)
            .unwrap();
        rows.sort();
        assert_eq!(rows, vec!["Ash".to_string(), "Captain A".to_string()]);
    }

    #[test]
    fn upsert_note_aliases_to_empty_clears_rows() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        upsert_note_aliases(&mut conn, 1, &["Captain A".to_string()]).unwrap();
        upsert_note_aliases(&mut conn, 1, &[]).unwrap();
        let rows: Vec<(i32, String)> = na::note_aliases.load(&mut conn).unwrap();
        assert!(rows.is_empty());
    }

    #[test]
    fn deleting_note_cascades_to_alias_rows() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        upsert_note_aliases(&mut conn, 1, &["Ash".to_string()]).unwrap();
        conn.batch_execute("DELETE FROM notes WHERE id = 1").unwrap();
        let rows: Vec<(i32, String)> = na::note_aliases.load(&mut conn).unwrap();
        assert!(rows.is_empty(), "cascade delete should remove alias rows");
    }

    // ── rebuild_note_links_from_vault ────────────────────────────────────────

    #[test]
    fn rebuild_from_empty_vault_yields_no_rows() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        rebuild_note_links_from_vault(dir.path(), &mut conn).unwrap();
        let links: Vec<(i32, String)> = nl::note_links.load(&mut conn).unwrap();
        let aliases: Vec<(i32, String)> = na::note_aliases.load(&mut conn).unwrap();
        assert!(links.is_empty());
        assert!(aliases.is_empty());
    }

    #[test]
    fn rebuild_picks_up_wikilinks_and_aliases() {
        let dir = TempDir::new().unwrap();
        fs::write(
            dir.path().join("aldric.md"),
            "---\naliases: [Captain Aldric]\n---\nSee [[dragon.md]].",
        )
        .unwrap();
        fs::write(dir.path().join("dragon.md"), "Body only.").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "aldric.md", "Aldric");
        insert_note(&mut conn, 2, "dragon.md", "Dragon");

        rebuild_note_links_from_vault(dir.path(), &mut conn).unwrap();

        let links: Vec<(i32, String)> = nl::note_links.load(&mut conn).unwrap();
        assert_eq!(links, vec![(1, "dragon.md".to_string())]);

        let aliases: Vec<(i32, String)> = na::note_aliases.load(&mut conn).unwrap();
        assert_eq!(aliases, vec![(1, "Captain Aldric".to_string())]);
    }

    #[test]
    fn rebuild_is_idempotent() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "[[b.md]]").unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");

        rebuild_note_links_from_vault(dir.path(), &mut conn).unwrap();
        rebuild_note_links_from_vault(dir.path(), &mut conn).unwrap();

        let links: Vec<(i32, String)> = nl::note_links.load(&mut conn).unwrap();
        assert_eq!(links.len(), 1);
    }

    #[test]
    fn rebuild_skips_hidden_directories() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join(".grimoire")).unwrap();
        fs::write(
            dir.path().join(".grimoire").join("hidden.md"),
            "[[should_not_appear.md]]",
        )
        .unwrap();
        let mut conn = test_conn();
        rebuild_note_links_from_vault(dir.path(), &mut conn).unwrap();
        let links: Vec<(i32, String)> = nl::note_links.load(&mut conn).unwrap();
        assert!(links.is_empty());
    }

    #[test]
    fn rebuild_skips_files_with_no_note_record() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("unregistered.md"), "[[b.md]]").unwrap();
        let mut conn = test_conn();
        // No matching note in DB for "unregistered.md" → no links inserted.
        rebuild_note_links_from_vault(dir.path(), &mut conn).unwrap();
        let links: Vec<(i32, String)> = nl::note_links.load(&mut conn).unwrap();
        assert!(links.is_empty());
    }

    #[test]
    fn stub_detection_target_path_not_in_notes() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "[[nonexistent.md]]").unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");

        rebuild_note_links_from_vault(dir.path(), &mut conn).unwrap();

        // target_path "nonexistent.md" does not appear in notes.path → stub
        let stub_count: i64 = diesel::sql_query(
            "SELECT COUNT(*) as cnt FROM note_links
             WHERE target_path NOT IN (SELECT path FROM notes)
               AND target_path NOT IN (SELECT alias FROM note_aliases)",
        )
        .load::<CountRow>(&mut conn)
        .unwrap()
        .into_iter()
        .next()
        .map(|r| r.cnt)
        .unwrap_or(0);
        assert_eq!(stub_count, 1);
    }

    #[derive(QueryableByName)]
    struct CountRow {
        #[diesel(sql_type = diesel::sql_types::BigInt)]
        cnt: i64,
    }

    // ── rewrite_wikilinks_in_content ─────────────────────────────────────────

    #[test]
    fn rewrite_simple_wikilink() {
        let (out, changed) =
            rewrite_wikilinks_in_content("See [[old.md]] for details.", "old.md", "new.md");
        assert_eq!(out, "See [[new.md]] for details.");
        assert!(changed);
    }

    #[test]
    fn rewrite_wikilink_with_display_text() {
        let (out, changed) =
            rewrite_wikilinks_in_content("[[old.md|The Hero]]", "old.md", "new.md");
        assert_eq!(out, "[[new.md|The Hero]]");
        assert!(changed);
    }

    #[test]
    fn rewrite_wikilink_with_heading_fragment() {
        let (out, changed) =
            rewrite_wikilinks_in_content("[[old.md#Background]]", "old.md", "new.md");
        assert_eq!(out, "[[new.md#Background]]");
        assert!(changed);
    }

    #[test]
    fn rewrite_does_not_change_unrelated_links() {
        let (out, changed) =
            rewrite_wikilinks_in_content("[[other.md]]", "old.md", "new.md");
        assert_eq!(out, "[[other.md]]");
        assert!(!changed);
    }

    #[test]
    fn rewrite_all_occurrences_in_content() {
        let content = "[[old.md]] and also [[old.md|alias]] and [[other.md]].";
        let (out, changed) = rewrite_wikilinks_in_content(content, "old.md", "new.md");
        assert_eq!(out, "[[new.md]] and also [[new.md|alias]] and [[other.md]].");
        assert!(changed);
    }

    #[test]
    fn rewrite_returns_false_when_no_match() {
        let (out, changed) = rewrite_wikilinks_in_content("No links here.", "old.md", "new.md");
        assert_eq!(out, "No links here.");
        assert!(!changed);
    }

    #[test]
    fn rewrite_does_not_partially_match() {
        // "old.md" must not match inside "folder/old.md"
        let (out, changed) =
            rewrite_wikilinks_in_content("[[folder/old.md]]", "old.md", "new.md");
        assert_eq!(out, "[[folder/old.md]]");
        assert!(!changed);
    }

    // ── rewrite_backlinks_on_rename_on_conn ──────────────────────────────────

    #[test]
    fn rewrite_backlinks_updates_files_and_link_rows() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "See [[b.md]].").unwrap();
        fs::write(dir.path().join("b.md"), "Body.").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        insert_note(&mut conn, 2, "b.md", "B");
        upsert_note_links(&mut conn, 1, &["b.md".to_string()]).unwrap();

        let count =
            rewrite_backlinks_on_rename_on_conn(dir.path(), &mut conn, "b.md", "b-renamed.md")
                .unwrap();

        assert_eq!(count, 1, "one note should have been rewritten");

        // File content should have been updated
        let updated = fs::read_to_string(dir.path().join("a.md")).unwrap();
        assert_eq!(updated, "See [[b-renamed.md]].");

        // note_links should now point to the new path
        let rows: Vec<(i32, String)> = nl::note_links.load(&mut conn).unwrap();
        assert_eq!(rows, vec![(1, "b-renamed.md".to_string())]);
    }

    #[test]
    fn rewrite_backlinks_returns_zero_when_no_backlinks() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "No links.").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");

        let count =
            rewrite_backlinks_on_rename_on_conn(dir.path(), &mut conn, "missing.md", "new.md")
                .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn rewrite_backlinks_multiple_sources() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "[[target.md]]").unwrap();
        fs::write(dir.path().join("c.md"), "Also [[target.md|display]].").unwrap();
        fs::write(dir.path().join("target.md"), "").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        insert_note(&mut conn, 2, "target.md", "Target");
        insert_note(&mut conn, 3, "c.md", "C");
        upsert_note_links(&mut conn, 1, &["target.md".to_string()]).unwrap();
        upsert_note_links(&mut conn, 3, &["target.md".to_string()]).unwrap();

        let count = rewrite_backlinks_on_rename_on_conn(
            dir.path(),
            &mut conn,
            "target.md",
            "renamed.md",
        )
        .unwrap();

        assert_eq!(count, 2);
        assert_eq!(
            fs::read_to_string(dir.path().join("a.md")).unwrap(),
            "[[renamed.md]]"
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("c.md")).unwrap(),
            "Also [[renamed.md|display]]."
        );
    }

    // ── get_alias_collisions_on_conn ─────────────────────────────────────────

    #[test]
    fn collisions_empty_when_no_shared_aliases() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "Note A");
        insert_note(&mut conn, 2, "b.md", "Note B");
        upsert_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        upsert_note_aliases(&mut conn, 2, &["Dragon".to_string()]).unwrap();
        let collisions = get_alias_collisions_on_conn(&mut conn, 1).unwrap();
        assert!(collisions.is_empty());
    }

    #[test]
    fn collisions_detected_when_alias_shared_with_another_note() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "Note A");
        insert_note(&mut conn, 2, "b.md", "Note B");
        upsert_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        upsert_note_aliases(&mut conn, 2, &["Captain Ash".to_string()]).unwrap();
        let collisions = get_alias_collisions_on_conn(&mut conn, 1).unwrap();
        assert_eq!(collisions.len(), 1);
        assert_eq!(collisions[0].alias, "Captain Ash");
        assert_eq!(collisions[0].other_note_id, 2);
        assert_eq!(collisions[0].other_note_title, "Note B");
    }

    #[test]
    fn collisions_detected_case_insensitively() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "Note A");
        insert_note(&mut conn, 2, "b.md", "Note B");
        upsert_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        upsert_note_aliases(&mut conn, 2, &["captain ash".to_string()]).unwrap();
        let collisions = get_alias_collisions_on_conn(&mut conn, 1).unwrap();
        assert_eq!(collisions.len(), 1);
        assert_eq!(collisions[0].other_note_id, 2);
    }

    #[test]
    fn collisions_returns_no_results_when_note_has_no_aliases() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "Note A");
        let collisions = get_alias_collisions_on_conn(&mut conn, 1).unwrap();
        assert!(collisions.is_empty());
    }

    #[test]
    fn collisions_not_self_reported() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "Note A");
        upsert_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        let collisions = get_alias_collisions_on_conn(&mut conn, 1).unwrap();
        assert!(collisions.is_empty(), "own aliases should not be reported as collisions");
    }

    // ── search_notes_by_alias_on_conn ────────────────────────────────────────

    #[test]
    fn alias_search_prefix_matches() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "ash.md", "Ash");
        upsert_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        let results = search_notes_by_alias_on_conn(&mut conn, "Captain").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, 1);
        assert_eq!(results[0].title, "Ash");
        assert_eq!(results[0].path, "ash.md");
    }

    #[test]
    fn alias_search_case_insensitive() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "ash.md", "Ash");
        upsert_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        let results = search_notes_by_alias_on_conn(&mut conn, "captain").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, 1);
    }

    #[test]
    fn alias_search_no_match_returns_empty() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "ash.md", "Ash");
        upsert_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        let results = search_notes_by_alias_on_conn(&mut conn, "Dragon").unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn alias_search_empty_query_returns_empty() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "ash.md", "Ash");
        upsert_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        let results = search_notes_by_alias_on_conn(&mut conn, "").unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn alias_search_deduplicates_same_note_multiple_aliases() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "ash.md", "Ash");
        upsert_note_aliases(
            &mut conn,
            1,
            &["Captain Ash".to_string(), "Captain Ashford".to_string()],
        )
        .unwrap();
        let results = search_notes_by_alias_on_conn(&mut conn, "Captain").unwrap();
        assert_eq!(results.len(), 1, "DISTINCT should collapse multiple alias matches to one row");
        assert_eq!(results[0].id, 1);
    }

    // ── resolve_note_by_alias_on_conn ────────────────────────────────────────

    #[test]
    fn resolve_by_alias_exact_match() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "ash.md", "Ash");
        upsert_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        let result = resolve_note_by_alias_on_conn(&mut conn, "Captain Ash").unwrap();
        assert!(result.is_some());
        let r = result.unwrap();
        assert_eq!(r.id, 1);
        assert_eq!(r.title, "Ash");
        assert_eq!(r.path, "ash.md");
    }

    #[test]
    fn resolve_by_alias_no_match_returns_none() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "ash.md", "Ash");
        upsert_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        let result = resolve_note_by_alias_on_conn(&mut conn, "Unknown").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn resolve_by_alias_case_insensitive() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "ash.md", "Ash");
        upsert_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        let result = resolve_note_by_alias_on_conn(&mut conn, "captain ash").unwrap();
        assert!(result.is_some());
        assert_eq!(result.unwrap().id, 1);
    }

    #[test]
    fn resolve_by_alias_partial_does_not_match() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "ash.md", "Ash");
        upsert_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        let result = resolve_note_by_alias_on_conn(&mut conn, "Captain").unwrap();
        assert!(result.is_none(), "partial alias must not resolve");
    }
}
