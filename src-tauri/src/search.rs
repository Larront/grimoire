use crate::db::models::{Map, Note, Scene};
use serde::Serialize;
use std::path::Path;
use tantivy::{
    collector::TopDocs,
    directory::MmapDirectory,
    schema::{DateOptions, NumericOptions, OwnedValue, Schema, STORED, STRING, TEXT},
    DateTime as TantivyDateTime,
    Index, IndexWriter, TantivyDocument,
};

#[derive(Debug, Serialize, Clone)]
pub struct NoteSearchResult {
    pub id: i32,
    pub title: String,
    pub path: String,
    pub excerpt: Option<String>,
    pub match_count: usize,
}

#[derive(Debug, Serialize, Clone)]
pub struct MapSearchResult {
    pub id: i32,
    pub title: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct SceneSearchResult {
    pub id: i32,
    pub name: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct SearchAllResult {
    pub notes: Vec<NoteSearchResult>,
    pub maps: Vec<MapSearchResult>,
    pub scenes: Vec<SceneSearchResult>,
}

// ── Plain-text extraction ─────────────────────────────────────────────────────

pub fn extract_plain_text(content: &str) -> String {
    let body = strip_frontmatter(content);
    let body = strip_images(&body);
    let body = strip_wiki_link_braces(&body);
    strip_html_tags(&body)
}

fn strip_frontmatter(content: &str) -> String {
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

fn strip_images(text: &str) -> String {
    // Remove ![alt](path{attrs}) — the image path must not be indexed.
    let mut result = String::new();
    let mut chars = text.char_indices().peekable();
    while let Some((_, c)) = chars.next() {
        if c == '!' {
            if chars.peek().map(|(_, c)| *c) == Some('[') {
                chars.next(); // consume '['
                let mut depth = 1usize;
                while let Some((_, c2)) = chars.next() {
                    if c2 == '[' { depth += 1; }
                    if c2 == ']' { depth -= 1; if depth == 0 { break; } }
                }
                if chars.peek().map(|(_, c)| *c) == Some('(') {
                    chars.next(); // consume '('
                    let mut depth = 1usize;
                    while let Some((_, c2)) = chars.next() {
                        if c2 == '(' { depth += 1; }
                        if c2 == ')' { depth -= 1; if depth == 0 { break; } }
                    }
                    // Image syntax fully consumed — do not add to result
                    continue;
                }
                // Not a valid image — we already consumed ![... but can't un-consume.
                // Just skip it (alt text is gone); this is an edge case.
            } else {
                result.push(c);
            }
        } else {
            result.push(c);
        }
    }
    result
}

fn strip_wiki_link_braces(text: &str) -> String {
    let mut result = String::new();
    let mut rest = text;
    while let Some(open_idx) = rest.find("[[") {
        result.push_str(&rest[..open_idx]);
        let after_open = &rest[open_idx + 2..];
        if let Some(close_idx) = after_open.find("]]") {
            let inner = &after_open[..close_idx];
            // [[path|display]] → use display text; [[plain]] → plain
            let display = inner.split('|').last().unwrap_or(inner);
            result.push_str(display);
            rest = &after_open[close_idx + 2..];
        } else {
            result.push_str("[[");
            rest = after_open;
        }
    }
    result.push_str(rest);
    result
}

fn strip_html_tags(text: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    for c in text.chars() {
        if c == '<' {
            in_tag = true;
        } else if c == '>' && in_tag {
            in_tag = false;
        } else if !in_tag {
            result.push(c);
        }
    }
    result
}

// ── Excerpt helpers ───────────────────────────────────────────────────────────

fn count_occurrences(haystack: &str, needle: &str) -> usize {
    if needle.is_empty() { return 0; }
    let mut count = 0;
    let mut start = 0;
    while let Some(idx) = haystack[start..].find(needle) {
        count += 1;
        start += idx + needle.len();
    }
    count
}

fn round_down_char_boundary(s: &str, mut pos: usize) -> usize {
    while pos > 0 && !s.is_char_boundary(pos) { pos -= 1; }
    pos
}

fn round_up_char_boundary(s: &str, mut pos: usize) -> usize {
    while pos < s.len() && !s.is_char_boundary(pos) { pos += 1; }
    pos
}

/// Returns `(excerpt, body_match_count)` or `None` if no body match.
///
/// The excerpt is ~120 chars centred on the first match; match_count is the
/// total number of query-word occurrences in the body.
fn make_excerpt(body_text: &str, query: &str) -> Option<(String, usize)> {
    let lower_body = body_text.to_lowercase();
    let lower_query = query.to_lowercase();
    let words: Vec<&str> = lower_query
        .split_whitespace()
        .filter(|w| w.len() >= 2)
        .collect();

    if words.is_empty() { return None; }

    let (first_pos, first_len) = words
        .iter()
        .filter_map(|w| lower_body.find(w).map(|pos| (pos, w.len())))
        .min_by_key(|(pos, _)| *pos)?;

    let count: usize = words.iter().map(|w| count_occurrences(&lower_body, w)).sum();

    let center = first_pos + first_len / 2;
    let half = 60usize;
    let ideal_start = center.saturating_sub(half);
    let ideal_end = ideal_start + 120;
    let end = ideal_end.min(body_text.len());
    let start = end.saturating_sub(120).min(ideal_start);

    let start = round_down_char_boundary(body_text, start);
    let end = round_up_char_boundary(body_text, end);

    Some((body_text[start..end].to_string(), count))
}

// ── Schema ────────────────────────────────────────────────────────────────────

fn make_schema() -> Schema {
    let mut builder = tantivy::schema::SchemaBuilder::default();
    builder.add_text_field("kind", STRING | STORED);
    // doc_key is a composite deletion key: "{kind}:{id}" (e.g. "note:1", "map:3")
    // Prevents id collisions across entity types during upsert/delete.
    builder.add_text_field("doc_key", STRING | STORED);
    builder.add_i64_field(
        "entity_id",
        NumericOptions::default()
            .set_indexed()
            .set_stored()
            .set_fast(),
    );
    builder.add_text_field("path", STORED);
    builder.add_text_field("title", TEXT | STORED);
    builder.add_text_field("body", TEXT); // indexed but not stored
    builder.add_date_field("modified_at", DateOptions::default().set_stored().set_fast());
    builder.build()
}

fn index_dir(vault_path: &Path) -> std::path::PathBuf {
    vault_path.join(".grimoire").join("search-index")
}

fn parse_modified_at(s: &str) -> i64 {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return dt.timestamp_micros();
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S") {
        return dt.and_utc().timestamp_micros();
    }
    0
}

fn note_doc(schema: &Schema, note: &Note, body_text: &str) -> TantivyDocument {
    let kind = schema.get_field("kind").unwrap();
    let doc_key_f = schema.get_field("doc_key").unwrap();
    let entity_id = schema.get_field("entity_id").unwrap();
    let path_f = schema.get_field("path").unwrap();
    let title_f = schema.get_field("title").unwrap();
    let body_f = schema.get_field("body").unwrap();
    let modified_at_f = schema.get_field("modified_at").unwrap();

    let ts = parse_modified_at(&note.modified_at);
    let tantivy_dt = TantivyDateTime::from_timestamp_micros(ts);

    let mut doc = TantivyDocument::default();
    doc.add_text(kind, "note");
    doc.add_text(doc_key_f, &format!("note:{}", note.id));
    doc.add_i64(entity_id, note.id as i64);
    doc.add_text(path_f, &note.path);
    doc.add_text(title_f, &note.title);
    doc.add_text(body_f, body_text);
    doc.add_date(modified_at_f, tantivy_dt);
    doc
}

fn map_doc(schema: &Schema, map: &Map) -> TantivyDocument {
    let kind = schema.get_field("kind").unwrap();
    let doc_key_f = schema.get_field("doc_key").unwrap();
    let entity_id = schema.get_field("entity_id").unwrap();
    let path_f = schema.get_field("path").unwrap();
    let title_f = schema.get_field("title").unwrap();
    let modified_at_f = schema.get_field("modified_at").unwrap();

    let ts = parse_modified_at(&map.modified_at);
    let tantivy_dt = TantivyDateTime::from_timestamp_micros(ts);

    let mut doc = TantivyDocument::default();
    doc.add_text(kind, "map");
    doc.add_text(doc_key_f, &format!("map:{}", map.id));
    doc.add_i64(entity_id, map.id as i64);
    doc.add_text(path_f, "");
    doc.add_text(title_f, &map.title);
    doc.add_date(modified_at_f, tantivy_dt);
    doc
}

fn scene_doc(schema: &Schema, scene: &Scene) -> TantivyDocument {
    let kind = schema.get_field("kind").unwrap();
    let doc_key_f = schema.get_field("doc_key").unwrap();
    let entity_id = schema.get_field("entity_id").unwrap();
    let path_f = schema.get_field("path").unwrap();
    let title_f = schema.get_field("title").unwrap();
    let modified_at_f = schema.get_field("modified_at").unwrap();

    let ts = parse_modified_at(&scene.created_at);
    let tantivy_dt = TantivyDateTime::from_timestamp_micros(ts);

    let mut doc = TantivyDocument::default();
    doc.add_text(kind, "scene");
    doc.add_text(doc_key_f, &format!("scene:{}", scene.id));
    doc.add_i64(entity_id, scene.id as i64);
    doc.add_text(path_f, "");
    // Scene name is stored in the title field per ADR-0004
    doc.add_text(title_f, &scene.name);
    doc.add_date(modified_at_f, tantivy_dt);
    doc
}

// ── Index lifecycle ───────────────────────────────────────────────────────────

pub fn rebuild_index(
    vault_path: &Path,
    notes: &[Note],
    maps: &[Map],
    scenes: &[Scene],
) -> Result<Index, String> {
    let dir_path = index_dir(vault_path);
    if dir_path.exists() {
        std::fs::remove_dir_all(&dir_path).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&dir_path).map_err(|e| e.to_string())?;

    let schema = make_schema();
    let dir = MmapDirectory::open(&dir_path).map_err(|e| e.to_string())?;
    let index = Index::open_or_create(dir, schema.clone()).map_err(|e| e.to_string())?;

    let mut writer: IndexWriter = index.writer(50_000_000).map_err(|e| e.to_string())?;
    for note in notes {
        let body_text = std::fs::read_to_string(vault_path.join(&note.path))
            .ok()
            .map(|c| extract_plain_text(&c))
            .unwrap_or_default();
        writer
            .add_document(note_doc(&schema, note, &body_text))
            .map_err(|e| e.to_string())?;
    }
    for map in maps {
        writer
            .add_document(map_doc(&schema, map))
            .map_err(|e| e.to_string())?;
    }
    for scene in scenes {
        writer
            .add_document(scene_doc(&schema, scene))
            .map_err(|e| e.to_string())?;
    }
    writer.commit().map_err(|e| e.to_string())?;

    Ok(index)
}

pub fn index_note(index: &Index, note: &Note, body_text: &str) -> Result<(), String> {
    let schema = index.schema();
    let doc_key_f = schema.get_field("doc_key").map_err(|e| e.to_string())?;

    let mut writer: IndexWriter = index.writer(15_000_000).map_err(|e| e.to_string())?;
    writer.delete_term(tantivy::Term::from_field_text(doc_key_f, &format!("note:{}", note.id)));
    writer
        .add_document(note_doc(&schema, note, body_text))
        .map_err(|e| e.to_string())?;
    writer.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn remove_note(index: &Index, entity_id: i32) -> Result<(), String> {
    let schema = index.schema();
    let doc_key_f = schema.get_field("doc_key").map_err(|e| e.to_string())?;

    let mut writer: IndexWriter = index.writer(15_000_000).map_err(|e| e.to_string())?;
    writer.delete_term(tantivy::Term::from_field_text(doc_key_f, &format!("note:{}", entity_id)));
    writer.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn index_map(index: &Index, map: &Map) -> Result<(), String> {
    let schema = index.schema();
    let doc_key_f = schema.get_field("doc_key").map_err(|e| e.to_string())?;

    let mut writer: IndexWriter = index.writer(15_000_000).map_err(|e| e.to_string())?;
    writer.delete_term(tantivy::Term::from_field_text(doc_key_f, &format!("map:{}", map.id)));
    writer
        .add_document(map_doc(&schema, map))
        .map_err(|e| e.to_string())?;
    writer.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn remove_map(index: &Index, map_id: i32) -> Result<(), String> {
    let schema = index.schema();
    let doc_key_f = schema.get_field("doc_key").map_err(|e| e.to_string())?;

    let mut writer: IndexWriter = index.writer(15_000_000).map_err(|e| e.to_string())?;
    writer.delete_term(tantivy::Term::from_field_text(doc_key_f, &format!("map:{}", map_id)));
    writer.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn index_scene(index: &Index, scene: &Scene) -> Result<(), String> {
    let schema = index.schema();
    let doc_key_f = schema.get_field("doc_key").map_err(|e| e.to_string())?;

    let mut writer: IndexWriter = index.writer(15_000_000).map_err(|e| e.to_string())?;
    writer.delete_term(tantivy::Term::from_field_text(doc_key_f, &format!("scene:{}", scene.id)));
    writer
        .add_document(scene_doc(&schema, scene))
        .map_err(|e| e.to_string())?;
    writer.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn remove_scene(index: &Index, scene_id: i32) -> Result<(), String> {
    let schema = index.schema();
    let doc_key_f = schema.get_field("doc_key").map_err(|e| e.to_string())?;

    let mut writer: IndexWriter = index.writer(15_000_000).map_err(|e| e.to_string())?;
    writer.delete_term(tantivy::Term::from_field_text(doc_key_f, &format!("scene:{}", scene_id)));
    writer.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn regex_escape(s: &str) -> String {
    s.chars()
        .flat_map(|c| match c {
            '.' | '*' | '+' | '?' | '^' | '$' | '{'
            | '}' | '|' | '(' | ')' | '[' | ']' | '\\' => vec!['\\', c],
            _ => vec![c],
        })
        .collect()
}

// ── Query builder ─────────────────────────────────────────────────────────────

/// Build a prefix-aware query across both `title` and `body` fields.
///
/// All words except the last require an exact token in title OR body.
/// The last word is a prefix match (regex `last.*`) on title OR body, so
/// "upp" finds notes containing "upper" in either field. Words shorter than
/// 2 chars are skipped (below the tokenizer min-length).
fn build_query(
    title_f: tantivy::schema::Field,
    body_f: tantivy::schema::Field,
    query: &str,
) -> Result<Box<dyn tantivy::query::Query>, String> {
    use tantivy::query::{BooleanQuery, Occur, RegexQuery, TermQuery};
    use tantivy::schema::IndexRecordOption;

    let lower = query.trim().to_lowercase();
    let words: Vec<&str> = lower
        .split_whitespace()
        .filter(|w| w.len() >= 2)
        .collect();

    if words.is_empty() {
        return Err("Query too short".to_string());
    }

    let (last, rest) = words.split_last().unwrap();

    // Last word: prefix match on title OR body
    let title_prefix: Box<dyn tantivy::query::Query> = Box::new(
        RegexQuery::from_pattern(&format!("{}.*", regex_escape(last)), title_f)
            .map_err(|e| e.to_string())?,
    );
    let body_prefix: Box<dyn tantivy::query::Query> = Box::new(
        RegexQuery::from_pattern(&format!("{}.*", regex_escape(last)), body_f)
            .map_err(|e| e.to_string())?,
    );
    let last_clause: Box<dyn tantivy::query::Query> = Box::new(BooleanQuery::new(vec![
        (Occur::Should, title_prefix),
        (Occur::Should, body_prefix),
    ]));

    if rest.is_empty() {
        return Ok(last_clause);
    }

    let mut clauses: Vec<(Occur, Box<dyn tantivy::query::Query>)> = rest
        .iter()
        .map(|&w| {
            let title_term: Box<dyn tantivy::query::Query> = Box::new(TermQuery::new(
                tantivy::Term::from_field_text(title_f, w),
                IndexRecordOption::Basic,
            ));
            let body_term: Box<dyn tantivy::query::Query> = Box::new(TermQuery::new(
                tantivy::Term::from_field_text(body_f, w),
                IndexRecordOption::Basic,
            ));
            let or_clause: Box<dyn tantivy::query::Query> =
                Box::new(BooleanQuery::new(vec![
                    (Occur::Should, title_term),
                    (Occur::Should, body_term),
                ]));
            (Occur::Must, or_clause)
        })
        .collect();
    clauses.push((Occur::Must, last_clause));

    Ok(Box::new(BooleanQuery::new(clauses)))
}

/// Wrap a text query with a kind filter so only docs of the given kind match.
fn build_kind_query(
    kind_f: tantivy::schema::Field,
    title_f: tantivy::schema::Field,
    body_f: tantivy::schema::Field,
    kind: &str,
    query: &str,
) -> Result<Box<dyn tantivy::query::Query>, String> {
    use tantivy::query::{BooleanQuery, Occur, TermQuery};
    use tantivy::schema::IndexRecordOption;

    let text_query = build_query(title_f, body_f, query)?;
    let kind_term: Box<dyn tantivy::query::Query> = Box::new(TermQuery::new(
        tantivy::Term::from_field_text(kind_f, kind),
        IndexRecordOption::Basic,
    ));
    Ok(Box::new(BooleanQuery::new(vec![
        (Occur::Must, kind_term),
        (Occur::Must, text_query),
    ])))
}

// ── Search ────────────────────────────────────────────────────────────────────

/// Search the index for notes matching the query (title and body fields).
///
/// Results include an excerpt centred on the first body match and a count of
/// total body-word occurrences. When the match is title-only, excerpt is None
/// and match_count is 0.
pub fn search_notes_in_index(
    index: &Index,
    vault_path: &Path,
    query: &str,
    limit: usize,
) -> Result<Vec<NoteSearchResult>, String> {
    let reader = index.reader().map_err(|e| e.to_string())?;
    let searcher = reader.searcher();
    let schema = index.schema();

    let kind_f = schema.get_field("kind").map_err(|e| e.to_string())?;
    let title_f = schema.get_field("title").map_err(|e| e.to_string())?;
    let body_f = schema.get_field("body").map_err(|e| e.to_string())?;
    let entity_id_f = schema.get_field("entity_id").map_err(|e| e.to_string())?;
    let path_f = schema.get_field("path").map_err(|e| e.to_string())?;

    let parsed = match build_kind_query(kind_f, title_f, body_f, "note", query) {
        Ok(q) => q,
        Err(_) => return Ok(vec![]),
    };

    let top_docs = searcher
        .search(parsed.as_ref(), &TopDocs::with_limit(limit))
        .map_err(|e| e.to_string())?;

    let mut results = Vec::with_capacity(top_docs.len());
    for (_score, addr) in top_docs {
        let doc: TantivyDocument = searcher.doc(addr).map_err(|e| e.to_string())?;

        let id = match doc.get_first(entity_id_f) {
            Some(OwnedValue::I64(n)) => *n as i32,
            _ => continue,
        };
        let title = match doc.get_first(title_f) {
            Some(OwnedValue::Str(s)) => s.clone(),
            _ => continue,
        };
        let path = match doc.get_first(path_f) {
            Some(OwnedValue::Str(s)) => s.clone(),
            _ => String::new(),
        };

        let (excerpt, match_count) = if !path.is_empty() {
            let body_text = std::fs::read_to_string(vault_path.join(&path))
                .ok()
                .map(|c| extract_plain_text(&c))
                .unwrap_or_default();
            make_excerpt(&body_text, query)
                .map(|(e, c)| (Some(e), c))
                .unwrap_or((None, 0))
        } else {
            (None, 0)
        };

        results.push(NoteSearchResult { id, title, path, excerpt, match_count });
    }

    Ok(results)
}

fn search_maps_in_index(
    index: &Index,
    query: &str,
    limit: usize,
) -> Result<Vec<MapSearchResult>, String> {
    let reader = index.reader().map_err(|e| e.to_string())?;
    let searcher = reader.searcher();
    let schema = index.schema();

    let kind_f = schema.get_field("kind").map_err(|e| e.to_string())?;
    let title_f = schema.get_field("title").map_err(|e| e.to_string())?;
    let body_f = schema.get_field("body").map_err(|e| e.to_string())?;
    let entity_id_f = schema.get_field("entity_id").map_err(|e| e.to_string())?;

    let parsed = match build_kind_query(kind_f, title_f, body_f, "map", query) {
        Ok(q) => q,
        Err(_) => return Ok(vec![]),
    };

    let top_docs = searcher
        .search(parsed.as_ref(), &TopDocs::with_limit(limit))
        .map_err(|e| e.to_string())?;

    let mut results = Vec::with_capacity(top_docs.len());
    for (_score, addr) in top_docs {
        let doc: TantivyDocument = searcher.doc(addr).map_err(|e| e.to_string())?;

        let id = match doc.get_first(entity_id_f) {
            Some(OwnedValue::I64(n)) => *n as i32,
            _ => continue,
        };
        let title = match doc.get_first(title_f) {
            Some(OwnedValue::Str(s)) => s.clone(),
            _ => continue,
        };

        results.push(MapSearchResult { id, title });
    }

    Ok(results)
}

fn search_scenes_in_index(
    index: &Index,
    query: &str,
    limit: usize,
) -> Result<Vec<SceneSearchResult>, String> {
    let reader = index.reader().map_err(|e| e.to_string())?;
    let searcher = reader.searcher();
    let schema = index.schema();

    let kind_f = schema.get_field("kind").map_err(|e| e.to_string())?;
    let title_f = schema.get_field("title").map_err(|e| e.to_string())?;
    let body_f = schema.get_field("body").map_err(|e| e.to_string())?;
    let entity_id_f = schema.get_field("entity_id").map_err(|e| e.to_string())?;

    let parsed = match build_kind_query(kind_f, title_f, body_f, "scene", query) {
        Ok(q) => q,
        Err(_) => return Ok(vec![]),
    };

    let top_docs = searcher
        .search(parsed.as_ref(), &TopDocs::with_limit(limit))
        .map_err(|e| e.to_string())?;

    let mut results = Vec::with_capacity(top_docs.len());
    for (_score, addr) in top_docs {
        let doc: TantivyDocument = searcher.doc(addr).map_err(|e| e.to_string())?;

        let id = match doc.get_first(entity_id_f) {
            Some(OwnedValue::I64(n)) => *n as i32,
            _ => continue,
        };
        let name = match doc.get_first(title_f) {
            Some(OwnedValue::Str(s)) => s.clone(),
            _ => continue,
        };

        results.push(SceneSearchResult { id, name });
    }

    Ok(results)
}

pub fn search_all_in_index(
    index: &Index,
    vault_path: &Path,
    query: &str,
    limit: usize,
) -> Result<SearchAllResult, String> {
    let notes = search_notes_in_index(index, vault_path, query, limit)?;
    let maps = search_maps_in_index(index, query, limit)?;
    let scenes = search_scenes_in_index(index, query, limit)?;
    Ok(SearchAllResult { notes, maps, scenes })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_note(id: i32, title: &str, path: &str) -> Note {
        Note {
            id,
            path: path.to_string(),
            title: title.to_string(),
            icon: None,
            cover_image: None,
            parent_path: None,
            archived: false,
            modified_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    fn make_map(id: i32, title: &str) -> Map {
        Map {
            id,
            title: title.to_string(),
            image_path: None,
            image_width: None,
            image_height: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            modified_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    fn make_scene(id: i32, name: &str) -> Scene {
        Scene {
            id,
            name: name.to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            favorited: 0,
            thumbnail_path: None,
            thumbnail_color: None,
            thumbnail_icon: None,
        }
    }

    // ── extract_plain_text ─────────────────────────────────────────────────

    #[test]
    fn extract_strips_frontmatter() {
        let content = "---\ntags: [npc]\n---\nHello world\n";
        assert_eq!(extract_plain_text(content), "Hello world\n");
    }

    #[test]
    fn extract_strips_image_syntax_including_path() {
        let content = "Some text ![harbor view](harbor.png) more text";
        let result = extract_plain_text(content);
        assert!(!result.contains("harbor.png"), "image path must not appear in plain text");
        assert!(!result.contains("harbor view"), "alt text must not appear");
        assert!(result.contains("Some text"));
        assert!(result.contains("more text"));
    }

    #[test]
    fn extract_strips_image_with_custom_attrs() {
        let content = "Before ![Alt](path/img.png{align=right,width=200}) after";
        let result = extract_plain_text(content);
        assert!(!result.contains("img.png"), "image path including attrs must be stripped");
        assert!(result.contains("Before"));
        assert!(result.contains("after"));
    }

    #[test]
    fn extract_strips_wiki_link_braces_keeps_text() {
        let content = "See [[My Note]] for details";
        let result = extract_plain_text(content);
        assert!(!result.contains("[["));
        assert!(!result.contains("]]"));
        assert!(result.contains("My Note"), "wiki link display text must be kept");
    }

    #[test]
    fn extract_strips_html_tags() {
        let content = "Hello <b>world</b> and <em>there</em>";
        let result = extract_plain_text(content);
        assert!(!result.contains('<'));
        assert!(!result.contains('>'));
        assert!(result.contains("Hello world and there"));
    }

    #[test]
    fn extract_no_frontmatter_passthrough() {
        let content = "Just a plain body.";
        assert_eq!(extract_plain_text(content), "Just a plain body.");
    }

    // ── Image path must not be indexed ────────────────────────────────────

    #[test]
    fn body_search_does_not_match_image_path() {
        let dir = TempDir::new().unwrap();
        let note = make_note(1, "The Bay Area", "bay.md");
        // "harbor" appears only in the image path
        let content = "![Harbor view](harbor.png)\n\nThe bay is calm.";
        std::fs::write(dir.path().join("bay.md"), content).unwrap();

        let index = rebuild_index(dir.path(), &[note], &[], &[]).unwrap();
        let results = search_notes_in_index(&index, dir.path(), "harbor", 10).unwrap();
        assert!(results.is_empty(), "'harbor' in image path must not match");
    }

    // ── Body search ────────────────────────────────────────────────────────

    #[test]
    fn body_search_finds_note_by_body_word() {
        let dir = TempDir::new().unwrap();
        let note = make_note(1, "The Bay Area", "bay.md");
        std::fs::write(dir.path().join("bay.md"), "The harbor is beautiful.").unwrap();

        let index = rebuild_index(dir.path(), &[note], &[], &[]).unwrap();
        let results = search_notes_in_index(&index, dir.path(), "harbor", 10).unwrap();
        assert_eq!(results.len(), 1);
        let r = &results[0];
        assert_eq!(r.id, 1);
        assert!(r.excerpt.is_some());
        assert!(r.excerpt.as_ref().unwrap().contains("harbor"));
        assert_eq!(r.match_count, 1);
    }

    #[test]
    fn body_search_excerpt_centred_on_match() {
        let dir = TempDir::new().unwrap();
        let note = make_note(1, "Log", "log.md");
        // "harbor" in the middle, surrounded by 80+ chars of other words on each side
        let prefix = "word ".repeat(16); // 80 chars
        let suffix = "text ".repeat(16); // 80 chars
        let body = format!("{prefix}harbor {suffix}");
        std::fs::write(dir.path().join("log.md"), &body).unwrap();

        let index = rebuild_index(dir.path(), &[note], &[], &[]).unwrap();
        let results = search_notes_in_index(&index, dir.path(), "harbor", 10).unwrap();
        assert_eq!(results.len(), 1);
        let excerpt = results[0].excerpt.as_ref().unwrap();
        assert!(excerpt.contains("harbor"), "excerpt must contain the match");
        assert!(excerpt.len() <= 130, "excerpt should be ~120 chars");
    }

    #[test]
    fn body_search_match_count_reflects_multiple_occurrences() {
        let dir = TempDir::new().unwrap();
        let note = make_note(1, "Log", "log.md");
        std::fs::write(dir.path().join("log.md"), "harbor one, harbor two, harbor three").unwrap();

        let index = rebuild_index(dir.path(), &[note], &[], &[]).unwrap();
        let results = search_notes_in_index(&index, dir.path(), "harbor", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].match_count, 3);
    }

    #[test]
    fn title_only_match_returns_no_excerpt() {
        let dir = TempDir::new().unwrap();
        let note = make_note(1, "Harbor Tale", "harbor.md");
        // body has no "harbor"
        std::fs::write(dir.path().join("harbor.md"), "The sea was calm.").unwrap();

        let index = rebuild_index(dir.path(), &[note], &[], &[]).unwrap();
        let results = search_notes_in_index(&index, dir.path(), "harbor", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].excerpt.is_none(), "title-only match must have no excerpt");
        assert_eq!(results[0].match_count, 0);
    }

    // ── Notes title tests ──────────────────────────────────────────────────

    #[test]
    fn rebuild_empty_index_returns_no_results() {
        let dir = TempDir::new().unwrap();
        let index = rebuild_index(dir.path(), &[], &[], &[]).unwrap();
        let results = search_notes_in_index(&index, dir.path(), "anything", 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn search_finds_note_by_exact_title_word() {
        let dir = TempDir::new().unwrap();
        let notes = [make_note(1, "Aldric the Wizard", "npcs/aldric.md")];
        let index = rebuild_index(dir.path(), &notes, &[], &[]).unwrap();

        let results = search_notes_in_index(&index, dir.path(), "Aldric", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, 1);
        assert_eq!(results[0].title, "Aldric the Wizard");
        assert_eq!(results[0].path, "npcs/aldric.md");
    }

    #[test]
    fn search_finds_note_by_partial_word_prefix() {
        let dir = TempDir::new().unwrap();
        let notes = [make_note(1, "The Upper Citadel", "places/citadel.md")];
        let index = rebuild_index(dir.path(), &notes, &[], &[]).unwrap();

        let results = search_notes_in_index(&index, dir.path(), "upp", 10).unwrap();
        assert_eq!(results.len(), 1, "prefix 'upp' should match 'upper'");
        assert_eq!(results[0].title, "The Upper Citadel");

        let results2 = search_notes_in_index(&index, dir.path(), "The Upper Cit", 10).unwrap();
        assert_eq!(results2.len(), 1, "partial last word should match");
    }

    #[test]
    fn search_returns_empty_for_no_match() {
        let dir = TempDir::new().unwrap();
        let notes = [make_note(1, "Aldric the Wizard", "npcs/aldric.md")];
        let index = rebuild_index(dir.path(), &notes, &[], &[]).unwrap();

        let results = search_notes_in_index(&index, dir.path(), "nonexistent", 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn incremental_index_adds_new_note() {
        let dir = TempDir::new().unwrap();
        let index = rebuild_index(dir.path(), &[], &[], &[]).unwrap();

        let note = make_note(1, "Captain Ash", "characters/ash.md");
        index_note(&index, &note, "").unwrap();

        let results = search_notes_in_index(&index, dir.path(), "Captain", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Captain Ash");
    }

    #[test]
    fn incremental_remove_deletes_note() {
        let dir = TempDir::new().unwrap();
        let notes = [make_note(1, "Captain Ash", "characters/ash.md")];
        let index = rebuild_index(dir.path(), &notes, &[], &[]).unwrap();

        let before = search_notes_in_index(&index, dir.path(), "Captain", 10).unwrap();
        assert_eq!(before.len(), 1);

        remove_note(&index, 1).unwrap();

        let after = search_notes_in_index(&index, dir.path(), "Captain", 10).unwrap();
        assert!(after.is_empty());
    }

    #[test]
    fn rebuild_replaces_all_previous_documents() {
        let dir = TempDir::new().unwrap();
        let first = [make_note(1, "Old Note", "old.md")];
        rebuild_index(dir.path(), &first, &[], &[]).unwrap();

        let second = [make_note(2, "New Note", "new.md")];
        let index = rebuild_index(dir.path(), &second, &[], &[]).unwrap();

        let old = search_notes_in_index(&index, dir.path(), "Old", 10).unwrap();
        assert!(old.is_empty(), "stale document should be gone after rebuild");

        let new = search_notes_in_index(&index, dir.path(), "New", 10).unwrap();
        assert_eq!(new.len(), 1);
    }

    #[test]
    fn incremental_upsert_updates_existing_note() {
        let dir = TempDir::new().unwrap();
        let note_v1 = make_note(1, "Dragon Lair", "dragon.md");
        let index = rebuild_index(dir.path(), &[note_v1], &[], &[]).unwrap();

        let note_v2 = make_note(1, "Dragon Cave", "dragon.md");
        index_note(&index, &note_v2, "").unwrap();

        let lair = search_notes_in_index(&index, dir.path(), "Lair", 10).unwrap();
        assert!(lair.is_empty(), "old title should no longer match");

        let cave = search_notes_in_index(&index, dir.path(), "Cave", 10).unwrap();
        assert_eq!(cave.len(), 1);
        assert_eq!(cave[0].title, "Dragon Cave");
    }

    // ── Map indexing ───────────────────────────────────────────────────────

    #[test]
    fn map_is_indexed_and_searchable() {
        let dir = TempDir::new().unwrap();
        let map = make_map(1, "World Map");
        let index = rebuild_index(dir.path(), &[], &[map], &[]).unwrap();

        let result = search_all_in_index(&index, dir.path(), "World", 10).unwrap();
        assert_eq!(result.maps.len(), 1);
        assert_eq!(result.maps[0].id, 1);
        assert_eq!(result.maps[0].title, "World Map");
        assert!(result.notes.is_empty());
        assert!(result.scenes.is_empty());
    }

    #[test]
    fn map_prefix_search_works() {
        let dir = TempDir::new().unwrap();
        let map = make_map(2, "Dungeon Level Two");
        let index = rebuild_index(dir.path(), &[], &[map], &[]).unwrap();

        let result = search_all_in_index(&index, dir.path(), "Dung", 10).unwrap();
        assert_eq!(result.maps.len(), 1);
        assert_eq!(result.maps[0].title, "Dungeon Level Two");
    }

    #[test]
    fn incremental_index_map_upsert() {
        let dir = TempDir::new().unwrap();
        let index = rebuild_index(dir.path(), &[], &[], &[]).unwrap();

        let map = make_map(1, "Overworld");
        index_map(&index, &map).unwrap();

        let result = search_all_in_index(&index, dir.path(), "Overworld", 10).unwrap();
        assert_eq!(result.maps.len(), 1);
        assert_eq!(result.maps[0].title, "Overworld");

        // Rename the map
        let renamed = make_map(1, "Underworld");
        index_map(&index, &renamed).unwrap();

        let old = search_all_in_index(&index, dir.path(), "Overworld", 10).unwrap();
        assert!(old.maps.is_empty(), "old title should no longer match");

        let new = search_all_in_index(&index, dir.path(), "Underworld", 10).unwrap();
        assert_eq!(new.maps.len(), 1);
    }

    #[test]
    fn incremental_remove_map() {
        let dir = TempDir::new().unwrap();
        let map = make_map(1, "The Keep");
        let index = rebuild_index(dir.path(), &[], &[map], &[]).unwrap();

        remove_map(&index, 1).unwrap();

        let result = search_all_in_index(&index, dir.path(), "Keep", 10).unwrap();
        assert!(result.maps.is_empty());
    }

    // ── Scene indexing ─────────────────────────────────────────────────────

    #[test]
    fn scene_is_indexed_and_searchable() {
        let dir = TempDir::new().unwrap();
        let scene = make_scene(1, "Tavern Brawl");
        let index = rebuild_index(dir.path(), &[], &[], &[scene]).unwrap();

        let result = search_all_in_index(&index, dir.path(), "Tavern", 10).unwrap();
        assert_eq!(result.scenes.len(), 1);
        assert_eq!(result.scenes[0].id, 1);
        assert_eq!(result.scenes[0].name, "Tavern Brawl");
        assert!(result.notes.is_empty());
        assert!(result.maps.is_empty());
    }

    #[test]
    fn scene_prefix_search_works() {
        let dir = TempDir::new().unwrap();
        let scene = make_scene(3, "Throne Room Ambush");
        let index = rebuild_index(dir.path(), &[], &[], &[scene]).unwrap();

        let result = search_all_in_index(&index, dir.path(), "Thr", 10).unwrap();
        assert_eq!(result.scenes.len(), 1);
        assert_eq!(result.scenes[0].name, "Throne Room Ambush");
    }

    #[test]
    fn incremental_index_scene_upsert() {
        let dir = TempDir::new().unwrap();
        let index = rebuild_index(dir.path(), &[], &[], &[]).unwrap();

        let scene = make_scene(1, "Forest Encounter");
        index_scene(&index, &scene).unwrap();

        let result = search_all_in_index(&index, dir.path(), "Forest", 10).unwrap();
        assert_eq!(result.scenes.len(), 1);

        // Rename the scene
        let renamed = make_scene(1, "Cave Encounter");
        index_scene(&index, &renamed).unwrap();

        let old = search_all_in_index(&index, dir.path(), "Forest", 10).unwrap();
        assert!(old.scenes.is_empty(), "old name should no longer match");

        let new = search_all_in_index(&index, dir.path(), "Cave", 10).unwrap();
        assert_eq!(new.scenes.len(), 1);
    }

    #[test]
    fn incremental_remove_scene() {
        let dir = TempDir::new().unwrap();
        let scene = make_scene(1, "Dragon Fight");
        let index = rebuild_index(dir.path(), &[], &[], &[scene]).unwrap();

        remove_scene(&index, 1).unwrap();

        let result = search_all_in_index(&index, dir.path(), "Dragon", 10).unwrap();
        assert!(result.scenes.is_empty());
    }

    // ── Kind isolation ─────────────────────────────────────────────────────

    #[test]
    fn note_search_does_not_return_maps_or_scenes() {
        let dir = TempDir::new().unwrap();
        let note = make_note(1, "Dragon Note", "dragon.md");
        let map = make_map(1, "Dragon Map");
        let scene = make_scene(1, "Dragon Scene");
        let index = rebuild_index(dir.path(), &[note], &[map], &[scene]).unwrap();

        let notes = search_notes_in_index(&index, dir.path(), "Dragon", 10).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].title, "Dragon Note");
    }

    #[test]
    fn all_three_kinds_returned_by_search_all() {
        let dir = TempDir::new().unwrap();
        let note = make_note(1, "Crimson Keep", "crimson.md");
        let map = make_map(1, "Crimson Map");
        let scene = make_scene(1, "Crimson Scene");
        let index = rebuild_index(dir.path(), &[note], &[map], &[scene]).unwrap();

        let result = search_all_in_index(&index, dir.path(), "Crimson", 10).unwrap();
        assert_eq!(result.notes.len(), 1);
        assert_eq!(result.maps.len(), 1);
        assert_eq!(result.scenes.len(), 1);
    }

    #[test]
    fn id_collision_between_kinds_is_safe() {
        let dir = TempDir::new().unwrap();
        // note id=1, map id=1, scene id=1 — all same numeric id, different kinds
        let note = make_note(1, "Note One", "note1.md");
        let map = make_map(1, "Map One");
        let scene = make_scene(1, "Scene One");
        let index = rebuild_index(dir.path(), &[note], &[map], &[scene]).unwrap();

        // Deleting the map must not affect the note or scene
        remove_map(&index, 1).unwrap();

        let result = search_all_in_index(&index, dir.path(), "One", 10).unwrap();
        assert_eq!(result.notes.len(), 1, "note must survive map deletion");
        assert!(result.maps.is_empty(), "map must be deleted");
        assert_eq!(result.scenes.len(), 1, "scene must survive map deletion");
    }

    #[test]
    fn rebuild_index_includes_maps_and_scenes() {
        let dir = TempDir::new().unwrap();
        let notes = [make_note(1, "Note Alpha", "alpha.md")];
        let maps = [make_map(2, "Map Beta")];
        let scenes = [make_scene(3, "Scene Gamma")];
        let index = rebuild_index(dir.path(), &notes, &maps, &scenes).unwrap();

        let r_note = search_all_in_index(&index, dir.path(), "Alpha", 10).unwrap();
        assert_eq!(r_note.notes.len(), 1);

        let r_map = search_all_in_index(&index, dir.path(), "Beta", 10).unwrap();
        assert_eq!(r_map.maps.len(), 1);

        let r_scene = search_all_in_index(&index, dir.path(), "Gamma", 10).unwrap();
        assert_eq!(r_scene.scenes.len(), 1);
    }
}
