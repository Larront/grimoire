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

/// Re-link a Scene-link to a different Scene (the toolbar change-Scene dropdown,
/// issue #104). Only the `scene_id` changes — the anchor (page + offsets + quote)
/// stays put, so the underline keeps its position and only its accent/identity
/// swaps. Returns the updated row.
#[tauri::command]
#[specta::specta]
pub fn update_pdf_scene_link(
    id: i32,
    scene_id: i32,
    ledger: State<AppLedger>,
) -> Result<PdfSceneLink, String> {
    let mut state = ledger.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    diesel::update(pdf_scene_links::table.find(id))
        .set(pdf_scene_links::scene_id.eq(scene_id))
        .returning(PdfSceneLink::as_returning())
        .get_result(conn)
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

/// Re-key Scene-links for every PDF under a moved folder. Called from
/// `rename_folder` (a folder move relocates its PDFs on disk via an atomic
/// directory rename, so their path-addressed links must move with them, ADR-0011
/// §Consequences). `old_prefix`/`new_prefix` are the folder paths with a trailing
/// slash, so only paths *inside* the folder match — a sibling folder sharing a
/// name prefix (`creatures` vs `creatures-extra`) is untouched. Returns the rows
/// rewritten.
///
/// The rewrite is anchored to the *leading* prefix only — `new_prefix` followed by
/// the remainder after `old_prefix` — rather than a blanket `REPLACE`, so a path
/// that repeats the folder name deeper (`creatures/sub/creatures/x.pdf`) keeps its
/// interior segment intact.
pub fn rewrite_pdf_path_prefix(
    conn: &mut SqliteConnection,
    old_prefix: &str,
    new_prefix: &str,
) -> QueryResult<usize> {
    let like_pattern = format!("{}%", old_prefix);
    // SQLite SUBSTR is 1-based; +1 starts just past the matched prefix. Binding
    // the prefix length as a literal i32 keeps it parameterised.
    let prefix_len = old_prefix.chars().count() as i32;
    diesel::sql_query(
        "UPDATE pdf_scene_links SET pdf_path = ? || SUBSTR(pdf_path, ?) WHERE pdf_path LIKE ?",
    )
    .bind::<diesel::sql_types::Text, _>(new_prefix)
    .bind::<diesel::sql_types::Integer, _>(prefix_len + 1)
    .bind::<diesel::sql_types::Text, _>(&like_pattern)
    .execute(conn)
}

/// Remove every Scene-link for a PDF. Called from `delete_pdf` — a deleted PDF's
/// links have no referent, and unlike a Scene (whose deletion cascades) the PDF is
/// not a DB row, so the cleanup is explicit here. Returns the rows removed.
pub fn delete_links_for_pdf(conn: &mut SqliteConnection, pdf_path: &str) -> QueryResult<usize> {
    diesel::delete(pdf_scene_links::table.filter(pdf_scene_links::pdf_path.eq(pdf_path)))
        .execute(conn)
}

/// Remove Scene-links whose PDF no longer exists on disk. A PDF deleted or moved
/// outside the app never runs `delete_pdf`/`rename_pdf`, so its path-keyed rows
/// (no FK to the filesystem, ADR-0011) would otherwise linger forever — and a
/// different PDF later dropped at the same path would inherit them. Called from
/// `open_ledger` in the check-and-skip setup category (distinct paths, one stat
/// each). Returns the rows removed.
pub fn sweep_orphaned_links(
    conn: &mut SqliteConnection,
    ledger_path: &std::path::Path,
) -> QueryResult<usize> {
    let paths: Vec<String> = pdf_scene_links::table
        .select(pdf_scene_links::pdf_path)
        .distinct()
        .load(conn)?;
    let orphaned: Vec<String> = paths
        .into_iter()
        .filter(|p| !ledger_path.join(p).exists())
        .collect();
    if orphaned.is_empty() {
        return Ok(0);
    }
    diesel::delete(pdf_scene_links::table.filter(pdf_scene_links::pdf_path.eq_any(&orphaned)))
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
    fn test_update_relinks_scene_only() {
        let mut conn = setup_db();
        let from = make_scene(&mut conn, "Tavern");
        let to = make_scene(&mut conn, "Forest");
        let link = make_link(&mut conn, "a.pdf", 1, from.id);

        let updated = diesel::update(pdf_scene_links::table.find(link.id))
            .set(pdf_scene_links::scene_id.eq(to.id))
            .returning(PdfSceneLink::as_returning())
            .get_result::<PdfSceneLink>(&mut conn)
            .unwrap();

        // The Scene swaps; the anchor (page + offsets + quote) is untouched.
        assert_eq!(updated.scene_id, to.id, "re-linked to the new Scene");
        assert_eq!(updated.page, link.page);
        assert_eq!(updated.start_offset, link.start_offset);
        assert_eq!(updated.end_offset, link.end_offset);
        assert_eq!(updated.quote, link.quote);
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
    fn test_rewrite_pdf_path_prefix_follows_folder_move() {
        let mut conn = setup_db();
        let scene = make_scene(&mut conn, "Scene");
        // Two PDFs inside the moved folder, one nested deeper, plus a sibling
        // folder that merely shares a name prefix — that one must NOT move.
        make_link(&mut conn, "creatures/dragon.pdf", 1, scene.id);
        make_link(&mut conn, "creatures/lair/map.pdf", 2, scene.id);
        // A path that repeats the folder name deeper — the interior segment must
        // survive (the rewrite is anchored to the leading prefix, not a blanket
        // REPLACE that would also rewrite the inner "creatures/").
        make_link(&mut conn, "creatures/creatures/inner.pdf", 1, scene.id);
        make_link(&mut conn, "creatures-extra/orc.pdf", 1, scene.id);

        let rewritten = rewrite_pdf_path_prefix(&mut conn, "creatures/", "beasts/").unwrap();
        assert_eq!(rewritten, 3, "only links under the moved folder are re-keyed");

        let moved: Vec<PdfSceneLink> = pdf_scene_links::table
            .filter(pdf_scene_links::pdf_path.like("beasts/%"))
            .order(pdf_scene_links::pdf_path.asc())
            .load(&mut conn)
            .unwrap();
        assert_eq!(
            moved.iter().map(|l| l.pdf_path.as_str()).collect::<Vec<_>>(),
            vec![
                "beasts/creatures/inner.pdf",
                "beasts/dragon.pdf",
                "beasts/lair/map.pdf",
            ],
            "direct, nested, and repeated-name PDFs follow the move with interiors intact",
        );

        let sibling: Vec<PdfSceneLink> = pdf_scene_links::table
            .filter(pdf_scene_links::pdf_path.eq("creatures-extra/orc.pdf"))
            .load(&mut conn)
            .unwrap();
        assert_eq!(sibling.len(), 1, "the name-prefix sibling folder is untouched");
    }

    #[test]
    fn test_sweep_orphaned_links_removes_only_missing_pdfs() {
        let mut conn = setup_db();
        let scene = make_scene(&mut conn, "Scene");
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("present.pdf"), b"%PDF-1.4").unwrap();

        make_link(&mut conn, "present.pdf", 1, scene.id);
        make_link(&mut conn, "gone.pdf", 1, scene.id);
        make_link(&mut conn, "gone.pdf", 2, scene.id);

        let removed = sweep_orphaned_links(&mut conn, dir.path()).unwrap();
        assert_eq!(removed, 2, "both rows for the missing PDF are swept");

        let all: Vec<PdfSceneLink> = pdf_scene_links::table.load(&mut conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].pdf_path, "present.pdf", "the existing PDF keeps its links");
    }

    #[test]
    fn test_sweep_orphaned_links_noop_when_all_present() {
        let mut conn = setup_db();
        let scene = make_scene(&mut conn, "Scene");
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.pdf"), b"%PDF-1.4").unwrap();
        make_link(&mut conn, "a.pdf", 1, scene.id);

        let removed = sweep_orphaned_links(&mut conn, dir.path()).unwrap();
        assert_eq!(removed, 0);
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
