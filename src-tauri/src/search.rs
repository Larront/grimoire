use crate::db::models::Note;
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
}

fn make_schema() -> Schema {
    let mut builder = tantivy::schema::SchemaBuilder::default();
    builder.add_text_field("kind", STRING | STORED);
    builder.add_i64_field(
        "entity_id",
        NumericOptions::default()
            .set_indexed()
            .set_stored()
            .set_fast(),
    );
    builder.add_text_field("path", STORED);
    builder.add_text_field("title", TEXT | STORED);
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
    if let Ok(dt) =
        chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
    {
        return dt.and_utc().timestamp_micros();
    }
    0
}

fn note_doc(schema: &Schema, note: &Note) -> TantivyDocument {
    let kind = schema.get_field("kind").unwrap();
    let entity_id = schema.get_field("entity_id").unwrap();
    let path_f = schema.get_field("path").unwrap();
    let title_f = schema.get_field("title").unwrap();
    let modified_at_f = schema.get_field("modified_at").unwrap();

    let ts = parse_modified_at(&note.modified_at);
    let tantivy_dt = TantivyDateTime::from_timestamp_micros(ts);

    let mut doc = TantivyDocument::default();
    doc.add_text(kind, "note");
    doc.add_i64(entity_id, note.id as i64);
    doc.add_text(path_f, &note.path);
    doc.add_text(title_f, &note.title);
    doc.add_date(modified_at_f, tantivy_dt);
    doc
}

pub fn rebuild_index(vault_path: &Path, notes: &[Note]) -> Result<Index, String> {
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
        writer
            .add_document(note_doc(&schema, note))
            .map_err(|e| e.to_string())?;
    }
    writer.commit().map_err(|e| e.to_string())?;

    Ok(index)
}

pub fn index_note(index: &Index, note: &Note) -> Result<(), String> {
    let schema = index.schema();
    let entity_id_f = schema
        .get_field("entity_id")
        .map_err(|e| e.to_string())?;

    let mut writer: IndexWriter = index.writer(15_000_000).map_err(|e| e.to_string())?;
    writer.delete_term(tantivy::Term::from_field_i64(entity_id_f, note.id as i64));
    writer
        .add_document(note_doc(&schema, note))
        .map_err(|e| e.to_string())?;
    writer.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn remove_note(index: &Index, entity_id: i32) -> Result<(), String> {
    let schema = index.schema();
    let entity_id_f = schema
        .get_field("entity_id")
        .map_err(|e| e.to_string())?;

    let mut writer: IndexWriter = index.writer(15_000_000).map_err(|e| e.to_string())?;
    writer.delete_term(tantivy::Term::from_field_i64(entity_id_f, entity_id as i64));
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

/// Build a prefix-aware title query.
///
/// All words except the last get an exact TermQuery; the last word becomes a
/// RegexQuery (prefix match) so "upp" finds notes containing "upper". Words
/// shorter than 2 chars are skipped (below the tokenizer min-length).
fn build_title_query(
    _index: &Index,
    title_f: tantivy::schema::Field,
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

    let prefix_q: Box<dyn tantivy::query::Query> = Box::new(
        RegexQuery::from_pattern(&format!("{}.*", regex_escape(last)), title_f)
            .map_err(|e| e.to_string())?,
    );

    if rest.is_empty() {
        return Ok(prefix_q);
    }

    let mut clauses: Vec<(Occur, Box<dyn tantivy::query::Query>)> = rest
        .iter()
        .map(|&w| {
            let term = tantivy::Term::from_field_text(title_f, w);
            let q: Box<dyn tantivy::query::Query> =
                Box::new(TermQuery::new(term, IndexRecordOption::Basic));
            (Occur::Must, q)
        })
        .collect();
    clauses.push((Occur::Must, prefix_q));

    Ok(Box::new(BooleanQuery::new(clauses)))
}

/// Search the index for notes matching the given query string (title field).
///
/// Prefix matching: the last typed word matches any term that starts with it,
/// so "upp" finds "The Upper Citadel". Earlier words require an exact token.
/// Typo tolerance (fuzzy Levenshtein) is deferred to the fuzzy slice.
pub fn search_notes_in_index(
    index: &Index,
    query: &str,
    limit: usize,
) -> Result<Vec<NoteSearchResult>, String> {
    let reader = index.reader().map_err(|e| e.to_string())?;
    let searcher = reader.searcher();
    let schema = index.schema();

    let title_f = schema.get_field("title").map_err(|e| e.to_string())?;
    let entity_id_f = schema.get_field("entity_id").map_err(|e| e.to_string())?;
    let path_f = schema.get_field("path").map_err(|e| e.to_string())?;

    let parsed = match build_title_query(index, title_f, query) {
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

        results.push(NoteSearchResult { id, title, path });
    }

    Ok(results)
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

    #[test]
    fn rebuild_empty_index_returns_no_results() {
        let dir = TempDir::new().unwrap();
        let index = rebuild_index(dir.path(), &[]).unwrap();
        let results = search_notes_in_index(&index, "anything", 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn search_finds_note_by_exact_title_word() {
        let dir = TempDir::new().unwrap();
        let notes = [make_note(1, "Aldric the Wizard", "npcs/aldric.md")];
        let index = rebuild_index(dir.path(), &notes).unwrap();

        let results = search_notes_in_index(&index, "Aldric", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, 1);
        assert_eq!(results[0].title, "Aldric the Wizard");
        assert_eq!(results[0].path, "npcs/aldric.md");
    }

    #[test]
    fn search_finds_note_by_partial_word_prefix() {
        let dir = TempDir::new().unwrap();
        let notes = [make_note(1, "The Upper Citadel", "places/citadel.md")];
        let index = rebuild_index(dir.path(), &notes).unwrap();

        // "upp" is a prefix of "upper" — should match
        let results = search_notes_in_index(&index, "upp", 10).unwrap();
        assert_eq!(results.len(), 1, "prefix 'upp' should match 'upper'");
        assert_eq!(results[0].title, "The Upper Citadel");

        // Multi-word partial: "The Upper Cit" — last word is a prefix
        let results2 = search_notes_in_index(&index, "The Upper Cit", 10).unwrap();
        assert_eq!(results2.len(), 1, "partial last word should match");
    }

    #[test]
    fn search_returns_empty_for_no_match() {
        let dir = TempDir::new().unwrap();
        let notes = [make_note(1, "Aldric the Wizard", "npcs/aldric.md")];
        let index = rebuild_index(dir.path(), &notes).unwrap();

        let results = search_notes_in_index(&index, "nonexistent", 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn incremental_index_adds_new_note() {
        let dir = TempDir::new().unwrap();
        let index = rebuild_index(dir.path(), &[]).unwrap();

        let note = make_note(1, "Captain Ash", "characters/ash.md");
        index_note(&index, &note).unwrap();

        let results = search_notes_in_index(&index, "Captain", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Captain Ash");
    }

    #[test]
    fn incremental_remove_deletes_note() {
        let dir = TempDir::new().unwrap();
        let notes = [make_note(1, "Captain Ash", "characters/ash.md")];
        let index = rebuild_index(dir.path(), &notes).unwrap();

        let before = search_notes_in_index(&index, "Captain", 10).unwrap();
        assert_eq!(before.len(), 1);

        remove_note(&index, 1).unwrap();

        let after = search_notes_in_index(&index, "Captain", 10).unwrap();
        assert!(after.is_empty());
    }

    #[test]
    fn rebuild_replaces_all_previous_documents() {
        let dir = TempDir::new().unwrap();
        let first = [make_note(1, "Old Note", "old.md")];
        rebuild_index(dir.path(), &first).unwrap();

        let second = [make_note(2, "New Note", "new.md")];
        let index = rebuild_index(dir.path(), &second).unwrap();

        let old = search_notes_in_index(&index, "Old", 10).unwrap();
        assert!(old.is_empty(), "stale document should be gone after rebuild");

        let new = search_notes_in_index(&index, "New", 10).unwrap();
        assert_eq!(new.len(), 1);
    }

    #[test]
    fn incremental_upsert_updates_existing_note() {
        let dir = TempDir::new().unwrap();
        let note_v1 = make_note(1, "Dragon Lair", "dragon.md");
        let index = rebuild_index(dir.path(), &[note_v1]).unwrap();

        let note_v2 = make_note(1, "Dragon Cave", "dragon.md");
        index_note(&index, &note_v2).unwrap();

        let lair = search_notes_in_index(&index, "Lair", 10).unwrap();
        assert!(lair.is_empty(), "old title should no longer match");

        let cave = search_notes_in_index(&index, "Cave", 10).unwrap();
        assert_eq!(cave.len(), 1);
        assert_eq!(cave[0].title, "Dragon Cave");
    }
}
