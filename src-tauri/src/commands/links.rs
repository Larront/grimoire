// Link index: note_links and note_aliases tables.
//
// Both tables are derived indices — the markdown file is the source of truth
// for wikilinks and aliases respectively. Both are fully regenerable from a
// ledger scan; see ADR-0005 and CONTEXT.md §Link Index / §Note Alias.

use crate::commands::frontmatter;
use crate::note_write::write_note_file;
use crate::db::schema::note_aliases::dsl as na;
use crate::db::schema::note_links::dsl as nl;
use crate::db::schema::notes::dsl as n;
use crate::ledger::AppLedger;
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
/// fragments from each match. Embeds (`![[...]]`) are transclusions, not
/// note links, and are skipped. Returns deduplicated results.
pub fn extract_wikilinks(content: &str) -> Vec<String> {
    let body = strip_frontmatter_body(content);
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut links: Vec<String> = Vec::new();
    let mut rest = body.as_str();
    while let Some(start) = rest.find("[[") {
        let is_embed = start > 0 && rest.as_bytes()[start - 1] == b'!';
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
            if !is_embed && !target.is_empty() && seen.insert(target.to_string()) {
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
    frontmatter::split_frontmatter(content)
        .map(|(_, body)| body)
        .unwrap_or_else(|| content.to_string())
}

// ── Target resolution (Obsidian-style) ────────────────────────────────────────

/// Strip a `#heading` / `#^block` fragment from a raw wikilink target.
pub fn strip_fragment(target: &str) -> &str {
    target.split('#').next().unwrap_or(target).trim()
}

/// The filename stem of a vault-relative path: last segment, `.md` stripped.
fn path_stem(path: &str) -> &str {
    let base = path.rsplit('/').next().unwrap_or(path);
    base.strip_suffix(".md").unwrap_or(base)
}

/// Keep the entry pointing at the better candidate: shortest path wins,
/// alphabetical breaks ties. Makes ambiguous filename matches deterministic.
fn upsert_best(
    map: &mut std::collections::HashMap<String, usize>,
    key: String,
    idx: usize,
    notes: &[ResolvedNote],
) {
    use std::collections::hash_map::Entry;
    match map.entry(key) {
        Entry::Vacant(v) => {
            v.insert(idx);
        }
        Entry::Occupied(mut o) => {
            let cur = &notes[*o.get()].path;
            let new = &notes[idx].path;
            if (new.len(), new.as_str()) < (cur.len(), cur.as_str()) {
                o.insert(idx);
            }
        }
    }
}

/// Resolves raw `[[...]]` target strings to notes with Obsidian's semantics,
/// in priority order:
///
/// 1. exact vault-relative path, with or without the `.md` extension
/// 2. filename match (`[[The Spark]]` → `Atlas/Aspects/The Spark.md`), or
///    path-suffix match for disambiguated links (`[[Aspects/The Spark]]`)
/// 3. frontmatter alias
///
/// All matching is case-insensitive and ignores `#fragment` suffixes.
pub struct TargetResolver {
    notes: Vec<ResolvedNote>,
    by_path: std::collections::HashMap<String, usize>,
    by_path_no_ext: std::collections::HashMap<String, usize>,
    by_stem: std::collections::HashMap<String, usize>,
    by_alias: std::collections::HashMap<String, usize>,
}

impl TargetResolver {
    pub fn build(notes: Vec<ResolvedNote>, aliases: &[(i32, String)]) -> Self {
        let mut by_path = std::collections::HashMap::new();
        let mut by_path_no_ext = std::collections::HashMap::new();
        let mut by_stem = std::collections::HashMap::new();
        for (i, note) in notes.iter().enumerate() {
            let lower = note.path.to_lowercase();
            let no_ext = lower.strip_suffix(".md").unwrap_or(&lower).to_string();
            let stem = path_stem(&lower).to_string();
            upsert_best(&mut by_path, lower, i, &notes);
            upsert_best(&mut by_path_no_ext, no_ext, i, &notes);
            upsert_best(&mut by_stem, stem, i, &notes);
        }
        let id_to_idx: std::collections::HashMap<i32, usize> =
            notes.iter().enumerate().map(|(i, note)| (note.id, i)).collect();
        let mut by_alias = std::collections::HashMap::new();
        for (note_id, alias) in aliases {
            if let Some(&i) = id_to_idx.get(note_id) {
                upsert_best(&mut by_alias, alias.to_lowercase(), i, &notes);
            }
        }
        Self { notes, by_path, by_path_no_ext, by_stem, by_alias }
    }

    pub fn load(conn: &mut SqliteConnection) -> Result<Self, String> {
        let note_rows: Vec<(i32, String, String)> = n::notes
            .select((n::id, n::title, n::path))
            .load(conn)
            .map_err(|e| e.to_string())?;
        let notes = note_rows
            .into_iter()
            .map(|(id, title, path)| ResolvedNote { id, title, path })
            .collect();
        let alias_rows: Vec<(i32, String)> = na::note_aliases
            .select((na::note_id, na::alias))
            .load(conn)
            .map_err(|e| e.to_string())?;
        Ok(Self::build(notes, &alias_rows))
    }

    pub fn resolve(&self, target: &str) -> Option<&ResolvedNote> {
        let t = strip_fragment(target).to_lowercase();
        if t.is_empty() {
            return None;
        }
        if let Some(&i) = self.by_path.get(&t) {
            return Some(&self.notes[i]);
        }
        if let Some(&i) = self.by_path_no_ext.get(&t) {
            return Some(&self.notes[i]);
        }
        if t.contains('/') {
            // Disambiguated sub-path link: match notes whose path ends with it.
            let suffix_md = format!("/{}.md", t);
            let suffix_raw = format!("/{}", t);
            let mut best: Option<usize> = None;
            for (i, note) in self.notes.iter().enumerate() {
                let lower = note.path.to_lowercase();
                if lower.ends_with(&suffix_md) || lower.ends_with(&suffix_raw) {
                    best = match best {
                        None => Some(i),
                        Some(b) => {
                            let (cur, new) = (&self.notes[b].path, &note.path);
                            if (new.len(), new.as_str()) < (cur.len(), cur.as_str()) {
                                Some(i)
                            } else {
                                Some(b)
                            }
                        }
                    };
                }
            }
            if let Some(i) = best {
                return Some(&self.notes[i]);
            }
        } else if let Some(&i) = self.by_stem.get(&t) {
            return Some(&self.notes[i]);
        }
        self.by_alias.get(&t).map(|&i| &self.notes[i])
    }
}

// ── Backlink rewrite ──────────────────────────────────────────────────────────

/// Walk every `[[...]]` link in `content`; where `map` returns a replacement
/// for the isolated target (display text and heading fragments excluded), swap
/// it in and keep the `|display` / `#heading` suffix. Returns (new_content,
/// was_changed).
fn rewrite_wikilinks_with(
    content: &str,
    map: impl Fn(&str) -> Option<String>,
) -> (String, bool) {
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
            if let Some(replacement) = map(raw_target) {
                result.push_str(&replacement);
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

/// For every note whose links reached the renamed note — written as the full
/// path (with or without `.md`) or as a bare filename stem — reads the
/// markdown file, rewrites those links to the equivalent new form, saves the
/// file, and re-indexes the note's outbound links in the DB.
/// Returns the number of notes whose files were actually modified.
///
/// Must run while the `notes` row still holds `old_path`: the stem-ownership
/// check below resolves against the pre-rename state.
/// Returns a list of `(Note, rewritten_content)` pairs for every source note
/// whose text would change — computed but **not** written. Performs no disk
/// writes and touches no derived indexes, so a caller can either apply the
/// rewrites (phase B) or just report the affected sources (the deferred plan
/// for the external-move prompt). [`rewrite_backlinks_on_rename_on_conn`] is the
/// applying wrapper.
pub fn collect_backlink_rewrites_on_conn(
    ledger_path: &Path,
    conn: &mut SqliteConnection,
    old_path: &str,
    new_path: &str,
) -> Result<Vec<(crate::db::models::Note, String)>, String> {
    let old_no_ext = old_path.strip_suffix(".md").unwrap_or(old_path);
    let new_no_ext = new_path.strip_suffix(".md").unwrap_or(new_path);
    let old_stem = path_stem(old_path);
    let new_stem = path_stem(new_path);

    // Bare-stem links ([[The Spark]]) only break when the filename itself
    // changes — a folder move keeps them resolving. And rewrite them only if
    // this note actually owned the stem: when another note shares the stem
    // and wins resolution, those links were never ours to rewrite.
    let stem_changed = !old_stem.eq_ignore_ascii_case(new_stem);
    let owns_stem = stem_changed
        && TargetResolver::load(conn)?
            .resolve(old_stem)
            .is_some_and(|r| r.path == old_path);

    let map_target = |target: &str| -> Option<String> {
        if target.eq_ignore_ascii_case(old_path) {
            Some(new_path.to_string())
        } else if target.eq_ignore_ascii_case(old_no_ext) {
            Some(new_no_ext.to_string())
        } else if owns_stem && target.eq_ignore_ascii_case(old_stem) {
            Some(new_stem.to_string())
        } else {
            None
        }
    };

    let link_rows: Vec<(i32, String)> = nl::note_links
        .select((nl::source_id, nl::target_path))
        .load(conn)
        .map_err(|e| e.to_string())?;
    let source_ids: BTreeSet<i32> = link_rows
        .iter()
        .filter(|(_, target)| map_target(target).is_some())
        .map(|(source_id, _)| *source_id)
        .collect();

    let sources: Vec<crate::db::models::Note> = n::notes
        .filter(n::id.eq_any(&source_ids))
        .load(conn)
        .map_err(|e| e.to_string())?;

    let mut rewrites: Vec<(crate::db::models::Note, String)> = Vec::new();
    for source in sources {
        let full_path = ledger_path.join(&source.path);
        let content = match fs::read_to_string(&full_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let (new_content, changed) = rewrite_wikilinks_with(&content, map_target);
        if changed {
            rewrites.push((source, new_content));
        }
    }
    Ok(rewrites)
}

/// Apply the backlink rewrites a rename implies: like
/// [`collect_backlink_rewrites_on_conn`] but writes each rewritten source file
/// through the [`write_note_file`] Write Chokepoint before returning it. The
/// caller reconciles the returned sources' derived indexes itself.
///
/// Used by the folder-rename path. The single-note rename routes through
/// `note_mutation::rename`, which applies phase B via `commit_many` (one batched
/// write-and-reconcile) instead.
pub fn rewrite_backlinks_on_rename_on_conn(
    ledger_path: &Path,
    conn: &mut SqliteConnection,
    old_path: &str,
    new_path: &str,
) -> Result<Vec<(crate::db::models::Note, String)>, String> {
    let rewrites = collect_backlink_rewrites_on_conn(ledger_path, conn, old_path, new_path)?;
    for (source, new_content) in &rewrites {
        write_note_file(&ledger_path.join(&source.path), new_content.as_bytes())?;
    }
    Ok(rewrites)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[derive(Serialize, Debug, Clone, specta::Type)]
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
#[specta::specta]
pub fn get_alias_collisions(
    note_id: i32,
    ledger: State<AppLedger>,
) -> Result<Vec<AliasCollision>, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    get_alias_collisions_on_conn(conn, note_id)
}

#[derive(Serialize, specta::Type, Debug, Clone)]
pub struct ResolvedNote {
    pub id: i32,
    pub title: String,
    pub path: String,
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

pub fn resolve_note_target_on_conn(
    conn: &mut SqliteConnection,
    target: &str,
) -> Result<Option<ResolvedNote>, String> {
    Ok(TargetResolver::load(conn)?.resolve(target).cloned())
}

#[tauri::command]
#[specta::specta]
pub fn resolve_note_target(
    target: String,
    ledger: State<AppLedger>,
) -> Result<Option<ResolvedNote>, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    resolve_note_target_on_conn(conn, &target)
}

#[derive(Serialize, Debug, Clone, specta::Type)]
pub struct BacklinkNote {
    pub id: i32,
    pub path: String,
    pub title: String,
}

#[derive(Serialize, Debug, Clone, specta::Type)]
pub struct OutboundLink {
    pub target_path: String,
    pub resolved_id: Option<i32>,
    pub resolved_title: Option<String>,
    pub resolved_path: Option<String>,
}

pub fn get_backlinks_on_conn(
    conn: &mut SqliteConnection,
    note_id: i32,
) -> Result<Vec<BacklinkNote>, String> {
    let resolver = TargetResolver::load(conn)?;
    let link_rows: Vec<(i32, String)> = nl::note_links
        .select((nl::source_id, nl::target_path))
        .load(conn)
        .map_err(|e| e.to_string())?;

    let source_ids: BTreeSet<i32> = link_rows
        .iter()
        .filter(|(_, target)| resolver.resolve(target).map(|r| r.id) == Some(note_id))
        .map(|(source_id, _)| *source_id)
        .collect();

    let mut result: Vec<BacklinkNote> = n::notes
        .filter(n::id.eq_any(&source_ids))
        .select((n::id, n::path, n::title))
        .load::<(i32, String, String)>(conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(id, path, title)| BacklinkNote { id, path, title })
        .collect();
    result.sort_by(|a, b| a.title.cmp(&b.title));
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub fn get_backlinks(note_id: i32, ledger: State<AppLedger>) -> Result<Vec<BacklinkNote>, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    get_backlinks_on_conn(conn, note_id)
}

pub fn get_outbound_links_on_conn(
    conn: &mut SqliteConnection,
    note_id: i32,
) -> Result<Vec<OutboundLink>, String> {
    let resolver = TargetResolver::load(conn)?;
    let link_rows: Vec<String> = nl::note_links
        .filter(nl::source_id.eq(note_id))
        .select(nl::target_path)
        .load(conn)
        .map_err(|e| e.to_string())?;

    Ok(link_rows
        .into_iter()
        .map(|target_path| {
            let resolved = resolver.resolve(&target_path);
            OutboundLink {
                resolved_id: resolved.map(|r| r.id),
                resolved_title: resolved.map(|r| r.title.clone()),
                resolved_path: resolved.map(|r| r.path.clone()),
                target_path,
            }
        })
        .collect())
}

#[tauri::command]
#[specta::specta]
pub fn get_outbound_links(
    note_id: i32,
    ledger: State<AppLedger>,
) -> Result<Vec<OutboundLink>, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    get_outbound_links_on_conn(conn, note_id)
}

pub fn get_note_backlink_count_on_conn(
    conn: &mut SqliteConnection,
    note_path: &str,
) -> Result<u32, String> {
    let resolver = TargetResolver::load(conn)?;
    let link_rows: Vec<(i32, String)> = nl::note_links
        .select((nl::source_id, nl::target_path))
        .load(conn)
        .map_err(|e| e.to_string())?;
    let sources: BTreeSet<i32> = link_rows
        .iter()
        .filter(|(_, target)| {
            resolver.resolve(target).map(|r| r.path.as_str()) == Some(note_path)
        })
        .map(|(source_id, _)| *source_id)
        .collect();
    Ok(sources.len() as u32)
}

#[tauri::command]
#[specta::specta]
pub fn get_note_backlink_count(note_path: String, ledger: State<AppLedger>) -> Result<u32, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    get_note_backlink_count_on_conn(conn, &note_path)
}

#[tauri::command]
#[specta::specta]
pub fn get_note_aliases(note_id: i32, ledger: State<AppLedger>) -> Result<Vec<String>, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    na::note_aliases
        .filter(na::note_id.eq(note_id))
        .select(na::alias)
        .load(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn set_note_aliases(
    note_id: i32,
    aliases: Vec<String>,
    ledger: State<AppLedger>,
) -> Result<(), String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?.clone();

    // Field-split so conn (mut) and search_index (ref) can be borrowed simultaneously.
    let state_ref = &mut *state;
    let conn = state_ref.connection.as_mut().ok_or("No ledger open")?;
    let index = state_ref.search_index.as_ref();

    let note: crate::db::models::Note = n::notes
        .find(note_id)
        .first(conn)
        .map_err(|e| e.to_string())?;

    let full_path = ledger_path.join(&note.path);
    let content = fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
    let new_content = frontmatter::apply_aliases(&content, &aliases);

    crate::note_mutation::commit(conn, index, &ledger_path, &full_path, &note, &new_content)?;
    Ok(())
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

    // Test fixtures: seed the derived link/alias tables directly. Production
    // writes go solely through `note_index`; these only populate rows so the
    // resolver / backlink / collision tests below have data to read.
    fn seed_note_links(
        conn: &mut SqliteConnection,
        source_id: i32,
        links: &[String],
    ) -> Result<(), String> {
        diesel::delete(nl::note_links.filter(nl::source_id.eq(source_id)))
            .execute(conn)
            .map_err(|e| e.to_string())?;
        for target in links {
            diesel::insert_into(nl::note_links)
                .values((nl::source_id.eq(source_id), nl::target_path.eq(target)))
                .execute(conn)
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn seed_note_aliases(
        conn: &mut SqliteConnection,
        note_id: i32,
        aliases: &[String],
    ) -> Result<(), String> {
        diesel::delete(na::note_aliases.filter(na::note_id.eq(note_id)))
            .execute(conn)
            .map_err(|e| e.to_string())?;
        for alias in aliases {
            diesel::insert_into(na::note_aliases)
                .values((na::note_id.eq(note_id), na::alias.eq(alias)))
                .execute(conn)
                .map_err(|e| e.to_string())?;
        }
        Ok(())
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

    // ── note_links / note_aliases FK cascade ─────────────────────────────────

    #[test]
    fn deleting_note_cascades_to_link_rows() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        seed_note_links(&mut conn, 1, &["b.md".to_string()]).unwrap();
        conn.batch_execute("DELETE FROM notes WHERE id = 1").unwrap();
        let rows: Vec<(i32, String)> = nl::note_links.load(&mut conn).unwrap();
        assert!(rows.is_empty(), "cascade delete should remove link rows");
    }

    #[test]
    fn deleting_note_cascades_to_alias_rows() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        seed_note_aliases(&mut conn, 1, &["Ash".to_string()]).unwrap();
        conn.batch_execute("DELETE FROM notes WHERE id = 1").unwrap();
        let rows: Vec<(i32, String)> = na::note_aliases.load(&mut conn).unwrap();
        assert!(rows.is_empty(), "cascade delete should remove alias rows");
    }

    // ── rewrite_wikilinks_with ───────────────────────────────────────────────

    /// Exact-target rewrite, the shape rename uses for full-path links.
    fn rewrite_wikilinks_in_content(
        content: &str,
        old_path: &str,
        new_path: &str,
    ) -> (String, bool) {
        rewrite_wikilinks_with(content, |target| {
            (target == old_path).then(|| new_path.to_string())
        })
    }

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
        seed_note_links(&mut conn, 1, &["b.md".to_string()]).unwrap();

        let rewrites =
            rewrite_backlinks_on_rename_on_conn(dir.path(), &mut conn, "b.md", "b-renamed.md")
                .unwrap();

        assert_eq!(rewrites.len(), 1, "one note should have been rewritten");

        // File content should have been updated
        let updated = fs::read_to_string(dir.path().join("a.md")).unwrap();
        assert_eq!(updated, "See [[b-renamed.md]].");

        // Returned item is (Note, new_content) — index update is caller's responsibility
        assert_eq!(rewrites[0].0.path, "a.md");
        assert!(rewrites[0].1.contains("b-renamed.md"));
    }

    #[test]
    fn rewrite_backlinks_returns_zero_when_no_backlinks() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "No links.").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");

        let rewrites =
            rewrite_backlinks_on_rename_on_conn(dir.path(), &mut conn, "missing.md", "new.md")
                .unwrap();
        assert!(rewrites.is_empty());
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
        seed_note_links(&mut conn, 1, &["target.md".to_string()]).unwrap();
        seed_note_links(&mut conn, 3, &["target.md".to_string()]).unwrap();

        let rewrites = rewrite_backlinks_on_rename_on_conn(
            dir.path(),
            &mut conn,
            "target.md",
            "renamed.md",
        )
        .unwrap();

        assert_eq!(rewrites.len(), 2);
        assert_eq!(
            fs::read_to_string(dir.path().join("a.md")).unwrap(),
            "[[renamed.md]]"
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("c.md")).unwrap(),
            "Also [[renamed.md|display]]."
        );
    }

    // ── timeline fence — extract and rewrite ────────────────────────────────

    #[test]
    fn extract_wikilinks_finds_links_inside_timeline_fence() {
        let content = "```timeline\nDate: [[Calendar.md]]\nTitle: [[The Shattering.md]]\nSee [[Aldric.md]] for context.\n```";
        let links = extract_wikilinks(content);
        assert!(
            links.contains(&"Calendar.md".to_string()),
            "expected Calendar.md in {links:?}"
        );
        assert!(
            links.contains(&"The Shattering.md".to_string()),
            "expected The Shattering.md in {links:?}"
        );
        assert!(
            links.contains(&"Aldric.md".to_string()),
            "expected Aldric.md in {links:?}"
        );
    }

    #[test]
    fn rewrite_backlinks_rewrites_inside_timeline_fence() {
        let dir = TempDir::new().unwrap();
        let content = "```timeline\nDate: Year 1\nTitle: [[target.md]]\nSee also [[target.md|display]].\n```";
        fs::write(dir.path().join("note.md"), content).unwrap();
        fs::write(dir.path().join("target.md"), "").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "note.md", "Note");
        insert_note(&mut conn, 2, "target.md", "Target");
        seed_note_links(&mut conn, 1, &["target.md".to_string()]).unwrap();

        let rewrites =
            rewrite_backlinks_on_rename_on_conn(dir.path(), &mut conn, "target.md", "renamed.md")
                .unwrap();

        assert_eq!(rewrites.len(), 1, "note.md should have been rewritten");
        let updated = fs::read_to_string(dir.path().join("note.md")).unwrap();
        assert!(
            updated.contains("[[renamed.md]]"),
            "bare link should be rewritten: {updated}"
        );
        assert!(
            updated.contains("[[renamed.md|display]]"),
            "aliased link should be rewritten: {updated}"
        );
        assert!(
            !updated.contains("[[target.md"),
            "old path should not remain: {updated}"
        );
    }

    // ── get_alias_collisions_on_conn ─────────────────────────────────────────

    #[test]
    fn collisions_empty_when_no_shared_aliases() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "Note A");
        insert_note(&mut conn, 2, "b.md", "Note B");
        seed_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        seed_note_aliases(&mut conn, 2, &["Dragon".to_string()]).unwrap();
        let collisions = get_alias_collisions_on_conn(&mut conn, 1).unwrap();
        assert!(collisions.is_empty());
    }

    #[test]
    fn collisions_detected_when_alias_shared_with_another_note() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "Note A");
        insert_note(&mut conn, 2, "b.md", "Note B");
        seed_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        seed_note_aliases(&mut conn, 2, &["Captain Ash".to_string()]).unwrap();
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
        seed_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        seed_note_aliases(&mut conn, 2, &["captain ash".to_string()]).unwrap();
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
        seed_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        let collisions = get_alias_collisions_on_conn(&mut conn, 1).unwrap();
        assert!(collisions.is_empty(), "own aliases should not be reported as collisions");
    }

    // ── search_notes_by_alias_on_conn ────────────────────────────────────────

    #[test]
    fn alias_search_prefix_matches() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "ash.md", "Ash");
        seed_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
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
        seed_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        let results = search_notes_by_alias_on_conn(&mut conn, "captain").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, 1);
    }

    #[test]
    fn alias_search_no_match_returns_empty() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "ash.md", "Ash");
        seed_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        let results = search_notes_by_alias_on_conn(&mut conn, "Dragon").unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn alias_search_empty_query_returns_empty() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "ash.md", "Ash");
        seed_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        let results = search_notes_by_alias_on_conn(&mut conn, "").unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn alias_search_deduplicates_same_note_multiple_aliases() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "ash.md", "Ash");
        seed_note_aliases(
            &mut conn,
            1,
            &["Captain Ash".to_string(), "Captain Ashford".to_string()],
        )
        .unwrap();
        let results = search_notes_by_alias_on_conn(&mut conn, "Captain").unwrap();
        assert_eq!(results.len(), 1, "DISTINCT should collapse multiple alias matches to one row");
        assert_eq!(results[0].id, 1);
    }

    // ── resolve_note_target_on_conn ──────────────────────────────────────────

    #[test]
    fn resolve_by_alias_exact_match() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "ash.md", "Ash");
        seed_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        let result = resolve_note_target_on_conn(&mut conn, "Captain Ash").unwrap();
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
        seed_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        let result = resolve_note_target_on_conn(&mut conn, "Unknown").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn resolve_by_alias_case_insensitive() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "ash.md", "Ash");
        seed_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        let result = resolve_note_target_on_conn(&mut conn, "captain ash").unwrap();
        assert!(result.is_some());
        assert_eq!(result.unwrap().id, 1);
    }

    #[test]
    fn resolve_by_alias_partial_does_not_match() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "ash.md", "Ash");
        seed_note_aliases(&mut conn, 1, &["Captain Ash".to_string()]).unwrap();
        let result = resolve_note_target_on_conn(&mut conn, "Captain").unwrap();
        assert!(result.is_none(), "partial alias must not resolve");
    }

    // ── TargetResolver — Obsidian-style resolution ───────────────────────────

    fn resolver_with(notes: &[(i32, &str)], aliases: &[(i32, &str)]) -> TargetResolver {
        TargetResolver::build(
            notes
                .iter()
                .map(|(id, path)| ResolvedNote {
                    id: *id,
                    title: format!("Note {}", id),
                    path: path.to_string(),
                })
                .collect(),
            &aliases
                .iter()
                .map(|(id, alias)| (*id, alias.to_string()))
                .collect::<Vec<_>>(),
        )
    }

    #[test]
    fn resolve_bare_name_matches_nested_note() {
        let r = resolver_with(&[(1, "Atlas of Calencia/Aspects/The Spark.md")], &[]);
        assert_eq!(r.resolve("The Spark").map(|n| n.id), Some(1));
    }

    #[test]
    fn resolve_bare_name_is_case_insensitive() {
        let r = resolver_with(&[(1, "Deities/Caeligo, God of Darkness.md")], &[]);
        assert_eq!(r.resolve("caeligo, god of darkness").map(|n| n.id), Some(1));
    }

    #[test]
    fn resolve_exact_path_with_and_without_extension() {
        let r = resolver_with(&[(1, "folder/note.md")], &[]);
        assert_eq!(r.resolve("folder/note.md").map(|n| n.id), Some(1));
        assert_eq!(r.resolve("folder/note").map(|n| n.id), Some(1));
    }

    #[test]
    fn resolve_subpath_suffix_match() {
        let r = resolver_with(&[(1, "Atlas/Aspects/The Spark.md")], &[]);
        assert_eq!(r.resolve("Aspects/The Spark").map(|n| n.id), Some(1));
    }

    #[test]
    fn resolve_strips_heading_fragment() {
        let r = resolver_with(&[(1, "Events/The Severance.md")], &[]);
        assert_eq!(
            r.resolve("The Severance#The Night of Silence").map(|n| n.id),
            Some(1)
        );
    }

    #[test]
    fn resolve_exact_path_beats_stem_of_other_note() {
        // A note literally at "The Spark.md" must win over a nested stem match.
        let r = resolver_with(
            &[(1, "Atlas/The Spark.md"), (2, "The Spark.md")],
            &[],
        );
        assert_eq!(r.resolve("The Spark.md").map(|n| n.id), Some(2));
    }

    #[test]
    fn resolve_stem_beats_alias() {
        let r = resolver_with(
            &[(1, "npcs/Mira.md"), (2, "npcs/other.md")],
            &[(2, "Mira")],
        );
        assert_eq!(
            r.resolve("Mira").map(|n| n.id),
            Some(1),
            "a filename match must win over another note's alias"
        );
    }

    #[test]
    fn resolve_ambiguous_stem_picks_shortest_then_alphabetical() {
        let r = resolver_with(
            &[(1, "b/deep/nested/Plan.md"), (2, "a/Plan.md"), (3, "c/Plan.md")],
            &[],
        );
        assert_eq!(
            r.resolve("Plan").map(|n| n.id),
            Some(2),
            "shortest path, then alphabetical, must win"
        );
    }

    #[test]
    fn resolve_empty_and_fragment_only_return_none() {
        let r = resolver_with(&[(1, "note.md")], &[]);
        assert!(r.resolve("").is_none());
        assert!(r.resolve("#Heading Only").is_none());
    }

    // ── stem-aware backlinks ─────────────────────────────────────────────────

    #[test]
    fn backlinks_include_bare_stem_links() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        insert_note(&mut conn, 2, "Atlas/Aspects/The Spark.md", "The Spark");
        seed_note_links(&mut conn, 1, &["The Spark".to_string()]).unwrap();

        let backlinks = get_backlinks_on_conn(&mut conn, 2).unwrap();
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].id, 1);
    }

    #[test]
    fn backlink_count_includes_bare_stem_links() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        insert_note(&mut conn, 2, "b.md", "B");
        insert_note(&mut conn, 3, "Atlas/Aspects/The Spark.md", "The Spark");
        seed_note_links(&mut conn, 1, &["The Spark".to_string()]).unwrap();
        seed_note_links(&mut conn, 2, &["atlas/aspects/the spark".to_string()]).unwrap();

        let count =
            get_note_backlink_count_on_conn(&mut conn, "Atlas/Aspects/The Spark.md").unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn outbound_links_resolve_bare_stems() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        insert_note(&mut conn, 2, "Atlas/Aspects/The Spark.md", "The Spark");
        seed_note_links(
            &mut conn,
            1,
            &["The Spark".to_string(), "Nowhere".to_string()],
        )
        .unwrap();

        let outbound = get_outbound_links_on_conn(&mut conn, 1).unwrap();
        assert_eq!(outbound.len(), 2);
        let spark = outbound.iter().find(|l| l.target_path == "The Spark").unwrap();
        assert_eq!(spark.resolved_id, Some(2));
        assert_eq!(spark.resolved_path.as_deref(), Some("Atlas/Aspects/The Spark.md"));
        let nowhere = outbound.iter().find(|l| l.target_path == "Nowhere").unwrap();
        assert!(nowhere.resolved_id.is_none(), "unresolvable target must stay a stub");
    }

    // ── extract_wikilinks — embeds ───────────────────────────────────────────

    #[test]
    fn extract_skips_image_embeds() {
        let links = extract_wikilinks("See ![[image.png|cover]] and [[Real Note]].");
        assert_eq!(links, vec!["Real Note"]);
    }

    #[test]
    fn extract_embed_at_start_of_content() {
        let links = extract_wikilinks("![[banner.png]]\nThen [[Target]].");
        assert_eq!(links, vec!["Target"]);
    }

    // ── rename rewrite — bare-stem links ─────────────────────────────────────

    #[test]
    fn rename_rewrites_bare_stem_links_when_stem_changes() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "See [[The Spark]] today.").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        insert_note(&mut conn, 2, "Atlas/The Spark.md", "The Spark");
        seed_note_links(&mut conn, 1, &["The Spark".to_string()]).unwrap();

        let rewrites = rewrite_backlinks_on_rename_on_conn(
            dir.path(),
            &mut conn,
            "Atlas/The Spark.md",
            "Atlas/The Ember.md",
        )
        .unwrap();

        assert_eq!(rewrites.len(), 1);
        let updated = fs::read_to_string(dir.path().join("a.md")).unwrap();
        assert_eq!(updated, "See [[The Ember]] today.");
    }

    #[test]
    fn rename_folder_move_leaves_bare_stem_links_alone() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "See [[The Spark]].").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        insert_note(&mut conn, 2, "Atlas/The Spark.md", "The Spark");
        seed_note_links(&mut conn, 1, &["The Spark".to_string()]).unwrap();

        let rewrites = rewrite_backlinks_on_rename_on_conn(
            dir.path(),
            &mut conn,
            "Atlas/The Spark.md",
            "Elsewhere/The Spark.md",
        )
        .unwrap();

        assert!(rewrites.is_empty(), "folder move keeps bare-stem links resolving — no rewrite");
        let content = fs::read_to_string(dir.path().join("a.md")).unwrap();
        assert_eq!(content, "See [[The Spark]].");
    }

    #[test]
    fn rename_does_not_steal_stem_links_owned_by_another_note() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "See [[Plan]].").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a.md", "A");
        // "Plan.md" at the root wins stem resolution over the nested one.
        insert_note(&mut conn, 2, "Plan.md", "Plan");
        insert_note(&mut conn, 3, "deep/Plan.md", "Plan (deep)");
        seed_note_links(&mut conn, 1, &["Plan".to_string()]).unwrap();

        let rewrites = rewrite_backlinks_on_rename_on_conn(
            dir.path(),
            &mut conn,
            "deep/Plan.md",
            "deep/Schedule.md",
        )
        .unwrap();

        assert!(rewrites.is_empty(), "links resolving to the other Plan note must not be rewritten");
        let content = fs::read_to_string(dir.path().join("a.md")).unwrap();
        assert_eq!(content, "See [[Plan]].");
    }
}
