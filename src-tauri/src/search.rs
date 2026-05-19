use crate::commands::frontmatter;
use crate::db::models::{Map, Note, Scene};
use serde::Serialize;
use std::path::Path;
use tantivy::{
    collector::TopDocs,
    directory::MmapDirectory,
    schema::{DateOptions, NumericOptions, OwnedValue, Schema, STORED, STRING, TEXT},
    tokenizer::{AsciiFoldingFilter, LowerCaser, RemoveLongFilter, SimpleTokenizer, TextAnalyzer},
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
pub struct TagFacet {
    pub name: String,
    pub note_count: usize,
}

#[derive(Debug, Serialize, Clone)]
pub struct SearchAllResult {
    pub notes: Vec<NoteSearchResult>,
    pub maps: Vec<MapSearchResult>,
    pub scenes: Vec<SceneSearchResult>,
    pub tags: Vec<TagFacet>,
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
    builder.add_text_field("tags", TEXT); // multi-value; indexed but not stored; lowercased at index time
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

fn note_doc(schema: &Schema, note: &Note, body_text: &str, tags: &[String]) -> TantivyDocument {
    let kind_f = schema.get_field("kind").unwrap();
    let doc_key_f = schema.get_field("doc_key").unwrap();
    let entity_id_f = schema.get_field("entity_id").unwrap();
    let path_f = schema.get_field("path").unwrap();
    let title_f = schema.get_field("title").unwrap();
    let body_f = schema.get_field("body").unwrap();
    let tags_f = schema.get_field("tags").unwrap();
    let modified_at_f = schema.get_field("modified_at").unwrap();

    let ts = parse_modified_at(&note.modified_at);
    let tantivy_dt = TantivyDateTime::from_timestamp_micros(ts);

    let mut doc = TantivyDocument::default();
    doc.add_text(kind_f, "note");
    doc.add_text(doc_key_f, &format!("note:{}", note.id));
    doc.add_i64(entity_id_f, note.id as i64);
    doc.add_text(path_f, &note.path);
    doc.add_text(title_f, &note.title);
    doc.add_text(body_f, body_text);
    for tag in tags {
        doc.add_text(tags_f, &tag.to_lowercase());
    }
    doc.add_date(modified_at_f, tantivy_dt);
    doc
}

fn map_doc(schema: &Schema, map: &Map) -> TantivyDocument {
    let kind_f = schema.get_field("kind").unwrap();
    let doc_key_f = schema.get_field("doc_key").unwrap();
    let entity_id_f = schema.get_field("entity_id").unwrap();
    let path_f = schema.get_field("path").unwrap();
    let title_f = schema.get_field("title").unwrap();
    let modified_at_f = schema.get_field("modified_at").unwrap();

    let ts = parse_modified_at(&map.modified_at);
    let tantivy_dt = TantivyDateTime::from_timestamp_micros(ts);

    let mut doc = TantivyDocument::default();
    doc.add_text(kind_f, "map");
    doc.add_text(doc_key_f, &format!("map:{}", map.id));
    doc.add_i64(entity_id_f, map.id as i64);
    doc.add_text(path_f, "");
    doc.add_text(title_f, &map.title);
    doc.add_date(modified_at_f, tantivy_dt);
    doc
}

fn scene_doc(schema: &Schema, scene: &Scene) -> TantivyDocument {
    let kind_f = schema.get_field("kind").unwrap();
    let doc_key_f = schema.get_field("doc_key").unwrap();
    let entity_id_f = schema.get_field("entity_id").unwrap();
    let path_f = schema.get_field("path").unwrap();
    let title_f = schema.get_field("title").unwrap();
    let modified_at_f = schema.get_field("modified_at").unwrap();

    let ts = parse_modified_at(&scene.created_at);
    let tantivy_dt = TantivyDateTime::from_timestamp_micros(ts);

    let mut doc = TantivyDocument::default();
    doc.add_text(kind_f, "scene");
    doc.add_text(doc_key_f, &format!("scene:{}", scene.id));
    doc.add_i64(entity_id_f, scene.id as i64);
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
    register_tokenizer(&index);

    let mut writer: IndexWriter = index.writer(50_000_000).map_err(|e| e.to_string())?;
    for note in notes {
        let content = std::fs::read_to_string(vault_path.join(&note.path))
            .ok()
            .unwrap_or_default();
        let body_text = extract_plain_text(&content);
        let tags = frontmatter::read_tags(&content);
        writer
            .add_document(note_doc(&schema, note, &body_text, &tags))
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

fn upsert_doc(index: &Index, doc_key: &str, doc: TantivyDocument) -> Result<(), String> {
    let schema = index.schema();
    let doc_key_f = schema.get_field("doc_key").map_err(|e| e.to_string())?;
    let mut writer: IndexWriter = index.writer(15_000_000).map_err(|e| e.to_string())?;
    writer.delete_term(tantivy::Term::from_field_text(doc_key_f, doc_key));
    writer.add_document(doc).map_err(|e| e.to_string())?;
    writer.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn remove_doc(index: &Index, doc_key: &str) -> Result<(), String> {
    let schema = index.schema();
    let doc_key_f = schema.get_field("doc_key").map_err(|e| e.to_string())?;
    let mut writer: IndexWriter = index.writer(15_000_000).map_err(|e| e.to_string())?;
    writer.delete_term(tantivy::Term::from_field_text(doc_key_f, doc_key));
    writer.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn index_note(index: &Index, note: &Note, body_text: &str, tags: &[String]) -> Result<(), String> {
    let schema = index.schema();
    upsert_doc(index, &format!("note:{}", note.id), note_doc(&schema, note, body_text, tags))
}

pub fn remove_note(index: &Index, entity_id: i32) -> Result<(), String> {
    remove_doc(index, &format!("note:{}", entity_id))
}

pub fn index_map(index: &Index, map: &Map) -> Result<(), String> {
    let schema = index.schema();
    upsert_doc(index, &format!("map:{}", map.id), map_doc(&schema, map))
}

pub fn remove_map(index: &Index, map_id: i32) -> Result<(), String> {
    remove_doc(index, &format!("map:{}", map_id))
}

pub fn index_scene(index: &Index, scene: &Scene) -> Result<(), String> {
    let schema = index.schema();
    upsert_doc(index, &format!("scene:{}", scene.id), scene_doc(&schema, scene))
}

pub fn remove_scene(index: &Index, scene_id: i32) -> Result<(), String> {
    remove_doc(index, &format!("scene:{}", scene_id))
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

// ── Tag filter helpers ────────────────────────────────────────────────────────

/// Extracts `tag:foo` tokens from a query string, returning lowercase tag names.
pub fn parse_tag_filters(query: &str) -> Vec<String> {
    query
        .split_whitespace()
        .filter_map(|token| token.strip_prefix("tag:"))
        .filter(|t| !t.is_empty())
        .map(|t| t.to_lowercase())
        .collect()
}

/// Removes `tag:foo` tokens from a query string, returning remaining free text.
pub fn strip_tag_tokens(query: &str) -> String {
    query
        .split_whitespace()
        .filter(|token| !token.starts_with("tag:"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_tag_filter_query(
    tags_f: tantivy::schema::Field,
    tag_filters: &[String],
) -> Box<dyn tantivy::query::Query> {
    use tantivy::query::{BooleanQuery, Occur, TermQuery};
    use tantivy::schema::IndexRecordOption;

    let clauses: Vec<(Occur, Box<dyn tantivy::query::Query>)> = tag_filters
        .iter()
        .map(|t| {
            let q: Box<dyn tantivy::query::Query> = Box::new(TermQuery::new(
                tantivy::Term::from_field_text(tags_f, t.as_str()),
                IndexRecordOption::Basic,
            ));
            (Occur::Should, q)
        })
        .collect();
    Box::new(BooleanQuery::new(clauses))
}

fn build_note_tag_query(
    kind_f: tantivy::schema::Field,
    tags_f: tantivy::schema::Field,
    tag_filters: &[String],
) -> Box<dyn tantivy::query::Query> {
    use tantivy::query::{BooleanQuery, Occur, TermQuery};
    use tantivy::schema::IndexRecordOption;

    let kind_term: Box<dyn tantivy::query::Query> = Box::new(TermQuery::new(
        tantivy::Term::from_field_text(kind_f, "note"),
        IndexRecordOption::Basic,
    ));
    let tag_q = build_tag_filter_query(tags_f, tag_filters);
    Box::new(BooleanQuery::new(vec![
        (Occur::Must, kind_term),
        (Occur::Must, tag_q),
    ]))
}

// ── Tokenizer ─────────────────────────────────────────────────────────────────

fn make_word_analyzer() -> TextAnalyzer {
    TextAnalyzer::builder(SimpleTokenizer::default())
        .filter(LowerCaser)
        .filter(AsciiFoldingFilter)
        .filter(RemoveLongFilter::limit(40))
        .build()
}

fn register_tokenizer(index: &Index) {
    index.tokenizers().register("default", make_word_analyzer());
}

// ── Fuzzy distance ────────────────────────────────────────────────────────────

/// Levenshtein distance tier based on term byte-length:
/// < 4  → 0 (exact; prefix wildcard still applied for the last query word)
/// 4–7  → 1
/// ≥ 8  → 2
pub fn fuzzy_distance(len: usize) -> u8 {
    if len < 4 { 0 } else if len <= 7 { 1 } else { 2 }
}

// ── Query builder ─────────────────────────────────────────────────────────────

/// Per-field component of a term clause.
///
/// - dist 0 + last word → RegexQuery prefix (type-ahead)
/// - dist 0 + non-last  → TermQuery exact
/// - dist > 0 + last    → FuzzyTermQuery::new_prefix (prefix + fuzzy combined)
/// - dist > 0 + non-last → FuzzyTermQuery::new
fn field_word_query(
    field: tantivy::schema::Field,
    word: &str,
    is_last: bool,
) -> Result<Box<dyn tantivy::query::Query>, String> {
    use tantivy::query::{FuzzyTermQuery, RegexQuery, TermQuery};
    use tantivy::schema::IndexRecordOption;

    let dist = fuzzy_distance(word.len());
    if dist == 0 && is_last {
        Ok(Box::new(
            RegexQuery::from_pattern(&format!("{}.*", regex_escape(word)), field)
                .map_err(|e| e.to_string())?,
        ))
    } else if dist == 0 {
        Ok(Box::new(TermQuery::new(
            tantivy::Term::from_field_text(field, word),
            IndexRecordOption::Basic,
        )))
    } else if is_last {
        Ok(Box::new(FuzzyTermQuery::new_prefix(
            tantivy::Term::from_field_text(field, word),
            dist,
            true,
        )))
    } else {
        Ok(Box::new(FuzzyTermQuery::new(
            tantivy::Term::from_field_text(field, word),
            dist,
            true,
        )))
    }
}

/// OR(title × 2.0, body) clause for a single normalised word.
///
/// The 2× boost on the title field preserves the ADR intent that title matches
/// outrank body matches regardless of BM25 field-length differences.
fn make_word_clause(
    title_f: tantivy::schema::Field,
    body_f: tantivy::schema::Field,
    word: &str,
    is_last: bool,
) -> Result<Box<dyn tantivy::query::Query>, String> {
    use tantivy::query::{BooleanQuery, BoostQuery, Occur};
    let title_q: Box<dyn tantivy::query::Query> =
        Box::new(BoostQuery::new(field_word_query(title_f, word, is_last)?, 2.0));
    Ok(Box::new(BooleanQuery::new(vec![
        (Occur::Should, title_q),
        (Occur::Should, field_word_query(body_f, word, is_last)?),
    ])))
}

/// Build a prefix-aware, fuzzy query across both `title` and `body` fields.
///
/// Each whitespace-separated word is normalised through the same
/// lowercase + ASCII-fold + remove-long pipeline as the index tokenizer.
/// Levenshtein distance is tiered by word length (0 / 1 / 2 for < 4 / 4–7 / ≥ 8).
/// The last word also receives a prefix match for live type-ahead.
fn build_query(
    title_f: tantivy::schema::Field,
    body_f: tantivy::schema::Field,
    query: &str,
) -> Result<Box<dyn tantivy::query::Query>, String> {
    use tantivy::query::{BooleanQuery, Occur};

    let lower = query.trim().to_lowercase();
    let raw: Vec<&str> = lower.split_whitespace().filter(|w| w.len() >= 2).collect();

    // Normalise through the same pipeline as the index tokenizer so that
    // ASCII-folded query terms match ASCII-folded index terms (e.g. naïve → naive).
    let mut analyzer = make_word_analyzer();
    let mut words: Vec<String> = Vec::new();
    for w in raw {
        let mut stream = analyzer.token_stream(w);
        while stream.advance() {
            let tok = stream.token().text.clone();
            if tok.len() >= 2 {
                words.push(tok);
            }
        }
    }

    if words.is_empty() {
        return Err("Query too short".to_string());
    }

    let wv: Vec<&str> = words.iter().map(String::as_str).collect();
    let (last, rest) = wv.split_last().unwrap();

    let last_clause = make_word_clause(title_f, body_f, last, true)?;
    if rest.is_empty() {
        return Ok(last_clause);
    }

    let mut clauses: Vec<(Occur, Box<dyn tantivy::query::Query>)> = Vec::new();
    for &w in rest {
        clauses.push((Occur::Must, make_word_clause(title_f, body_f, w, false)?));
    }
    clauses.push((Occur::Must, last_clause));
    Ok(Box::new(BooleanQuery::new(clauses)))
}

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

/// Excerpt is centred on the first body match; match_count counts body occurrences only.
/// Title-only matches return `excerpt: None` and `match_count: 0`.
/// Supports `tag:foo` filter syntax: tag-only queries return results MRU-ordered by modified_at;
/// text+tag queries use BM25 ranking filtered by the tag constraint.
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
    let tags_f = schema.get_field("tags").map_err(|e| e.to_string())?;
    let modified_at_f = schema.get_field("modified_at").map_err(|e| e.to_string())?;

    let tag_filters = parse_tag_filters(query);
    let free_text = strip_tag_tokens(query);
    let has_free_text = free_text.split_whitespace().any(|w| w.len() >= 2);

    let search_query: Box<dyn tantivy::query::Query> = if tag_filters.is_empty() {
        // Pure text search — existing BM25 behaviour
        match build_kind_query(kind_f, title_f, body_f, "note", query) {
            Ok(q) => q,
            Err(_) => return Ok(vec![]),
        }
    } else if !has_free_text {
        // Tag-only: return all notes matching any tag filter, ordered MRU
        build_note_tag_query(kind_f, tags_f, &tag_filters)
    } else {
        // Text + tag: BM25 ranking, filtered to notes that carry any of the tags
        use tantivy::query::{BooleanQuery, Occur};
        let text_q = match build_kind_query(kind_f, title_f, body_f, "note", &free_text) {
            Ok(q) => q,
            Err(_) => return Ok(vec![]),
        };
        let tag_q = build_tag_filter_query(tags_f, &tag_filters);
        Box::new(BooleanQuery::new(vec![
            (Occur::Must, text_q),
            (Occur::Must, tag_q),
        ]))
    };

    // For tag-only queries, fetch more than the limit so MRU sort can trim correctly
    let fetch_limit = if !tag_filters.is_empty() && !has_free_text {
        limit * 2 + 10
    } else {
        limit
    };

    let top_docs = searcher
        .search(search_query.as_ref(), &TopDocs::with_limit(fetch_limit))
        .map_err(|e| e.to_string())?;

    // Excerpt uses the free-text portion of the query (no tag: tokens)
    let excerpt_q = if tag_filters.is_empty() { query } else { free_text.as_str() };

    let mut with_ts: Vec<(i64, NoteSearchResult)> = Vec::with_capacity(top_docs.len());
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
        let ts = match doc.get_first(modified_at_f) {
            Some(OwnedValue::Date(dt)) => dt.into_timestamp_micros(),
            _ => 0,
        };

        let (excerpt, match_count) = if !path.is_empty() && !excerpt_q.trim().is_empty() {
            let body_text = std::fs::read_to_string(vault_path.join(&path))
                .ok()
                .map(|c| extract_plain_text(&c))
                .unwrap_or_default();
            make_excerpt(&body_text, excerpt_q)
                .map(|(e, c)| (Some(e), c))
                .unwrap_or((None, 0))
        } else {
            (None, 0)
        };

        with_ts.push((ts, NoteSearchResult { id, title, path, excerpt, match_count }));
    }

    // For tag-only queries, sort by modified_at descending (most-recently-updated first)
    if !tag_filters.is_empty() && !has_free_text {
        with_ts.sort_by(|a, b| b.0.cmp(&a.0));
    }

    Ok(with_ts.into_iter().take(limit).map(|(_, r)| r).collect())
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
    // Maps and scenes are not filtered by tag: tokens; strip them before querying
    let free_text = strip_tag_tokens(query);
    let has_free_text = free_text.split_whitespace().any(|w| w.len() >= 2);
    let maps = if has_free_text { search_maps_in_index(index, &free_text, limit)? } else { vec![] };
    let scenes = if has_free_text { search_scenes_in_index(index, &free_text, limit)? } else { vec![] };
    Ok(SearchAllResult { notes, maps, scenes, tags: vec![] })
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
        index_note(&index, &note, "", &[]).unwrap();

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
        index_note(&index, &note_v2, "", &[]).unwrap();

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

    // ── parse_tag_filters / strip_tag_tokens ───────────────────────────────

    #[test]
    fn parse_tag_filters_extracts_tag_tokens() {
        let filters = parse_tag_filters("dragon tag:npc tag:allied");
        assert_eq!(filters, vec!["npc", "allied"]);
    }

    #[test]
    fn parse_tag_filters_lowercases() {
        let filters = parse_tag_filters("tag:NPC");
        assert_eq!(filters, vec!["npc"]);
    }

    #[test]
    fn parse_tag_filters_empty_for_no_tags() {
        assert!(parse_tag_filters("dragon wizard").is_empty());
    }

    #[test]
    fn parse_tag_filters_skips_empty_tag_colon() {
        assert!(parse_tag_filters("tag:").is_empty());
    }

    #[test]
    fn strip_tag_tokens_removes_tag_prefix() {
        assert_eq!(strip_tag_tokens("dragon tag:npc tag:allied"), "dragon");
    }

    #[test]
    fn strip_tag_tokens_empty_when_only_tags() {
        assert_eq!(strip_tag_tokens("tag:npc tag:allied").trim(), "");
    }

    #[test]
    fn strip_tag_tokens_passthrough_no_tags() {
        assert_eq!(strip_tag_tokens("dragon wizard"), "dragon wizard");
    }

    // ── Tags indexing and filtering ────────────────────────────────────────

    #[test]
    fn tags_are_indexed_from_frontmatter_in_rebuild() {
        let dir = TempDir::new().unwrap();
        let note = make_note(1, "Aldric the Wizard", "aldric.md");
        std::fs::write(dir.path().join("aldric.md"), "---\ntags: [npc, wizard]\n---\nBody").unwrap();

        let index = rebuild_index(dir.path(), &[note], &[], &[]).unwrap();
        let results = search_notes_in_index(&index, dir.path(), "tag:npc", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Aldric the Wizard");
    }

    #[test]
    fn tag_filter_excludes_notes_without_tag() {
        let dir = TempDir::new().unwrap();
        let note1 = make_note(1, "Aldric", "aldric.md");
        let note2 = make_note(2, "Dragon", "dragon.md");
        std::fs::write(dir.path().join("aldric.md"), "---\ntags: [npc]\n---\nBody").unwrap();
        std::fs::write(dir.path().join("dragon.md"), "---\ntags: [creature]\n---\nBody").unwrap();

        let index = rebuild_index(dir.path(), &[note1, note2], &[], &[]).unwrap();
        let results = search_notes_in_index(&index, dir.path(), "tag:npc", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, 1);
    }

    #[test]
    fn tag_filter_or_composition() {
        let dir = TempDir::new().unwrap();
        let note1 = make_note(1, "Aldric", "aldric.md");
        let note2 = make_note(2, "Allied Knight", "knight.md");
        let note3 = make_note(3, "Dragon", "dragon.md");
        std::fs::write(dir.path().join("aldric.md"), "---\ntags: [npc]\n---\nBody").unwrap();
        std::fs::write(dir.path().join("knight.md"), "---\ntags: [allied]\n---\nBody").unwrap();
        std::fs::write(dir.path().join("dragon.md"), "---\ntags: [creature]\n---\nBody").unwrap();

        let index = rebuild_index(dir.path(), &[note1, note2, note3], &[], &[]).unwrap();
        let results = search_notes_in_index(&index, dir.path(), "tag:npc tag:allied", 10).unwrap();
        assert_eq!(results.len(), 2, "should return notes with npc OR allied tag");
        let ids: Vec<i32> = results.iter().map(|r| r.id).collect();
        assert!(ids.contains(&1), "npc note must be in results");
        assert!(ids.contains(&2), "allied note must be in results");
    }

    #[test]
    fn tag_filter_with_freetext_filters_by_both() {
        let dir = TempDir::new().unwrap();
        let note1 = make_note(1, "Dragon Wizard", "wizard.md");
        let note2 = make_note(2, "Dragon Fighter", "fighter.md");
        std::fs::write(dir.path().join("wizard.md"), "---\ntags: [npc]\n---\nBody").unwrap();
        std::fs::write(dir.path().join("fighter.md"), "---\ntags: [villain]\n---\nBody").unwrap();

        let index = rebuild_index(dir.path(), &[note1, note2], &[], &[]).unwrap();
        let results = search_notes_in_index(&index, dir.path(), "Dragon tag:npc", 10).unwrap();
        assert_eq!(results.len(), 1, "only notes matching Dragon AND tagged npc");
        assert_eq!(results[0].id, 1);
    }

    #[test]
    fn tag_only_query_returns_mru_order() {
        let dir = TempDir::new().unwrap();
        let note_old = Note {
            id: 1,
            path: "old.md".to_string(),
            title: "Old Note".to_string(),
            icon: None,
            cover_image: None,
            parent_path: None,
            archived: false,
            modified_at: "2026-01-01T00:00:00Z".to_string(),
        };
        let note_new = Note {
            id: 2,
            path: "new.md".to_string(),
            title: "New Note".to_string(),
            icon: None,
            cover_image: None,
            parent_path: None,
            archived: false,
            modified_at: "2026-06-01T00:00:00Z".to_string(),
        };
        std::fs::write(dir.path().join("old.md"), "---\ntags: [npc]\n---\nBody").unwrap();
        std::fs::write(dir.path().join("new.md"), "---\ntags: [npc]\n---\nBody").unwrap();

        let index = rebuild_index(dir.path(), &[note_old, note_new], &[], &[]).unwrap();
        let results = search_notes_in_index(&index, dir.path(), "tag:npc", 10).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].id, 2, "newer note must be first (MRU)");
        assert_eq!(results[1].id, 1, "older note must be second");
    }

    #[test]
    fn incremental_index_note_with_tags() {
        let dir = TempDir::new().unwrap();
        let index = rebuild_index(dir.path(), &[], &[], &[]).unwrap();

        let note = make_note(1, "Aldric", "aldric.md");
        index_note(&index, &note, "", &["npc".to_string()]).unwrap();

        let results = search_notes_in_index(&index, dir.path(), "tag:npc", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Aldric");
    }

    #[test]
    fn incremental_upsert_updates_tags() {
        let dir = TempDir::new().unwrap();
        let note = make_note(1, "Aldric", "aldric.md");
        let index = rebuild_index(dir.path(), &[note.clone()], &[], &[]).unwrap();

        // Update with new tags
        index_note(&index, &note, "", &["villain".to_string()]).unwrap();

        // npc tag no longer present
        let npc_results = search_notes_in_index(&index, dir.path(), "tag:npc", 10).unwrap();
        assert!(npc_results.is_empty(), "old tag must not match after update");

        // villain tag now present
        let villain_results = search_notes_in_index(&index, dir.path(), "tag:villain", 10).unwrap();
        assert_eq!(villain_results.len(), 1);
    }

    #[test]
    fn tag_filter_case_insensitive_match() {
        let dir = TempDir::new().unwrap();
        let note = make_note(1, "Aldric", "aldric.md");
        std::fs::write(dir.path().join("aldric.md"), "---\ntags: [NPC]\n---\nBody").unwrap();

        let index = rebuild_index(dir.path(), &[note], &[], &[]).unwrap();
        // Query with lowercase; tags stored uppercase in frontmatter but lowercased in index
        let results = search_notes_in_index(&index, dir.path(), "tag:npc", 10).unwrap();
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn multi_tag_with_freetext_or_composition() {
        let dir = TempDir::new().unwrap();
        let note1 = make_note(1, "Dragon Wizard", "wizard.md");
        let note2 = make_note(2, "Dragon Fighter", "fighter.md");
        let note3 = make_note(3, "Unrelated Note", "other.md");
        std::fs::write(dir.path().join("wizard.md"), "---\ntags: [npc]\n---\nThe harbor shines.").unwrap();
        std::fs::write(dir.path().join("fighter.md"), "---\ntags: [allied]\n---\nThe harbor glows.").unwrap();
        std::fs::write(dir.path().join("other.md"), "---\ntags: [creature]\n---\nThe harbor is calm.").unwrap();

        let index = rebuild_index(dir.path(), &[note1, note2, note3], &[], &[]).unwrap();
        let results = search_notes_in_index(&index, dir.path(), "tag:npc tag:allied harbor", 10).unwrap();
        assert_eq!(results.len(), 2, "notes with (npc OR allied) AND harbor in body");
        let ids: Vec<i32> = results.iter().map(|r| r.id).collect();
        assert!(ids.contains(&1), "npc+harbor note must be in results");
        assert!(ids.contains(&2), "allied+harbor note must be in results");
        assert!(!ids.contains(&3), "creature tag note must be excluded");
    }

    #[test]
    fn tag_only_query_excerpt_is_none() {
        let dir = TempDir::new().unwrap();
        let note = make_note(1, "Aldric", "aldric.md");
        std::fs::write(dir.path().join("aldric.md"), "---\ntags: [npc]\n---\nBody text here.").unwrap();

        let index = rebuild_index(dir.path(), &[note], &[], &[]).unwrap();
        let results = search_notes_in_index(&index, dir.path(), "tag:npc", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].excerpt.is_none(), "tag-only query must return no excerpt");
        assert_eq!(results[0].match_count, 0, "tag-only query must have zero match count");
    }

    #[test]
    fn maps_not_returned_for_tag_only_query() {
        let dir = TempDir::new().unwrap();
        let note = make_note(1, "Aldric", "aldric.md");
        let map = make_map(1, "Dragon Map");
        std::fs::write(dir.path().join("aldric.md"), "---\ntags: [npc]\n---\nBody").unwrap();

        let index = rebuild_index(dir.path(), &[note], &[map], &[]).unwrap();
        let result = search_all_in_index(&index, dir.path(), "tag:npc", 10).unwrap();
        assert_eq!(result.notes.len(), 1);
        assert!(result.maps.is_empty(), "maps must not appear for tag-only queries");
    }

    // ── Fuzzy matching ─────────────────────────────────────────────────────────

    #[test]
    fn fuzzy_distance_tiers_are_correct() {
        assert_eq!(fuzzy_distance(1), 0, "len 1 → dist 0");
        assert_eq!(fuzzy_distance(2), 0, "len 2 → dist 0");
        assert_eq!(fuzzy_distance(3), 0, "len 3 → dist 0");
        assert_eq!(fuzzy_distance(4), 1, "len 4 → dist 1");
        assert_eq!(fuzzy_distance(5), 1, "len 5 → dist 1");
        assert_eq!(fuzzy_distance(7), 1, "len 7 → dist 1");
        assert_eq!(fuzzy_distance(8), 2, "len 8 → dist 2");
        assert_eq!(fuzzy_distance(10), 2, "len 10 → dist 2");
    }

    #[test]
    fn fuzzy_typo_captian_finds_captain_ash() {
        let dir = TempDir::new().unwrap();
        let note = make_note(1, "Captain Ash", "characters/ash.md");
        std::fs::create_dir_all(dir.path().join("characters")).unwrap();
        std::fs::write(dir.path().join("characters/ash.md"), "").unwrap();
        let index = rebuild_index(dir.path(), &[note], &[], &[]).unwrap();

        let results = search_notes_in_index(&index, dir.path(), "Captian Ash", 10).unwrap();
        assert_eq!(results.len(), 1, "'Captian Ash' must find 'Captain Ash' via fuzzy dist 1");
        assert_eq!(results[0].title, "Captain Ash");
    }

    #[test]
    fn fuzzy_short_term_no_match_cap_vs_cup() {
        let dir = TempDir::new().unwrap();
        let note = make_note(1, "Cup of Tea", "cup.md");
        let index = rebuild_index(dir.path(), &[note], &[], &[]).unwrap();

        // "Cap" is 3 chars → distance 0; must not fuzzy-match "cup"
        let results = search_notes_in_index(&index, dir.path(), "Cap", 10).unwrap();
        assert!(results.is_empty(), "'Cap' (dist 0) must not fuzzy-match 'cup'");
    }

    #[test]
    fn fuzzy_ascii_folding_naive_query_finds_plain() {
        let dir = TempDir::new().unwrap();
        let note = make_note(1, "naive approach", "naive.md");
        let index = rebuild_index(dir.path(), &[note], &[], &[]).unwrap();

        // ASCII folding folds "naïve" → "naive" on both index and query side
        let results = search_notes_in_index(&index, dir.path(), "naïve", 10).unwrap();
        assert_eq!(results.len(), 1, "'naïve' must match 'naive' via ASCII folding");
        assert_eq!(results[0].title, "naive approach");
    }

    #[test]
    fn fuzzy_title_match_ranks_above_body_match() {
        let dir = TempDir::new().unwrap();
        let note_title = make_note(1, "Harbor Tale", "harbor_title.md");
        let note_body = make_note(2, "Seaside Story", "harbor_body.md");
        std::fs::write(dir.path().join("harbor_title.md"), "A story of the sea.").unwrap();
        // Long body so BM25 body-field score stays below the short title-field score
        let long_body = format!("The harbor is peaceful. {}", "Waves and wind. ".repeat(20));
        std::fs::write(dir.path().join("harbor_body.md"), long_body.as_str()).unwrap();

        let index = rebuild_index(dir.path(), &[note_title, note_body], &[], &[]).unwrap();

        let results = search_notes_in_index(&index, dir.path(), "Harbor", 10).unwrap();
        assert_eq!(results.len(), 2, "both notes must match 'Harbor'");
        assert_eq!(results[0].id, 1, "title match must rank above body match");
    }

    #[test]
    fn fuzzy_tag_filter_values_matched_exactly() {
        let dir = TempDir::new().unwrap();
        let note = make_note(1, "Aldric", "aldric.md");
        std::fs::write(dir.path().join("aldric.md"), "---\ntags: [npcs]\n---\nBody").unwrap();

        let index = rebuild_index(dir.path(), &[note], &[], &[]).unwrap();

        // "tag:npc" must NOT fuzzy-match tag "npcs" — tag filters are exact
        let results = search_notes_in_index(&index, dir.path(), "tag:npc", 10).unwrap();
        assert!(results.is_empty(), "tag filter must be exact, not fuzzy");

        let results2 = search_notes_in_index(&index, dir.path(), "tag:npcs", 10).unwrap();
        assert_eq!(results2.len(), 1, "exact tag match must work");
    }
}
