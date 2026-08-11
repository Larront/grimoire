use crate::commands::import::{reconcile_notes_with_disk, FailedImport};
use crate::commands::templates::inject_builtin_templates;
use crate::db;
use crate::format_migration::{MigrationPlan, MigrationReport};
use crate::db::models::{Map, NewPinCategory, Scene};
use diesel::SqliteConnection;
use crate::db::schema::{maps, notes, pin_categories, scenes};
use crate::ledger::AppLedger;
use diesel::prelude::*;
use std::path::PathBuf;
use tauri::{AppHandle, State};

pub(crate) fn seed_default_categories(conn: &mut SqliteConnection) -> Result<(), String> {
    let count: i64 = pin_categories::table
        .filter(pin_categories::map_id.is_null())
        .count()
        .get_result(conn)
        .map_err(|e| e.to_string())?;

    if count > 0 {
        return Ok(());
    }

    // Every field here is read by the frontend against a closed set: `icon` must be a key of
    // CURATED_ICON_COMPONENTS and `shape` a member of PinShape, both in
    // src/lib/components/map/pinAppearance.ts. Rust writes free strings and TypeScript holds
    // the union, so nothing in either compiler connects the two — an icon named here that
    // does not exist there draws a marker with a hole in the middle, silently, in every
    // ledger anyone creates. `default_categories_name_icons_and_shapes_the_frontend_has`
    // over in the test module is the only thing standing between those two lists.
    //
    // Shape carries meaning as much as the icon does — a headstone for the places that are
    // finished, a banner for the ones that hold a seat. None of them is `circle` or
    // `diamond`, which are the two shapes anchored on their own centre: they sit *over* the
    // point rather than beside it, so the marker hides the drawing of the thing it names.
    // Both remain available to pick by hand, where covering a spot on purpose is the point.
    let defaults: Vec<NewPinCategory> = vec![
        NewPinCategory { map_id: None, name: "Town",              icon: "house",     color: "#c4843a", shape: "pin" },
        NewPinCategory { map_id: None, name: "City",              icon: "castle",    color: "#e0b44a", shape: "banner" },
        NewPinCategory { map_id: None, name: "Cave",              icon: "mountain",  color: "#8b6abf", shape: "pin" },
        NewPinCategory { map_id: None, name: "Dungeon",           icon: "skull",     color: "#cf4545", shape: "headstone" },
        NewPinCategory { map_id: None, name: "Ruin",              icon: "landmark",  color: "#7a8499", shape: "headstone" },
        NewPinCategory { map_id: None, name: "Forest",            icon: "tree-pine", color: "#4a9b5a", shape: "pin" },
        NewPinCategory { map_id: None, name: "Point of Interest", icon: "star",      color: "#6a9b87", shape: "pin" },
    ];

    diesel::insert_into(pin_categories::table)
        .values(&defaults)
        .execute(conn)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(serde::Serialize, specta::Type)]
pub struct OpenLedgerResult {
    pub path: String,
    #[specta(type = i32)]
    pub note_count: i64,
    #[specta(type = i32)]
    pub scene_count: i64,
    #[specta(type = i32)]
    pub map_count: i64,
    pub failed_imports: Vec<FailedImport>,
    /// Set when the database was auto-restored from the `.grimoire/backups`
    /// snapshot after corruption (issue #116) — the snapshot's RFC 3339 date,
    /// so the frontend can toast "scenes and pins reflect <date>".
    pub recovered_from_backup: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub fn open_ledger(
    path: String,
    app: AppHandle,
    ledger: State<AppLedger>,
) -> Result<OpenLedgerResult, String> {
    let ledger_path = PathBuf::from(&path);

    if !ledger_path.exists() {
        std::fs::create_dir_all(&ledger_path)
            .map_err(|e| format!("Failed to create ledger directory: {}", e))?;
    }

    // Lock/corruption posture (issue #116): a locked DB waited out a 5s busy
    // timeout and surfaces as ERR_DB_LOCKED; a corrupt DB auto-restores from
    // the last known-good snapshot when one exists (the damaged file is kept
    // aside), otherwise ERR_DB_CORRUPT sends the frontend to the rebuild
    // dialog — real scene/pin loss is never silently accepted.
    let (mut conn, recovered) = match db::open_validated_connection(&ledger_path) {
        Ok(conn) => (conn, None),
        Err(db::DbOpenError::Corrupt(detail)) => {
            log::warn!("[open_ledger] database failed validation: {detail}");
            match db::restore_from_snapshot(&ledger_path)? {
                Some(taken_at) => {
                    log::info!("[open_ledger] restored database from snapshot taken {taken_at}");
                    let conn =
                        db::open_validated_connection(&ledger_path).map_err(|e| e.message())?;
                    (conn, Some(taken_at))
                }
                None => return Err(format!("ERR_DB_CORRUPT: {detail}")),
            }
        }
        Err(e) => return Err(e.message()),
    };

    // The [[Ledger Format Version]] gate (ADR-0017). Placed here rather than
    // deeper because it must see the GM's *notes* untouched — but after the
    // database opened above, which is Grimoire's own store migrating on its own
    // silent terms. On a behind vault this refuses with
    // ERR_FORMAT_MIGRATION_REQUIRED and the frontend takes over: it asks
    // `plan_format_migration` what would change, and a yes comes back through
    // `migrate_ledger_format`. A decline leaves this refusal standing.
    //
    // The scan's context is read from the database opened above — Scene's rewrite
    // needs scene names, which no amount of reading a note can supply.
    let cleared = crate::format_version::enforce_at_open(
        &ledger_path,
        &crate::format_migration::MigrationContext::load(&mut conn),
    )?;

    finish_open(path, ledger_path, conn, recovered, &app, &ledger, cleared)
}

/// What the consent prompt is built from, or `None` when no pending migration
/// finds work — in which case there is no prompt at all and `open_ledger` will
/// have stamped the vault forward in silence.
///
/// This is [`crate::format_migration::run`] with the write left off, so the
/// numbers and sentences shown to the GM are the ones the rewrite will use.
#[tauri::command]
#[specta::specta]
pub fn plan_format_migration(path: String) -> Result<Option<MigrationPlan>, String> {
    let ledger_path = PathBuf::from(path);
    // Its own connection, because this command is reached from a *refused* open and
    // therefore holds nothing: the ledger state has no database on it. `open_ledger`
    // got this far, so the database opens.
    let mut conn = db::open_validated_connection(&ledger_path).map_err(|e| e.message())?;
    crate::format_migration::plan(
        &ledger_path,
        &crate::format_migration::MigrationContext::load(&mut conn),
    )
}

/// The GM said yes: back the affected notes up, rewrite them, write the report,
/// and open the ledger.
///
/// The plan is **recomputed here** rather than taken from what the prompt showed
/// — the vault may have changed while the dialog sat on screen, so a stale list
/// can never decide which files are edited (the same rule as
/// `apply_backlink_rewrite`).
///
/// The vault opens even when some notes could not be rewritten: consent was
/// given and the casualties are named in the returned report. What a partial
/// failure withholds is the *stamp*, so the next open finds the remainder.
#[tauri::command]
#[specta::specta]
pub fn migrate_ledger_format(
    path: String,
    app: AppHandle,
    ledger: State<AppLedger>,
) -> Result<MigrateFormatResult, String> {
    let ledger_path = PathBuf::from(&path);

    // The database first, as on every other open: Grimoire's own store migrates
    // on its own silent terms, and the notes pass must not be the thing that
    // discovers the database is unopenable. Then the notes — before the reconcile
    // and the index walk inside `finish_open` see them, and before the watcher it
    // starts can read Grimoire's own rewrites back as external edits.
    let mut conn = db::open_validated_connection(&ledger_path).map_err(|e| e.message())?;
    let ctx = crate::format_migration::MigrationContext::load(&mut conn);
    let (_, report) = crate::format_migration::run(&ledger_path, &ctx, true)?;
    let report = report.ok_or("The migration reported nothing")?;

    // The notes pass has finished, so this open may proceed past the gate even
    // though a partial failure will have left the stamp behind.
    let cleared = crate::format_version::cleared_by_consented_migration();
    let ledger_result = finish_open(path, ledger_path, conn, None, &app, &ledger, cleared)?;

    Ok(MigrateFormatResult {
        report,
        ledger: ledger_result,
    })
}

#[derive(serde::Serialize, specta::Type)]
pub struct MigrateFormatResult {
    pub report: MigrationReport,
    pub ledger: OpenLedgerResult,
}

/// Recreate the ledger database from scratch after the GM confirmed the
/// rebuild dialog (corrupt DB, no usable snapshot). The damaged file is moved
/// aside — never deleted — then the normal open flow recovers every note from
/// its markdown file via the ledger scan. Scenes, pins, and map metadata are
/// SQLite-canonical and cannot be recovered this way; the dialog said so.
#[tauri::command]
#[specta::specta]
pub fn rebuild_ledger_db(
    path: String,
    app: AppHandle,
    ledger: State<AppLedger>,
) -> Result<OpenLedgerResult, String> {
    let ledger_path = PathBuf::from(&path);
    db::move_corrupt_db_aside(&ledger_path)?;
    let mut conn = db::open_validated_connection(&ledger_path).map_err(|e| e.message())?;
    let cleared = crate::format_version::enforce_at_open(
        &ledger_path,
        &crate::format_migration::MigrationContext::load(&mut conn),
    )?;
    finish_open(path, ledger_path, conn, None, &app, &ledger, cleared)
}

fn finish_open(
    path: String,
    ledger_path: PathBuf,
    mut conn: SqliteConnection,
    recovered_from_backup: Option<String>,
    app: &AppHandle,
    ledger: &State<AppLedger>,
    // The [[Ledger Format Version]] gate (ADR-0017), as a value rather than a
    // call: every caller has to have satisfied it to reach here, so a future code
    // path that opens a ledger without asking does not compile. The notes pass it
    // stands for therefore runs after the database opened, before the reconcile
    // and index walk below, and before the watcher starts at the end — or
    // Grimoire's own migration writes would arrive back as external edits.
    _format_cleared: crate::format_version::FormatCleared,
) -> Result<OpenLedgerResult, String> {
    inject_builtin_templates(&ledger_path)?;
    seed_default_categories(&mut conn)?;

    // Prune maps abandoned mid-creation: a map row is inserted as soon as the
    // user clicks "New Map", but only becomes navigable (file tree, image) once
    // an image is assigned. An imageless map is invisible everywhere except the
    // graph view, so sweep them here to catch ones left by a crash or force-quit.
    diesel::delete(maps::table.filter(maps::image_path.is_null()))
        .execute(&mut conn)
        .map_err(|e| e.to_string())?;

    // Bring the notes table into agreement with on-disk .md files before the
    // tag/link/search rebuild passes so they see fully-populated rows.
    let import_report = reconcile_notes_with_disk(&ledger_path, &mut conn)?;

    // Scene-links are path-keyed with no FK to the filesystem (ADR-0011); a PDF
    // deleted outside the app leaves its rows behind, so sweep them here.
    match crate::commands::pdf_scene_links::sweep_orphaned_links(&mut conn, &ledger_path) {
        Ok(0) => {}
        Ok(n) => log::info!("[open_ledger] swept {n} orphaned pdf scene-link(s)"),
        Err(e) => log::warn!("[open_ledger] orphaned scene-link sweep failed: {e}"),
    }

    // Single walk: parse each .md file once into DerivedFacets and populate
    // note_tags, note_links, note_aliases, and the Tantivy Search Index.
    // SQLite inserts are chunked/bulk; search failure is non-fatal (ADR-0004).
    let all_maps: Vec<Map> = maps::table.load::<Map>(&mut conn).unwrap_or_default();
    let all_scenes: Vec<Scene> = scenes::table.load::<Scene>(&mut conn).unwrap_or_default();
    let search_index = crate::note_index::rebuild_all_from_ledger(
        &ledger_path,
        &mut conn,
        &all_maps,
        &all_scenes,
    )?;
    // Per ADR-0004: a successful rebuild clears any persisted stale marker
    // (written by reconcile/remove on a Tantivy failure); a failure leaves it
    // in place so the next launch retries.
    crate::note_index::clear_stale_marker_if_rebuilt(&ledger_path, search_index.is_some());

    // PDFs are loose, path-addressed files (ADR-0011) with no `notes` row, so they
    // are counted off disk and folded into the note count — the welcome screen's
    // "N notes" stat reads PDFs as notes (the recent-ledger entry persists this
    // combined value; see ledger.svelte.ts).
    let pdf_count = crate::commands::import::count_pdf_files(&ledger_path) as i64;
    let note_count: i64 = notes::table
        .count()
        .get_result(&mut conn)
        .unwrap_or(0)
        + pdf_count;
    let scene_count: i64 = scenes::table
        .count()
        .get_result(&mut conn)
        .unwrap_or(0);
    let map_count: i64 = maps::table
        .count()
        .get_result(&mut conn)
        .unwrap_or(0);

    // Snapshot the now-known-good database (issue #116). Best-effort — a
    // failed snapshot must never block an open.
    if let Err(e) = db::write_snapshot(&mut conn, &ledger_path) {
        log::warn!("[open_ledger] database snapshot failed: {e}");
    }

    // Drop any write hashes remembered for a previously-open ledger before this
    // one's watcher (started below) can start matching against them.
    crate::note_write::reset_recent_writes();

    {
        let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
        state.path = Some(ledger_path.clone());
        state.connection = Some(conn);
        state.search_index = search_index;
    }

    // Start (or re-root) the external-file watcher now that the ledger state is
    // live (ADR-0013). Done outside the lock above: the watcher's event handler
    // locks the same `AppLedger`, so we never hold it while touching the watcher.
    crate::ledger_watch::start(app, &ledger_path);

    Ok(OpenLedgerResult {
        path,
        note_count,
        scene_count,
        map_count,
        failed_imports: import_report.failed,
        recovered_from_backup,
    })
}

#[tauri::command]
#[specta::specta]
pub fn get_ledger_path(ledger: State<AppLedger>) -> Option<String> {
    let state = ledger.lock().ok()?;
    state.path.as_ref().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
#[specta::specta]
pub fn close_ledger(app: AppHandle, ledger: State<AppLedger>) -> Result<(), String> {
    // Tear the watcher down first so no event fires against a half-closed ledger.
    crate::ledger_watch::stop(&app);

    let mut state = ledger.lock().map_err(|e| e.to_string())?;
    state.connection = None;
    state.path = None;
    state.search_index = None;
    state.pending_spotify_verifier = None;
    state.pending_spotify_state = None;
    // spotify_client_id is intentionally kept — it is app-level config, not ledger-specific
    Ok(())
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    #[test]
    fn test_open_ledger_creates_directory() {
        let tmp = tempdir().unwrap();
        let new_dir = tmp.path().join("new_ledger");
        // Just test the directory creation logic directly
        std::fs::create_dir_all(&new_dir).unwrap();
        assert!(new_dir.exists());
    }

    #[test]
    fn stale_marker_cleared_after_successful_rebuild_on_open() {
        let tmp = tempdir().unwrap();
        let ledger_path = tmp.path();
        std::fs::create_dir_all(ledger_path.join(".grimoire")).unwrap();

        // A previous session left a stale marker after a Tantivy write failure.
        crate::note_index::write_search_stale_marker(ledger_path);

        // open_ledger's launch-time reconciliation, with a rebuild that succeeded.
        crate::note_index::clear_stale_marker_if_rebuilt(ledger_path, true);

        assert!(
            !crate::note_index::stale_marker_path(ledger_path).exists(),
            "marker must be cleared after a successful rebuild"
        );
    }

    #[test]
    fn stale_marker_kept_after_failed_rebuild_on_open() {
        let tmp = tempdir().unwrap();
        let ledger_path = tmp.path();
        std::fs::create_dir_all(ledger_path.join(".grimoire")).unwrap();

        crate::note_index::write_search_stale_marker(ledger_path);

        // open_ledger's launch-time reconciliation, with a rebuild that failed.
        crate::note_index::clear_stale_marker_if_rebuilt(ledger_path, false);

        assert!(
            crate::note_index::stale_marker_path(ledger_path).exists(),
            "marker must remain after a failed rebuild"
        );
    }

    /// The default pin categories name an icon and a shape the frontend has to recognise.
    ///
    /// This reads the TypeScript, which is unusual and deliberate. The two lists are a
    /// contract across a language boundary that neither compiler can see: `seed_default_
    /// categories` writes `&str`, the frontend narrows to a closed union, and a name that
    /// exists on one side and not the other fails silently — the marker renders, correctly
    /// coloured and positioned, with nothing inside it. Three of the seven defaults shipped
    /// that way (Cave, Ruin, Point of Interest) until someone looked closely at a map.
    ///
    /// Parsing source with a regex is a poor way to know a fact, so this asserts it found
    /// all seven categories before it checks any of them: a table that has been reformatted
    /// past recognition fails loudly here rather than quietly passing on nothing.
    #[test]
    fn default_categories_name_icons_and_shapes_the_frontend_has() {
        let appearance = std::fs::read_to_string(
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../src/lib/components/map/pinAppearance.ts"),
        )
        .expect("pinAppearance.ts must be readable from the crate");
        let ledger_ts = std::fs::read_to_string(
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../src/lib/types/ledger.ts"),
        )
        .expect("ledger.ts must be readable from the crate");

        // Every `["name", Component]` row of CURATED_ICON_COMPONENTS.
        let known_icons: Vec<String> = appearance
            .lines()
            .filter_map(|line| {
                let rest = line.trim().strip_prefix("[\"")?;
                let name = rest.split('"').next()?;
                line.contains("],").then(|| name.to_string())
            })
            .collect();
        assert!(
            known_icons.len() >= 16,
            "expected the curated icon registry, found {known_icons:?}"
        );

        // The PinShape union: the members between `export type PinShape =` and its `;`.
        let shapes_block = ledger_ts
            .split("export type PinShape =")
            .nth(1)
            .and_then(|rest| rest.split(';').next())
            .expect("ledger.ts must declare PinShape");
        let known_shapes: Vec<String> = shapes_block
            .split('"')
            .skip(1)
            .step_by(2)
            .map(str::to_string)
            .collect();
        assert!(
            known_shapes.len() >= 6,
            "expected the PinShape union, found {known_shapes:?}"
        );

        // The seed table itself, read the same way a reviewer reads it.
        //
        // The needle is assembled at runtime rather than written as one literal, because
        // this file is reading itself: spelled out in full, the line doing the searching
        // matches the search, and the test parses its own filter as an eighth category.
        let source = include_str!("ledger.rs");
        let needle = format!("NewPinCategory {{ map_id{}", ": None");
        let seeded: Vec<(String, String, String)> = source
            .lines()
            .filter(|line| line.contains(&needle))
            .map(|line| {
                let field = |key: &str| {
                    line.split(&format!("{key}: \""))
                        .nth(1)
                        .and_then(|rest| rest.split('"').next())
                        .unwrap_or_else(|| panic!("no {key} in default category line: {line}"))
                        .to_string()
                };
                (field("name"), field("icon"), field("shape"))
            })
            .collect();
        assert_eq!(
            seeded.len(),
            7,
            "expected 7 default categories, parsed {seeded:?}"
        );

        for (name, icon, shape) in &seeded {
            assert!(
                known_icons.contains(icon),
                "default category '{name}' uses icon '{icon}', which CURATED_ICON_COMPONENTS \
                 does not have — its marker will draw empty"
            );
            assert!(
                known_shapes.contains(shape),
                "default category '{name}' uses shape '{shape}', which PinShape does not have"
            );
            assert!(
                shape != "circle" && shape != "diamond",
                "default category '{name}' uses '{shape}', which anchors on its own centre \
                 and covers the place it marks; those two are for deliberate hand-picking"
            );
        }
    }
}
