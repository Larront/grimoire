// Graph data command — returns all nodes (notes, maps, stub notes) and edges
// (wikilinks + map-pin references) for the vault-wide force-directed graph.
//
// Node IDs use prefixed strings to avoid collisions across entity types:
//   "note-{id}"          — a real note (resolved)
//   "map-{id}"           — a map
//   "stub-{target_path}" — an unresolved wikilink target (no corresponding note)
//
// Edge IDs use sequential integers serialised as strings.

use crate::db::schema::maps::dsl as m;
use crate::db::schema::note_links::dsl as nl;
use crate::db::schema::notes::dsl as n;
use crate::db::schema::pins::dsl as p;
use crate::vault::AppVault;
use diesel::prelude::*;
use serde::Serialize;
use tauri::State;

// ── Data types ────────────────────────────────────────────────────────────────

#[derive(Serialize, Debug)]
pub struct GraphNodeData {
    pub id: String,
    pub label: String,
    pub kind: String, // "note" | "map" | "stub"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_id: Option<i32>,
}

#[derive(Serialize, Debug)]
pub struct GraphEdgeData {
    pub id: String,
    pub source: String,
    pub target: String,
}

#[derive(Serialize, Debug)]
pub struct GraphData {
    pub nodes: Vec<GraphNodeData>,
    pub edges: Vec<GraphEdgeData>,
}

// ── Helper row structs ────────────────────────────────────────────────────────

#[derive(QueryableByName, Debug)]
struct NoteRow {
    #[diesel(sql_type = diesel::sql_types::Integer)]
    id: i32,
    #[diesel(sql_type = diesel::sql_types::Text)]
    path: String,
    #[diesel(sql_type = diesel::sql_types::Text)]
    title: String,
}

#[derive(QueryableByName, Debug)]
struct MapRow {
    #[diesel(sql_type = diesel::sql_types::Integer)]
    id: i32,
    #[diesel(sql_type = diesel::sql_types::Text)]
    title: String,
}

#[derive(QueryableByName, Debug)]
struct NoteLinkRow {
    #[diesel(sql_type = diesel::sql_types::Integer)]
    source_id: i32,
    #[diesel(sql_type = diesel::sql_types::Text)]
    target_path: String,
}

#[derive(QueryableByName, Debug)]
struct PinRow {
    #[diesel(sql_type = diesel::sql_types::Integer)]
    map_id: i32,
    #[diesel(sql_type = diesel::sql_types::Integer)]
    note_id: i32,
}

// ── Core logic (testable) ─────────────────────────────────────────────────────

pub fn get_graph_data_on_conn(
    conn: &mut SqliteConnection,
) -> Result<GraphData, String> {
    // 1. Fetch all notes
    let notes: Vec<NoteRow> = diesel::sql_query("SELECT id, path, title FROM notes")
        .load(conn)
        .map_err(|e| e.to_string())?;

    // 2. Fetch all maps
    let maps: Vec<MapRow> = diesel::sql_query("SELECT id, title FROM maps")
        .load(conn)
        .map_err(|e| e.to_string())?;

    // 3. Fetch all note_links
    let links: Vec<NoteLinkRow> =
        diesel::sql_query("SELECT source_id, target_path FROM note_links")
            .load(conn)
            .map_err(|e| e.to_string())?;

    // 4. Fetch map→note pin references (only pins with a note_id)
    let pin_refs: Vec<PinRow> =
        diesel::sql_query("SELECT map_id, note_id FROM pins WHERE note_id IS NOT NULL")
            .load(conn)
            .map_err(|e| e.to_string())?;

    // Build a path→id lookup for resolving wikilinks
    let path_to_id: std::collections::HashMap<&str, i32> =
        notes.iter().map(|note| (note.path.as_str(), note.id)).collect();

    // Build note nodes
    let mut nodes: Vec<GraphNodeData> = notes
        .iter()
        .map(|note| GraphNodeData {
            id: format!("note-{}", note.id),
            label: note.title.clone(),
            kind: "note".to_string(),
            entity_id: Some(note.id),
        })
        .collect();

    // Map nodes
    for map in &maps {
        nodes.push(GraphNodeData {
            id: format!("map-{}", map.id),
            label: map.title.clone(),
            kind: "map".to_string(),
            entity_id: Some(map.id),
        });
    }

    // Stub nodes: target_paths with no matching note
    let mut seen_stubs: std::collections::HashSet<String> = std::collections::HashSet::new();
    for link in &links {
        if !path_to_id.contains_key(link.target_path.as_str()) {
            if seen_stubs.insert(link.target_path.clone()) {
                nodes.push(GraphNodeData {
                    id: format!("stub-{}", link.target_path),
                    label: link.target_path.clone(),
                    kind: "stub".to_string(),
                    entity_id: None,
                });
            }
        }
    }

    // Build edges
    let mut edges: Vec<GraphEdgeData> = Vec::new();
    let mut edge_id: usize = 0;

    // Wikilink edges (note→note or note→stub)
    for link in &links {
        let source = format!("note-{}", link.source_id);
        let target = if let Some(&target_id) = path_to_id.get(link.target_path.as_str()) {
            format!("note-{}", target_id)
        } else {
            format!("stub-{}", link.target_path)
        };
        edges.push(GraphEdgeData {
            id: format!("e-{}", edge_id),
            source,
            target,
        });
        edge_id += 1;
    }

    // Pin reference edges (map→note)
    for pin in &pin_refs {
        edges.push(GraphEdgeData {
            id: format!("e-{}", edge_id),
            source: format!("map-{}", pin.map_id),
            target: format!("note-{}", pin.note_id),
        });
        edge_id += 1;
    }

    Ok(GraphData { nodes, edges })
}

// ── Tauri command ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_graph_data(vault: State<AppVault>) -> Result<GraphData, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    get_graph_data_on_conn(conn)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::{maps, note_links, notes, pins};
    use diesel::connection::SimpleConnection;
    use diesel::prelude::*;
    use diesel::SqliteConnection;

    fn setup_db() -> SqliteConnection {
        let mut conn = SqliteConnection::establish(":memory:").unwrap();
        conn.batch_execute("
            PRAGMA foreign_keys = OFF;
            CREATE TABLE notes (
                id INTEGER PRIMARY KEY,
                path TEXT NOT NULL,
                title TEXT NOT NULL,
                icon TEXT,
                cover_image TEXT,
                parent_path TEXT,
                archived BOOLEAN NOT NULL DEFAULT 0,
                modified_at TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE maps (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                image_path TEXT,
                image_width INTEGER,
                image_height INTEGER,
                created_at TEXT NOT NULL DEFAULT '',
                modified_at TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE note_links (
                source_id INTEGER NOT NULL,
                target_path TEXT NOT NULL,
                PRIMARY KEY (source_id, target_path)
            );
            CREATE TABLE pins (
                id INTEGER PRIMARY KEY,
                map_id INTEGER NOT NULL,
                x REAL NOT NULL DEFAULT 0,
                y REAL NOT NULL DEFAULT 0,
                title TEXT NOT NULL DEFAULT '',
                description TEXT,
                category_id INTEGER,
                note_id INTEGER,
                created_at TEXT NOT NULL DEFAULT '',
                shape TEXT,
                icon TEXT,
                color TEXT
            );
        ").unwrap();
        conn
    }

    #[test]
    fn test_empty_vault_returns_empty_graph() {
        let mut conn = setup_db();
        let data = get_graph_data_on_conn(&mut conn).unwrap();
        assert!(data.nodes.is_empty());
        assert!(data.edges.is_empty());
    }

    #[test]
    fn test_note_nodes_are_included() {
        let mut conn = setup_db();
        diesel::insert_into(notes::table)
            .values((
                notes::id.eq(1),
                notes::path.eq("hello.md"),
                notes::title.eq("Hello"),
                notes::archived.eq(false),
                notes::modified_at.eq(""),
            ))
            .execute(&mut conn)
            .unwrap();

        let data = get_graph_data_on_conn(&mut conn).unwrap();
        assert_eq!(data.nodes.len(), 1);
        let node = &data.nodes[0];
        assert_eq!(node.id, "note-1");
        assert_eq!(node.label, "Hello");
        assert_eq!(node.kind, "note");
        assert_eq!(node.entity_id, Some(1));
    }

    #[test]
    fn test_map_nodes_are_included() {
        let mut conn = setup_db();
        diesel::insert_into(maps::table)
            .values((
                maps::id.eq(10),
                maps::title.eq("World"),
                maps::created_at.eq(""),
                maps::modified_at.eq(""),
            ))
            .execute(&mut conn)
            .unwrap();

        let data = get_graph_data_on_conn(&mut conn).unwrap();
        assert_eq!(data.nodes.len(), 1);
        let node = &data.nodes[0];
        assert_eq!(node.id, "map-10");
        assert_eq!(node.kind, "map");
        assert_eq!(node.entity_id, Some(10));
    }

    #[test]
    fn test_stub_nodes_for_unresolved_wikilinks() {
        let mut conn = setup_db();
        diesel::insert_into(notes::table)
            .values((
                notes::id.eq(1),
                notes::path.eq("source.md"),
                notes::title.eq("Source"),
                notes::archived.eq(false),
                notes::modified_at.eq(""),
            ))
            .execute(&mut conn)
            .unwrap();
        diesel::insert_into(note_links::table)
            .values((note_links::source_id.eq(1), note_links::target_path.eq("missing.md")))
            .execute(&mut conn)
            .unwrap();

        let data = get_graph_data_on_conn(&mut conn).unwrap();
        let stubs: Vec<_> = data.nodes.iter().filter(|n| n.kind == "stub").collect();
        assert_eq!(stubs.len(), 1);
        assert_eq!(stubs[0].id, "stub-missing.md");
        assert_eq!(stubs[0].label, "missing.md");
        assert!(stubs[0].entity_id.is_none());
    }

    #[test]
    fn test_stub_nodes_deduplicated_across_multiple_sources() {
        let mut conn = setup_db();
        for i in 1..=2 {
            diesel::insert_into(notes::table)
                .values((
                    notes::id.eq(i),
                    notes::path.eq(format!("note{}.md", i)),
                    notes::title.eq(format!("Note {}", i)),
                    notes::archived.eq(false),
                    notes::modified_at.eq(""),
                ))
                .execute(&mut conn)
                .unwrap();
            diesel::insert_into(note_links::table)
                .values((note_links::source_id.eq(i), note_links::target_path.eq("shared-stub.md")))
                .execute(&mut conn)
                .unwrap();
        }

        let data = get_graph_data_on_conn(&mut conn).unwrap();
        let stubs: Vec<_> = data.nodes.iter().filter(|n| n.kind == "stub").collect();
        assert_eq!(stubs.len(), 1, "stub should be deduplicated");
    }

    #[test]
    fn test_wikilink_edges_between_notes() {
        let mut conn = setup_db();
        for (id, path, title) in [(1, "a.md", "A"), (2, "b.md", "B")] {
            diesel::insert_into(notes::table)
                .values((
                    notes::id.eq(id),
                    notes::path.eq(path),
                    notes::title.eq(title),
                    notes::archived.eq(false),
                    notes::modified_at.eq(""),
                ))
                .execute(&mut conn)
                .unwrap();
        }
        diesel::insert_into(note_links::table)
            .values((note_links::source_id.eq(1), note_links::target_path.eq("b.md")))
            .execute(&mut conn)
            .unwrap();

        let data = get_graph_data_on_conn(&mut conn).unwrap();
        assert_eq!(data.edges.len(), 1);
        assert_eq!(data.edges[0].source, "note-1");
        assert_eq!(data.edges[0].target, "note-2");
    }

    #[test]
    fn test_wikilink_edges_to_stub() {
        let mut conn = setup_db();
        diesel::insert_into(notes::table)
            .values((
                notes::id.eq(1),
                notes::path.eq("source.md"),
                notes::title.eq("Source"),
                notes::archived.eq(false),
                notes::modified_at.eq(""),
            ))
            .execute(&mut conn)
            .unwrap();
        diesel::insert_into(note_links::table)
            .values((note_links::source_id.eq(1), note_links::target_path.eq("nowhere.md")))
            .execute(&mut conn)
            .unwrap();

        let data = get_graph_data_on_conn(&mut conn).unwrap();
        assert_eq!(data.edges.len(), 1);
        assert_eq!(data.edges[0].source, "note-1");
        assert_eq!(data.edges[0].target, "stub-nowhere.md");
    }

    #[test]
    fn test_pin_reference_edges_map_to_note() {
        let mut conn = setup_db();
        diesel::insert_into(notes::table)
            .values((
                notes::id.eq(5),
                notes::path.eq("note.md"),
                notes::title.eq("Note"),
                notes::archived.eq(false),
                notes::modified_at.eq(""),
            ))
            .execute(&mut conn)
            .unwrap();
        diesel::insert_into(maps::table)
            .values((
                maps::id.eq(3),
                maps::title.eq("Map"),
                maps::created_at.eq(""),
                maps::modified_at.eq(""),
            ))
            .execute(&mut conn)
            .unwrap();
        diesel::insert_into(pins::table)
            .values((
                pins::id.eq(1),
                pins::map_id.eq(3),
                pins::note_id.eq(5),
                pins::x.eq(0.0f32),
                pins::y.eq(0.0f32),
                pins::title.eq(""),
                pins::created_at.eq(""),
            ))
            .execute(&mut conn)
            .unwrap();

        let data = get_graph_data_on_conn(&mut conn).unwrap();
        let pin_edges: Vec<_> = data
            .edges
            .iter()
            .filter(|e| e.source.starts_with("map-"))
            .collect();
        assert_eq!(pin_edges.len(), 1);
        assert_eq!(pin_edges[0].source, "map-3");
        assert_eq!(pin_edges[0].target, "note-5");
    }

    #[test]
    fn test_pins_without_note_id_do_not_create_edges() {
        let mut conn = setup_db();
        diesel::insert_into(maps::table)
            .values((
                maps::id.eq(1),
                maps::title.eq("Map"),
                maps::created_at.eq(""),
                maps::modified_at.eq(""),
            ))
            .execute(&mut conn)
            .unwrap();
        diesel::insert_into(pins::table)
            .values((
                pins::id.eq(1),
                pins::map_id.eq(1),
                pins::x.eq(0.0f32),
                pins::y.eq(0.0f32),
                pins::title.eq(""),
                pins::created_at.eq(""),
                // note_id is NULL (not set)
            ))
            .execute(&mut conn)
            .unwrap();

        let data = get_graph_data_on_conn(&mut conn).unwrap();
        assert!(data.edges.is_empty());
    }

    #[test]
    fn test_orphan_notes_appear_without_edges() {
        let mut conn = setup_db();
        diesel::insert_into(notes::table)
            .values((
                notes::id.eq(1),
                notes::path.eq("orphan.md"),
                notes::title.eq("Orphan"),
                notes::archived.eq(false),
                notes::modified_at.eq(""),
            ))
            .execute(&mut conn)
            .unwrap();

        let data = get_graph_data_on_conn(&mut conn).unwrap();
        assert_eq!(data.nodes.len(), 1);
        assert!(data.edges.is_empty());
    }
}
