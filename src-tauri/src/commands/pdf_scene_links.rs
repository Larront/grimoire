// Scene-link annotations for PDFs (ADR-0011). A Scene-link attaches a Scene to a
// character range on a page of a path-addressed PDF. This module owns every
// Scene-link DB operation: create, list-by-path, remove — plus the path-rewrite
// and path-cleanup helpers the PDF rename/delete commands reuse so links follow
// (or vanish with) the file they annotate.
//
// `scene_id` is a real FK with ON DELETE CASCADE, so deleting a Scene removes its
// links with no special logic in `delete_scene`.

use diesel::prelude::*;
use tauri::State;

use crate::db::models::{NewPdfSceneLink, PdfSceneLink};
use crate::db::schema::pdf_scene_links;
use crate::ledger::AppLedger;

#[tauri::command]
#[specta::specta]
pub fn create_pdf_scene_link(
    pdf_path: String,
    page: i32,
    start_offset: i32,
    end_offset: i32,
    quote: String,
    scene_id: i32,
    ledger: State<AppLedger>,
) -> Result<PdfSceneLink, String> {
    let mut state = ledger.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    diesel::insert_into(pdf_scene_links::table)
        .values(NewPdfSceneLink {
            pdf_path,
            page,
            start_offset,
            end_offset,
            quote,
            scene_id,
        })
        .returning(PdfSceneLink::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn get_pdf_scene_links(
    pdf_path: String,
    ledger: State<AppLedger>,
) -> Result<Vec<PdfSceneLink>, String> {
    let mut state = ledger.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    pdf_scene_links::table
        .filter(pdf_scene_links::pdf_path.eq(pdf_path))
        .order((pdf_scene_links::page.asc(), pdf_scene_links::start_offset.asc()))
        .load::<PdfSceneLink>(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn delete_pdf_scene_link(id: i32, ledger: State<AppLedger>) -> Result<(), String> {
    let mut state = ledger.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    diesel::delete(pdf_scene_links::table.find(id))
        .execute(conn)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Re-key every Scene-link from `old_path` to `new_path`. Called from `rename_pdf`
/// so links follow a moved PDF (ADR-0011 §Consequences — the key is the path, so a
/// rename must rewrite it). Returns the number of rows rewritten.
pub fn rewrite_pdf_path(
    conn: &mut SqliteConnection,
    old_path: &str,
    new_path: &str,
) -> QueryResult<usize> {
    diesel::update(pdf_scene_links::table.filter(pdf_scene_links::pdf_path.eq(old_path)))
        .set(pdf_scene_links::pdf_path.eq(new_path))
        .execute(conn)
}

/// Remove every Scene-link for a PDF. Called from `delete_pdf` — a deleted PDF's
/// links have no referent, and unlike a Scene (whose deletion cascades) the PDF is
/// not a DB row, so the cleanup is explicit here. Returns the rows removed.
pub fn delete_links_for_pdf(conn: &mut SqliteConnection, pdf_path: &str) -> QueryResult<usize> {
    diesel::delete(pdf_scene_links::table.filter(pdf_scene_links::pdf_path.eq(pdf_path)))
        .execute(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{models::*, schema::*, MIGRATIONS};
    use diesel_migrations::MigrationHarness;

    fn setup_db() -> SqliteConnection {
        let mut conn = SqliteConnection::establish(":memory:").expect("in-memory DB");
        conn.run_pending_migrations(MIGRATIONS).expect("migrations");
        conn
    }

    fn make_scene(conn: &mut SqliteConnection, name: &str) -> Scene {
        diesel::insert_into(scenes::table)
            .values(NewScene { name: name.to_string() })
            .returning(Scene::as_returning())
            .get_result(conn)
            .unwrap()
    }

    fn make_link(conn: &mut SqliteConnection, pdf_path: &str, page: i32, scene_id: i32) -> PdfSceneLink {
        diesel::insert_into(pdf_scene_links::table)
            .values(NewPdfSceneLink {
                pdf_path: pdf_path.to_string(),
                page,
                start_offset: 0,
                end_offset: 5,
                quote: "Hello".to_string(),
                scene_id,
            })
            .returning(PdfSceneLink::as_returning())
            .get_result(conn)
            .unwrap()
    }

    #[test]
    fn test_create_and_get_link() {
        let mut conn = setup_db();
        let scene = make_scene(&mut conn, "Tavern");
        let link = make_link(&mut conn, "rulebook.pdf", 3, scene.id);
        assert_eq!(link.pdf_path, "rulebook.pdf");
        assert_eq!(link.page, 3);
        assert_eq!(link.quote, "Hello");
        assert_eq!(link.scene_id, scene.id);

        let all: Vec<PdfSceneLink> = pdf_scene_links::table.load(&mut conn).unwrap();
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn test_list_by_path_filters_and_orders() {
        let mut conn = setup_db();
        let scene = make_scene(&mut conn, "Combat");
        // Two PDFs; only the queried one's links come back, in (page, start) order.
        make_link(&mut conn, "b.pdf", 2, scene.id);
        let early = diesel::insert_into(pdf_scene_links::table)
            .values(NewPdfSceneLink {
                pdf_path: "a.pdf".to_string(),
                page: 2,
                start_offset: 1,
                end_offset: 4,
                quote: "ell".to_string(),
                scene_id: scene.id,
            })
            .returning(PdfSceneLink::as_returning())
            .get_result(&mut conn)
            .unwrap();
        let earliest = diesel::insert_into(pdf_scene_links::table)
            .values(NewPdfSceneLink {
                pdf_path: "a.pdf".to_string(),
                page: 1,
                start_offset: 0,
                end_offset: 2,
                quote: "He".to_string(),
                scene_id: scene.id,
            })
            .returning(PdfSceneLink::as_returning())
            .get_result(&mut conn)
            .unwrap();

        let links: Vec<PdfSceneLink> = pdf_scene_links::table
            .filter(pdf_scene_links::pdf_path.eq("a.pdf"))
            .order((pdf_scene_links::page.asc(), pdf_scene_links::start_offset.asc()))
            .load(&mut conn)
            .unwrap();
        assert_eq!(links.len(), 2, "only a.pdf's links");
        assert_eq!(links[0].id, earliest.id, "page 1 before page 2");
        assert_eq!(links[1].id, early.id);
    }

    #[test]
    fn test_remove_link() {
        let mut conn = setup_db();
        let scene = make_scene(&mut conn, "Forest");
        let link = make_link(&mut conn, "a.pdf", 1, scene.id);
        diesel::delete(pdf_scene_links::table.find(link.id))
            .execute(&mut conn)
            .unwrap();
        let all: Vec<PdfSceneLink> = pdf_scene_links::table.load(&mut conn).unwrap();
        assert!(all.is_empty(), "link should be gone after remove");
    }

    #[test]
    fn test_cascade_on_scene_delete() {
        let mut conn = setup_db();
        let scene = make_scene(&mut conn, "Doomed");
        let keep = make_scene(&mut conn, "Keeper");
        make_link(&mut conn, "a.pdf", 1, scene.id);
        make_link(&mut conn, "a.pdf", 2, scene.id);
        make_link(&mut conn, "b.pdf", 1, keep.id);

        diesel::delete(scenes::table.find(scene.id))
            .execute(&mut conn)
            .unwrap();

        let remaining: Vec<PdfSceneLink> = pdf_scene_links::table.load(&mut conn).unwrap();
        assert_eq!(remaining.len(), 1, "the deleted scene's links cascade away");
        assert_eq!(remaining[0].scene_id, keep.id, "the other scene's link survives");
    }

    #[test]
    fn test_rewrite_pdf_path() {
        let mut conn = setup_db();
        let scene = make_scene(&mut conn, "Scene");
        make_link(&mut conn, "old.pdf", 1, scene.id);
        make_link(&mut conn, "old.pdf", 2, scene.id);
        make_link(&mut conn, "other.pdf", 1, scene.id);

        let rewritten = rewrite_pdf_path(&mut conn, "old.pdf", "new.pdf").unwrap();
        assert_eq!(rewritten, 2);

        let new_links: Vec<PdfSceneLink> = pdf_scene_links::table
            .filter(pdf_scene_links::pdf_path.eq("new.pdf"))
            .load(&mut conn)
            .unwrap();
        assert_eq!(new_links.len(), 2, "both links follow the rename");
        let stale: Vec<PdfSceneLink> = pdf_scene_links::table
            .filter(pdf_scene_links::pdf_path.eq("old.pdf"))
            .load(&mut conn)
            .unwrap();
        assert!(stale.is_empty(), "nothing left at the old path");
    }

    #[test]
    fn test_delete_links_for_pdf() {
        let mut conn = setup_db();
        let scene = make_scene(&mut conn, "Scene");
        make_link(&mut conn, "gone.pdf", 1, scene.id);
        make_link(&mut conn, "gone.pdf", 2, scene.id);
        make_link(&mut conn, "stay.pdf", 1, scene.id);

        let removed = delete_links_for_pdf(&mut conn, "gone.pdf").unwrap();
        assert_eq!(removed, 2);

        let all: Vec<PdfSceneLink> = pdf_scene_links::table.load(&mut conn).unwrap();
        assert_eq!(all.len(), 1, "only the other PDF's link remains");
        assert_eq!(all[0].pdf_path, "stay.pdf");
    }
}
