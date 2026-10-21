use crate::db::models::{
    NewMap, NewPdfSceneLink, NewPin, NewScene, NewSceneSlot, Scene, UpdateSceneThumbnail,
};
use crate::db::schema::{
    maps, notes, pdf_scene_links, pin_categories, pins, quick_notes, scene_slots, scenes,
};
use crate::ledger::AppLedger;
use diesel::prelude::*;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Recursively copies src into dst, creating dst if it does not exist.
/// If dst already exists it is removed first (reset-to-pristine semantics).
pub fn copy_dir_tree(src: &Path, dst: &Path) -> Result<(), String> {
    if dst.exists() {
        std::fs::remove_dir_all(dst)
            .map_err(|e| format!("Failed to remove existing sandbox: {}", e))?;
    }
    std::fs::create_dir_all(dst)
        .map_err(|e| format!("Failed to create sandbox directory: {}", e))?;
    for entry in std::fs::read_dir(src)
        .map_err(|e| format!("Failed to read source directory {:?}: {}", src, e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_tree(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("Failed to copy {:?}: {}", src_path, e))?;
        }
    }
    Ok(())
}

/// Resets the sandbox to a pristine copy of `src`, first letting go of it if it
/// is still the open ledger.
///
/// The frontend closes the sample before exploring it again, but a webview
/// reload returns it to the Splash without ever calling `close_ledger` — the
/// backend is still holding the old sandbox. On Windows its open database and
/// the search index's mapped files make the wipe fail with os error 32 until
/// the app restarts, so the reset closes that ledger itself: `stop_watcher`
/// first, as `close_ledger` does, then the state. Any other open ledger is left
/// alone — the frontend is still showing it until the sample opens.
fn reset_sandbox(
    src: &Path,
    sandbox: &Path,
    ledger: &AppLedger,
    stop_watcher: impl FnOnce(),
) -> Result<(), String> {
    let same = |a: &Path, b: &Path| match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    };
    let sandbox_is_open = ledger
        .lock()
        .map_err(|_| crate::ledger::ERR_LOCK_POISONED)?
        .path
        .as_deref()
        .is_some_and(|open| same(open, sandbox));

    if sandbox_is_open {
        stop_watcher();
        ledger
            .lock()
            .map_err(|_| crate::ledger::ERR_LOCK_POISONED)?
            .close();
    }

    copy_dir_tree(src, sandbox)
}

/// Seeds the Ashfen Region map, its default pin categories, and three pins into the
/// already-open connection. Idempotent: skips if any map rows already exist.
/// Must be called after `seed_default_categories` and `reconcile_notes_with_disk`
/// so that pin_categories and notes rows are present for ID lookups.
pub fn seed_sample_world_maps(conn: &mut SqliteConnection) -> Result<(), String> {
    let map_count: i64 = maps::table
        .count()
        .get_result(conn)
        .map_err(|e| e.to_string())?;
    if map_count > 0 {
        return Ok(());
    }

    let map: crate::db::models::Map = diesel::insert_into(maps::table)
        .values(&NewMap {
            title: "Ashfen Region",
            image_path: Some("Maps/ashfen-region.webp"),
            image_width: Some(1200),
            image_height: Some(896),
        })
        .returning(crate::db::models::Map::as_returning())
        .get_result(conn)
        .map_err(|e| format!("Failed to insert sample map: {}", e))?;

    // Resolve global category IDs seeded by seed_default_categories.
    let ruin_id: Option<i32> = pin_categories::table
        .filter(
            pin_categories::name
                .eq("Ruin")
                .and(pin_categories::map_id.is_null()),
        )
        .select(pin_categories::id)
        .first(conn)
        .optional()
        .map_err(|e| e.to_string())?;

    let town_id: Option<i32> = pin_categories::table
        .filter(
            pin_categories::name
                .eq("Town")
                .and(pin_categories::map_id.is_null()),
        )
        .select(pin_categories::id)
        .first(conn)
        .optional()
        .map_err(|e| e.to_string())?;

    let poi_id: Option<i32> = pin_categories::table
        .filter(
            pin_categories::name
                .eq("Point of Interest")
                .and(pin_categories::map_id.is_null()),
        )
        .select(pin_categories::id)
        .first(conn)
        .optional()
        .map_err(|e| e.to_string())?;

    // Resolve note IDs for linked pins.
    let keep_id: Option<i32> = notes::table
        .filter(notes::path.eq("Locations/The Ember Keep.md"))
        .select(notes::id)
        .first(conn)
        .optional()
        .map_err(|e| e.to_string())?;

    let thornhaven_id: Option<i32> = notes::table
        .filter(notes::path.eq("Locations/Thornhaven Village.md"))
        .select(notes::id)
        .first(conn)
        .optional()
        .map_err(|e| e.to_string())?;

    let mira_id: Option<i32> = notes::table
        .filter(notes::path.eq("Characters/Mira Ashvale.md"))
        .select(notes::id)
        .first(conn)
        .optional()
        .map_err(|e| e.to_string())?;

    // Fractions of the sheet, measured off the drawing rather than chosen: each one is the
    // place itself — the keep's courtyard, the village's central hall, the reed island with
    // the tent on it. A pin a few percent out lands in open bog beside the thing it names,
    // which is the one way this map can still look wrong after being drawn correctly.
    //
    // **`y` is measured from the BOTTOM of the image, not the top.** The canvas is Leaflet
    // on `CRS.Simple` with bounds `[[0, 0], [height, width]]`, so a pin's `y` is a latitude:
    // 0 is the bottom edge and 1 the top. Read these numbers off an image viewer, which
    // counts down from the top, and every pin lands at `1 - y` — mirrored about the middle,
    // near enough to look deliberate and wrong enough to put the village in the marsh. That
    // is not hypothetical; it is what the first pass at these numbers did.
    let pin_data = [
        (
            0.723_f32,
            0.286_f32,
            "The Ember Keep",
            ruin_id,
            keep_id,
        ),
        (
            0.397_f32,
            0.788_f32,
            "Thornhaven Village",
            town_id,
            thornhaven_id,
        ),
        (
            0.682_f32,
            0.447_f32,
            "Mira's Camp",
            poi_id,
            mira_id,
        ),
    ];

    for (x, y, title, category_id, note_id) in &pin_data {
        diesel::insert_into(pins::table)
            .values(&NewPin {
                map_id: map.id,
                x: *x,
                y: *y,
                title,
                description: None,
                category_id: *category_id,
                note_id: *note_id,
            })
            .execute(conn)
            .map_err(|e| format!("Failed to insert pin '{}': {}", title, e))?;
    }

    Ok(())
}

/// Seeds two layered Scenes — "Boss Battle" and "Town Market" — each composed of a
/// looping music bed plus a quieter looping ambience overlay, into the already-open
/// connection. Audio is referenced as `local` slot sources whose `source_id` is a
/// ledger-relative path under `.grimoire/audio/` (matching `copy_audio_file`), so the
/// scenes resolve identically to user-imported audio and stay portable.
/// Idempotent: skips if any scene rows already exist.
///
/// A scene's thumbnail art is picked up from `.grimoire/thumbnails/<slug>.<ext>` in the
/// copied sandbox when the bundle carries one (`boss-battle`, `town-market`; webp, jpg,
/// jpeg or png), and left unset when it does not — so art can be dropped into
/// `sample-world/.grimoire/thumbnails/` without touching this code, and a missing file is
/// never a broken image.
pub fn seed_sample_world_scenes(conn: &mut SqliteConnection, ledger_root: &Path) -> Result<(), String> {
    let scene_count: i64 = scenes::table
        .count()
        .get_result(conn)
        .map_err(|e| e.to_string())?;
    if scene_count > 0 {
        return Ok(());
    }

    // (scene name, [(label, file, volume) for bed then ambience])
    let scene_data = [
        (
            "Boss Battle",
            [
                ("Final Battle of the Dark Wizards", "Final Battle of the Dark Wizards.mp3", 0.8_f32),
                ("Heavy Rain", "Heavy Rain With Thunder 10.wav", 0.5_f32),
            ],
        ),
        (
            "Town Market",
            [
                ("Folk Round", "Folk Round.mp3", 0.8_f32),
                ("Crowd Noise", "Crowd Walla 11.wav", 0.5_f32),
            ],
        ),
    ];

    for (scene_name, slots) in &scene_data {
        let scene: Scene = diesel::insert_into(scenes::table)
            .values(NewScene { name: scene_name.to_string() })
            .returning(Scene::as_returning())
            .get_result(conn)
            .map_err(|e| format!("Failed to insert sample scene '{}': {}", scene_name, e))?;

        if let Some(thumb) = sample_scene_thumbnail(ledger_root, scene_name) {
            diesel::update(scenes::table.find(scene.id))
                .set(UpdateSceneThumbnail {
                    thumbnail_path: Some(thumb),
                    thumbnail_color: None,
                    thumbnail_icon: None,
                })
                .execute(conn)
                .map_err(|e| format!("Failed to set thumbnail for '{}': {}", scene_name, e))?;
        }

        for (slot_order, (label, file, volume)) in slots.iter().enumerate() {
            diesel::insert_into(scene_slots::table)
                .values(NewSceneSlot {
                    scene_id: scene.id,
                    source: "local".to_string(),
                    source_id: format!(".grimoire/audio/{}", file),
                    label: label.to_string(),
                    volume: *volume,
                    is_loop: true,
                    slot_order: slot_order as i32,
                    shuffle: false,
                })
                .execute(conn)
                .map_err(|e| {
                    format!("Failed to insert slot '{}' for scene '{}': {}", label, scene_name, e)
                })?;
        }
    }

    Ok(())
}

/// The ledger-relative path of a sample scene's bundled thumbnail, if the sandbox has
/// one: `Boss Battle` → `.grimoire/thumbnails/boss-battle.webp` (or .jpg/.jpeg/.png).
fn sample_scene_thumbnail(ledger_root: &Path, scene_name: &str) -> Option<String> {
    let slug = scene_name.to_lowercase().replace(' ', "-");
    ["webp", "jpg", "jpeg", "png"].iter().find_map(|ext| {
        let rel = format!(".grimoire/thumbnails/{}.{}", slug, ext);
        ledger_root.join(&rel).is_file().then_some(rel)
    })
}

/// Seeds the one Quick Note the sample world ships with, into the already-open
/// connection. A Quick Note is a row and not a note ([ADR-0018](../../../docs/adr/0018-quick-notes-are-rows-not-notes.md)),
/// so the sample — which travels as a plain resource tree with no database — has to
/// seed it in code, the way `seed_sample_world_maps` and `seed_sample_world_scenes`
/// already do for its other non-file entities.
///
/// One line, not a tutorial and not a list of examples: a thought a GM might actually
/// have parked mid-session, which happens to carry a working wikilink so the pen
/// demonstrates that a `[[link]]` typed into it is drawn and clickable. The target is a
/// note the sample really contains — a link that resolved to nothing would teach the
/// wrong lesson about the one thing this Quick Note exists to show.
///
/// Idempotent: skips if any quick_notes rows already exist.
pub fn seed_sample_world_quick_notes(conn: &mut SqliteConnection) -> Result<(), String> {
    let existing: i64 = quick_notes::table
        .count()
        .get_result(conn)
        .map_err(|e| e.to_string())?;
    if existing > 0 {
        return Ok(());
    }

    crate::commands::quick_notes::insert_quick_note(
        conn,
        "[[Mira Ashvale]] should already know about the marsh fires — check what she'd have heard.",
    )?;

    Ok(())
}

/// The one Scene-link the sample PDF ships with: the page-1 heading where the fight in
/// "The Shadow in the Hall" begins, linked to Boss Battle. A first-time GM opening the
/// PDF should find a passage that already plays — the link, its margin marker and the
/// Scenes list are how they learn that a page can carry sound.
///
/// The offsets index the page's text exactly as the viewer does (PDF.js text items,
/// concatenated). Nothing in Rust reads PDFs, so `src/test/sample-pdf-link.test.ts`
/// reads these values out of this file and checks them against the bundled PDF — an
/// edited PDF or a mistyped offset fails there, instead of the sample showing its
/// first-time GM a link marked "the text here has changed".
pub struct SamplePdfLink {
    pub pdf_path: &'static str,
    pub page: i32,
    pub start_offset: i32,
    pub end_offset: i32,
    pub quote: &'static str,
    pub scene: &'static str,
}

pub const SAMPLE_PDF_LINK: SamplePdfLink = SamplePdfLink {
    pdf_path: "Encounters/The Shadow in the Hall.pdf",
    page: 1,
    start_offset: 1688,
    end_offset: 1704,
    quote: "Running the Hunt",
    scene: "Boss Battle",
};

/// Seeds `SAMPLE_PDF_LINK`. Runs after `seed_sample_world_scenes`, whose Boss Battle it
/// links to. Idempotent: skips if any Scene-link rows already exist.
pub fn seed_sample_world_pdf_links(conn: &mut SqliteConnection) -> Result<(), String> {
    let existing: i64 = pdf_scene_links::table
        .count()
        .get_result(conn)
        .map_err(|e| e.to_string())?;
    if existing > 0 {
        return Ok(());
    }

    let link = &SAMPLE_PDF_LINK;
    let scene_id: i32 = scenes::table
        .filter(scenes::name.eq(link.scene))
        .select(scenes::id)
        .first(conn)
        .map_err(|e| format!("Sample scene '{}' for the PDF link not found: {}", link.scene, e))?;

    diesel::insert_into(pdf_scene_links::table)
        .values(NewPdfSceneLink {
            pdf_path: link.pdf_path.to_string(),
            page: link.page,
            start_offset: link.start_offset,
            end_offset: link.end_offset,
            quote: link.quote.to_string(),
            scene_id,
        })
        .execute(conn)
        .map_err(|e| format!("Failed to seed the sample PDF's Scene-link: {}", e))?;

    Ok(())
}

/// Copies the bundled sample-world resource tree to a writable sandbox at
/// `app_data_dir/sample-world/`, wipes any prior sandbox, pre-seeds the
/// database with the sample map and pins, and returns the sandbox path.
/// The frontend follows up with `open_ledger` (which rebuilds derived indexes)
/// and skips `add_recent_ledger` to keep the sample ephemeral.
#[tauri::command]
#[specta::specta]
pub fn explore_sample_ledger(app: AppHandle) -> Result<String, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource directory: {}", e))?;
    let sample_src = resource_dir.join("sample-world");

    if !sample_src.exists() {
        return Err(format!(
            "Bundled sample-world not found at {:?}",
            sample_src
        ));
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    let sample_dst = app_data_dir.join("sample-world");

    reset_sandbox(&sample_src, &sample_dst, &app.state::<AppLedger>(), || {
        crate::ledger_watch::stop(&app)
    })?;

    // Pre-seed the DB so that the map and pins are present when the frontend's
    // subsequent open_ledger call runs (which only rebuilds derived indexes and
    // would never insert map rows on its own).
    let mut conn = crate::db::establish_connection(&sample_dst)?;
    crate::commands::ledger::seed_default_categories(&mut conn)?;
    crate::commands::import::reconcile_notes_with_disk(&sample_dst, &mut conn)?;
    seed_sample_world_maps(&mut conn)?;
    seed_sample_world_scenes(&mut conn, &sample_dst)?;
    seed_sample_world_quick_notes(&mut conn)?;
    seed_sample_world_pdf_links(&mut conn)?;

    Ok(sample_dst.to_string_lossy().to_string())
}

/// Copies the current (possibly-edited) sandbox at `app_data_dir/sample-world/` to
/// `parent/name/` and returns the destination path. The frontend follows up with the
/// vanilla `open_ledger` path (which records recents and persists prefs) and clears `isSample`.
///
/// Async, and the copy on a blocking thread: the sandbox is tens of megabytes, and a
/// synchronous command runs on the main thread, where it froze the window for as long
/// as the disk took.
#[tauri::command]
#[specta::specta]
pub async fn adopt_sample_ledger(
    parent: String,
    name: String,
    app: AppHandle,
) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    let sandbox = app_data_dir.join("sample-world");

    tauri::async_runtime::spawn_blocking(move || adopt_into(&sandbox, Path::new(&parent), &name))
        .await
        .map_err(|e| format!("Adopt task failed: {}", e))?
        .map(|dest| dest.to_string_lossy().to_string())
}

/// The copy `adopt_sample_ledger` makes, without the app handle.
///
/// **Never onto something that exists.** `copy_dir_tree` clears its destination first,
/// which is right for resetting the sandbox and was a disaster here: a GM naming their
/// world after a folder already in the chosen location had that folder deleted —
/// permanently, not to the Recycle Bin — and replaced with the example (2026-10 design
/// review). The refusal carries a code so the dialog can say it in words.
pub fn adopt_into(sandbox: &Path, parent: &Path, name: &str) -> Result<PathBuf, String> {
    if !sandbox.exists() {
        return Err("No sample sandbox found to adopt — explore the sample first.".to_string());
    }
    let dest = parent.join(name);
    if dest.exists() {
        return Err(format!(
            "LEDGER_EXISTS: '{}' already exists",
            dest.to_string_lossy()
        ));
    }
    copy_dir_tree(sandbox, &dest)?;
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::import::reconcile_notes_with_disk;
    use crate::commands::ledger::seed_default_categories;
    use crate::db::establish_connection;
    use crate::db::schema::{maps, note_links, notes, scene_slots, scenes};
    use crate::ledger::LedgerState;
    use diesel::prelude::*;
    use std::fs;
    use tempfile::tempdir;

    // ── sample scene thumbnails ───────────────────────────────────────────────

    #[test]
    fn sample_scene_thumbnail_is_picked_up_only_when_bundled() {
        let tmp = tempdir().unwrap();
        assert_eq!(sample_scene_thumbnail(tmp.path(), "Boss Battle"), None);

        let dir = tmp.path().join(".grimoire").join("thumbnails");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("boss-battle.jpg"), b"x").unwrap();
        assert_eq!(
            sample_scene_thumbnail(tmp.path(), "Boss Battle").as_deref(),
            Some(".grimoire/thumbnails/boss-battle.jpg")
        );
        assert_eq!(sample_scene_thumbnail(tmp.path(), "Town Market"), None);
    }

    // ── copy_dir_tree ─────────────────────────────────────────────────────────

    #[test]
    fn copy_dir_tree_copies_nested_tree() {
        let src = tempdir().unwrap();
        let dst_parent = tempdir().unwrap();
        let dst = dst_parent.path().join("output");

        fs::create_dir(src.path().join("subdir")).unwrap();
        fs::write(src.path().join("root.md"), "# Root").unwrap();
        fs::write(src.path().join("subdir").join("child.md"), "# Child").unwrap();

        copy_dir_tree(src.path(), &dst).unwrap();

        assert!(dst.join("root.md").exists());
        assert!(dst.join("subdir").join("child.md").exists());
        assert_eq!(fs::read_to_string(dst.join("root.md")).unwrap(), "# Root");
        assert_eq!(
            fs::read_to_string(dst.join("subdir").join("child.md")).unwrap(),
            "# Child"
        );
    }

    #[test]
    fn copy_dir_tree_replaces_existing_destination() {
        let src = tempdir().unwrap();
        let dst_parent = tempdir().unwrap();
        let dst = dst_parent.path().join("output");

        fs::write(src.path().join("first.md"), "First").unwrap();
        copy_dir_tree(src.path(), &dst).unwrap();
        assert!(dst.join("first.md").exists());

        // Change src: remove first.md, add second.md
        fs::remove_file(src.path().join("first.md")).unwrap();
        fs::write(src.path().join("second.md"), "Second").unwrap();
        copy_dir_tree(src.path(), &dst).unwrap();

        assert!(!dst.join("first.md").exists(), "old file must be gone after re-copy");
        assert!(dst.join("second.md").exists());
        assert_eq!(
            fs::read_to_string(dst.join("second.md")).unwrap(),
            "Second"
        );
    }

    // ── reset_sandbox ─────────────────────────────────────────────────────────

    /// A ledger state holding `path` open the way `open_ledger` leaves it: a live
    /// database connection and a search index, both with files under `path`.
    fn opened_at(path: &Path) -> AppLedger {
        let mut state = LedgerState::new(String::new());
        state.connection = Some(establish_connection(path).unwrap());
        state.search_index = Some(crate::search::rebuild_index(path, &[], &[], &[]).unwrap());
        state.path = Some(path.to_path_buf());
        AppLedger::new(state)
    }

    /// Reloading the webview while the sample is open returns the frontend to the
    /// Splash without ever calling `close_ledger`, so the backend is still holding
    /// the sandbox when _Explore an example world_ is clicked again. On Windows the
    /// open database and the index's mapped files make the wipe fail with os error
    /// 32 until the app restarts — the reset has to let go of them first.
    #[test]
    fn reset_sandbox_releases_a_sandbox_that_is_still_open() {
        let src = tempdir().unwrap();
        fs::write(src.path().join("pristine.md"), "# Pristine").unwrap();
        let parent = tempdir().unwrap();
        let sandbox = parent.path().join("sample-world");
        copy_dir_tree(src.path(), &sandbox).unwrap();
        fs::write(sandbox.join("edited.md"), "# Edited").unwrap();

        let ledger = opened_at(&sandbox);
        // A real watcher over the sandbox, as `ledger_watch::start` leaves one:
        // its drop only signals the thread, so the wipe follows it immediately.
        let mut watcher = notify_debouncer_full::new_debouncer(
            std::time::Duration::from_millis(150),
            None,
            |_: notify_debouncer_full::DebounceEventResult| {},
        )
        .unwrap();
        watcher
            .watch(&sandbox, notify_debouncer_full::notify::RecursiveMode::Recursive)
            .unwrap();
        let mut watcher = Some(watcher);
        reset_sandbox(src.path(), &sandbox, &ledger, || drop(watcher.take())).unwrap();

        assert!(watcher.is_none(), "the sandbox's watcher must be stopped before the wipe");
        assert_eq!(
            crate::ledger::ledger_path(&ledger).unwrap_err(),
            crate::ledger::ERR_NO_LEDGER,
            "the wiped sandbox must not still be recorded as the open ledger"
        );
        assert!(sandbox.join("pristine.md").exists());
        assert!(!sandbox.join("edited.md").exists(), "the sandbox must be reset to pristine");
    }

    /// Exploring the sample from the palette while the GM's own ledger is open
    /// must not close it: the frontend still shows it until the sample opens.
    #[test]
    fn reset_sandbox_leaves_another_open_ledger_alone() {
        let src = tempdir().unwrap();
        fs::write(src.path().join("pristine.md"), "# Pristine").unwrap();
        let parent = tempdir().unwrap();
        let sandbox = parent.path().join("sample-world");
        let own = tempdir().unwrap();

        let ledger = opened_at(own.path());
        let mut watcher_stopped = false;
        reset_sandbox(src.path(), &sandbox, &ledger, || watcher_stopped = true).unwrap();

        assert!(!watcher_stopped, "another ledger's watcher must keep running");
        assert_eq!(crate::ledger::ledger_path(&ledger).unwrap(), own.path());
        assert!(sandbox.join("pristine.md").exists());
    }

    /// Adoption — _Make this world mine_ — is `copy_dir_tree` over the whole sandbox, so
    /// everything the sample seeded into its database travels with it. That is worth a test
    /// because a Quick Note has no file: it survives adoption only if `.grimoire/` is copied
    /// along with the notes, and `copy_dir_tree` skipping a dotted directory would take the
    /// pen with it while leaving every visible note in place — a loss the GM would not see
    /// until they went looking for a thought they had parked.
    #[test]
    fn adoption_carries_the_seeded_quick_note() {
        let sandbox = tempdir().unwrap();
        let dest_parent = tempdir().unwrap();
        let dest = dest_parent.path().join("My Ashfen");

        {
            let mut conn = establish_connection(sandbox.path()).unwrap();
            seed_sample_world_quick_notes(&mut conn).unwrap();
        }

        copy_dir_tree(sandbox.path(), &dest).unwrap();

        let mut adopted = establish_connection(&dest).unwrap();
        let carried = crate::commands::quick_notes::load_quick_notes(&mut adopted).unwrap();
        assert_eq!(
            carried.len(),
            1,
            "the seeded Quick Note must survive adoption, got {} rows",
            carried.len()
        );
        assert!(
            carried[0].body.contains("[[Mira Ashvale]]"),
            "the adopted Quick Note lost its text: {:?}",
            carried[0].body
        );
    }

    #[test]
    fn adopt_refuses_a_folder_that_already_exists_and_leaves_it_alone() {
        let sandbox = tempdir().unwrap();
        fs::write(sandbox.path().join("example.md"), "Example").unwrap();
        let parent = tempdir().unwrap();
        let theirs = parent.path().join("Gods Ascendant");
        fs::create_dir(&theirs).unwrap();
        fs::write(theirs.join("session-12.md"), "Their own notes").unwrap();

        let err = adopt_into(sandbox.path(), parent.path(), "Gods Ascendant").unwrap_err();
        assert!(err.starts_with("LEDGER_EXISTS:"), "unexpected error: {err}");
        assert_eq!(
            fs::read_to_string(theirs.join("session-12.md")).unwrap(),
            "Their own notes"
        );
        assert!(!theirs.join("example.md").exists());
    }

    #[test]
    fn adopt_copies_into_a_new_folder_named_for_the_world() {
        let sandbox = tempdir().unwrap();
        fs::write(sandbox.path().join("example.md"), "Example").unwrap();
        let parent = tempdir().unwrap();

        let dest = adopt_into(sandbox.path(), parent.path(), "The Ashfen Vale").unwrap();
        assert_eq!(dest, parent.path().join("The Ashfen Vale"));
        assert!(dest.join("example.md").exists());
    }

    // ── sample world integrity ────────────────────────────────────────────────

    /// Full pipeline test: copy the bundled sample-world fixture into a
    /// tempdir, run the same setup sequence used by explore_sample_ledger +
    /// open_ledger, and assert that the authored content is internally
    /// consistent (correct counts, real links, stub, alias, Timeline fence).
    #[test]
    fn sample_world_integrity() {
        let sample_src =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sample-world");
        assert!(
            sample_src.exists(),
            "sample-world fixture not found at {:?}",
            sample_src
        );

        // Copy fixture to a writable tempdir.
        let tmp = tempdir().unwrap();
        copy_dir_tree(&sample_src, tmp.path()).unwrap();

        // Establish DB + run the open_ledger initialisation pipeline.
        let mut conn = establish_connection(tmp.path()).unwrap();
        seed_default_categories(&mut conn).unwrap();
        let import_report = reconcile_notes_with_disk(tmp.path(), &mut conn).unwrap();

        assert!(
            import_report.failed.is_empty(),
            "expected no import failures, got: {:?}",
            import_report.failed
        );

        seed_sample_world_maps(&mut conn).unwrap();
        seed_sample_world_scenes(&mut conn, tmp.path()).unwrap();
        seed_sample_world_quick_notes(&mut conn).unwrap();
        seed_sample_world_pdf_links(&mut conn).unwrap();

        // Rebuild derived indexes (tags, links, aliases, search).
        let all_maps: Vec<crate::db::models::Map> =
            maps::table.load(&mut conn).unwrap_or_default();
        let all_scenes: Vec<crate::db::models::Scene> =
            scenes::table.load(&mut conn).unwrap_or_default();
        crate::note_index::rebuild_all_from_ledger(
            tmp.path(),
            &mut conn,
            &all_maps,
            &all_scenes,
        )
        .unwrap();

        // ── Note count ───────────────────────────────────────────────────────
        let note_count: i64 = notes::table.count().get_result(&mut conn).unwrap();
        assert_eq!(
            note_count, 10,
            "expected exactly 10 notes, got {note_count}"
        );

        // ── Scenes: 2 layered scenes with resolvable local audio ─────────────
        let scene_count: i64 = scenes::table.count().get_result(&mut conn).unwrap();
        assert_eq!(scene_count, 2, "expected exactly 2 seeded scenes");

        for scene_name in ["Boss Battle", "Town Market"] {
            let scene_id: i32 = scenes::table
                .filter(scenes::name.eq(scene_name))
                .select(scenes::id)
                .first(&mut conn)
                .unwrap_or_else(|_| panic!("scene '{scene_name}' must exist"));

            let slots: Vec<crate::db::models::SceneSlot> = scene_slots::table
                .filter(scene_slots::scene_id.eq(scene_id))
                .order(scene_slots::slot_order.asc())
                .load(&mut conn)
                .unwrap();

            assert!(
                slots.len() >= 2,
                "scene '{scene_name}' must have ≥2 layered slots, got {}",
                slots.len()
            );

            for slot in &slots {
                assert_eq!(
                    slot.source, "local",
                    "scene '{scene_name}' slot '{}' must be a local source",
                    slot.label
                );
                // Audio paths are ledger-relative (portable; no absolute references)…
                assert!(
                    !std::path::Path::new(&slot.source_id).is_absolute(),
                    "slot source_id '{}' must be relative, not absolute",
                    slot.source_id
                );
                // …and must resolve to a real file on disk under the ledger root.
                let resolved = tmp.path().join(&slot.source_id);
                assert!(
                    resolved.exists(),
                    "audio for scene '{scene_name}' slot '{}' not found at {resolved:?}",
                    slot.label
                );
            }
        }

        // ── Quick Notes: exactly one, and its wikilink resolves ──────────────
        //
        // The pen ships with one line, not a list — a GM meeting it should read a
        // thought, not a tutorial. Its `[[wikilink]]` is the whole reason it carries one,
        // so it is resolved here through `resolve_note_target_on_conn`: the same call the
        // pane makes when the GM clicks the link. A rename of the note it points at, or a
        // typo in the seeded line, leaves the sample demonstrating a dead link — which is
        // worse than demonstrating nothing.
        let quick: Vec<crate::db::models::QuickNote> =
            crate::commands::quick_notes::load_quick_notes(&mut conn).unwrap();
        assert_eq!(
            quick.len(),
            1,
            "expected exactly 1 seeded Quick Note, got {}",
            quick.len()
        );

        let body = &quick[0].body;
        let target = body
            .split_once("[[")
            .and_then(|(_, rest)| rest.split_once("]]"))
            .map(|(target, _)| target)
            .unwrap_or_else(|| panic!("the seeded Quick Note must carry a wikilink: {body:?}"));
        let resolved = crate::commands::links::resolve_note_target_on_conn(&mut conn, target)
            .unwrap()
            .unwrap_or_else(|| {
                panic!("the seeded Quick Note's wikilink '[[{target}]]' resolves to nothing")
            });
        assert!(
            tmp.path().join(&resolved.path).exists(),
            "'[[{target}]]' resolved to '{}', which is not a file in the sample",
            resolved.path
        );

        // Seeding is idempotent — explore_sample_ledger runs it on every open of a
        // sandbox that may already hold rows, and a second line would be a second thought
        // the GM never had.
        seed_sample_world_quick_notes(&mut conn).unwrap();
        let quick_count: i64 = crate::db::schema::quick_notes::table
            .count()
            .get_result(&mut conn)
            .unwrap();
        assert_eq!(quick_count, 1, "re-seeding must not add a second Quick Note");

        // ── PDF Scene-link: one, on a PDF the sample ships, to a seeded scene ───
        //
        // Its offsets are checked against the PDF's text by the frontend test named on
        // `SAMPLE_PDF_LINK`; here, that it lands on a real file and a real scene, and
        // that re-seeding (every open of the sandbox) adds no second copy.
        let links: Vec<crate::db::models::PdfSceneLink> =
            pdf_scene_links::table.load(&mut conn).unwrap();
        assert_eq!(links.len(), 1, "expected exactly 1 seeded PDF Scene-link");
        assert!(
            tmp.path().join(&links[0].pdf_path).exists(),
            "the seeded Scene-link's PDF '{}' is not in the sample",
            links[0].pdf_path
        );
        let linked_scene: String = scenes::table
            .find(links[0].scene_id)
            .select(scenes::name)
            .first(&mut conn)
            .unwrap();
        assert_eq!(linked_scene, SAMPLE_PDF_LINK.scene);
        assert_eq!(
            (links[0].end_offset - links[0].start_offset) as usize,
            links[0].quote.chars().count(),
            "the seeded link's offsets must span exactly its quote"
        );
        seed_sample_world_pdf_links(&mut conn).unwrap();
        let link_count: i64 = pdf_scene_links::table.count().get_result(&mut conn).unwrap();
        assert_eq!(link_count, 1, "re-seeding must not add a second Scene-link");

        // ── Map count ────────────────────────────────────────────────────────
        let map_count: i64 = maps::table.count().get_result(&mut conn).unwrap();
        assert_eq!(map_count, 1, "expected exactly 1 map (Ashfen Region)");

        // ── The map's image resolves, at the size its pins were placed against ──
        //
        // Both halves of this have already been wrong once. The seeded `image_path` is a
        // string the compiler never checks against the bundled fixture, so an art swap that
        // changes the extension — or the folder's capitalisation, which a Windows checkout
        // will happily disagree with a Linux one about — leaves a map row pointing at
        // nothing, and the ledger opens on an empty frame. CI runs this on a case-sensitive
        // filesystem, which is exactly where that mistake shows up.
        //
        // The dimensions are load-bearing for a subtler reason: pins are stored as fractions
        // and MapCanvas builds its bounds from these two numbers, so a pair that disagrees
        // with the file stretches every pin away from the thing it names — a map that looks
        // perfectly fine until you notice the keep's pin sitting out in the bog.
        let map: crate::db::models::Map = maps::table.first(&mut conn).unwrap();
        let image_path = map
            .image_path
            .as_deref()
            .expect("the sample map must carry an image path");
        let resolved = tmp.path().join(image_path);
        assert!(
            resolved.exists(),
            "map image '{image_path}' not found at {resolved:?}"
        );
        let (width, height) = image::image_dimensions(&resolved)
            .unwrap_or_else(|e| panic!("map image at {resolved:?} is not readable: {e}"));
        assert_eq!(
            (width as i32, height as i32),
            (
                map.image_width.expect("seeded map must record a width"),
                map.image_height.expect("seeded map must record a height"),
            ),
            "seeded dimensions must match the image on disk, or every pin lands off its mark"
        );

        // ── Pin count ────────────────────────────────────────────────────────
        let pin_count: i64 = crate::db::schema::pins::table
            .count()
            .get_result(&mut conn)
            .unwrap();
        assert_eq!(pin_count, 3, "expected 3 pins on the Ashfen Region map");

        // ── All pins are linked to real notes ────────────────────────────────
        let unlinked_pins: i64 = crate::db::schema::pins::table
            .filter(crate::db::schema::pins::note_id.is_null())
            .count()
            .get_result(&mut conn)
            .unwrap();
        assert_eq!(unlinked_pins, 0, "all 3 pins must link to notes");

        // ── The pins sit where the prose says these places are ───────────────
        //
        // Every note that touches the geography agrees on three things: Thornhaven is on the
        // northern edge of the marsh, the keep is east and south of it — "three hours to the
        // Ember Keep on foot, along the Order's raised stone causeway" — and Mira camps
        // between the two, within sight of the keep's western approach.
        //
        // This is the only part of a hand-placed pin a test can check. Nothing here can know
        // whether a pin landed on the drawn courtyard, but a keep north-west of the village
        // is provably not the map the notes describe. And it is worth checking because it
        // has already been wrong: the first version of these coordinates was measured off an
        // image viewer, which counts y down from the top, against a canvas whose y counts up
        // from the bottom. Mirroring the sheet inverts every one of these relations at once,
        // so this assertion is exactly what fails when someone re-measures them that way.
        let all_pins: Vec<crate::db::models::Pin> = crate::db::schema::pins::table
            .load(&mut conn)
            .unwrap();
        let pin_at = |title: &str| -> &crate::db::models::Pin {
            all_pins
                .iter()
                .find(|p| p.title == title)
                .unwrap_or_else(|| panic!("expected a pin titled '{title}'"))
        };
        let keep = pin_at("The Ember Keep");
        let town = pin_at("Thornhaven Village");
        let camp = pin_at("Mira's Camp");

        assert!(
            town.x < keep.x,
            "Thornhaven lies west of the keep — the causeway runs east to it — but the pins \
             put the village at x {} and the keep at x {}",
            town.x,
            keep.x
        );
        assert!(
            town.y > keep.y,
            "Thornhaven lies north of the keep, and y counts up from the bottom of the sheet, \
             so the village's y ({}) must exceed the keep's ({})",
            town.y,
            keep.y
        );
        assert!(
            camp.x > town.x && camp.x < keep.x && camp.y < town.y && camp.y > keep.y,
            "Mira camps between the village and the keep, in sight of the western approach — \
             camp ({}, {}) is not between Thornhaven ({}, {}) and the keep ({}, {})",
            camp.x,
            camp.y,
            town.x,
            town.y,
            keep.x,
            keep.y
        );

        // ── Stub: The Order of Embers is referenced but not written ──────────
        let stub_links: i64 = note_links::table
            .filter(note_links::target_path.eq("The Order of Embers"))
            .count()
            .get_result(&mut conn)
            .unwrap();
        assert!(
            stub_links >= 1,
            "expected ≥1 link to 'The Order of Embers' stub"
        );

        let stub_note_exists: i64 = notes::table
            .filter(notes::path.eq("The Order of Embers"))
            .count()
            .get_result(&mut conn)
            .unwrap();
        assert_eq!(
            stub_note_exists, 0,
            "'The Order of Embers' must not exist as a real note"
        );

        // ── Alias: Mira Ashvale has alias 'Mira' ─────────────────────────────
        let mira_alias_count: i64 = diesel::dsl::sql::<diesel::sql_types::BigInt>(
            "SELECT COUNT(*) FROM note_aliases \
             WHERE lower(alias) = 'mira' \
             AND note_id = (SELECT id FROM notes WHERE path = 'Characters/Mira Ashvale.md')",
        )
        .get_result(&mut conn)
        .unwrap();
        assert_eq!(
            mira_alias_count, 1,
            "Mira Ashvale must have alias 'Mira' in note_aliases"
        );

        // ── Alias link: at least one note links to 'Mira' via alias ──────────
        let alias_link_count: i64 = note_links::table
            .filter(note_links::target_path.eq("Mira"))
            .count()
            .get_result(&mut conn)
            .unwrap();
        assert!(
            alias_link_count >= 1,
            "expected ≥1 wikilink with target_path='Mira' (alias-resolved link)"
        );

        // ── Timeline: The Ashfen Chronicle contains a timeline fence ─────────
        let chronicle_path = tmp.path().join("The Ashfen Chronicle.md");
        let chronicle_content = fs::read_to_string(&chronicle_path).unwrap_or_default();
        assert!(
            chronicle_content.contains("```timeline"),
            "The Ashfen Chronicle must contain a ```timeline fence"
        );

        // ── Session log: Session 1 has no timeline fence ─────────────────────
        let session_path = tmp
            .path()
            .join("Sessions")
            .join("Session 1 \u{2014} The Arrival.md");
        let session_content = fs::read_to_string(&session_path).unwrap_or_default();
        assert!(
            !session_content.contains("```timeline"),
            "Session 1 must not contain a timeline fence"
        );

        // ── Start Here scene fences reference real seeded scenes ─────────────
        // The `Id:` lines inside its ```scene fences are hand-authored against the
        // seed's autoincrement order; this guards against the page and seed drifting.
        // The name each fence carries is a copy the database owns (#185), so it is
        // checked against the seeded row rather than merely being present.
        let start_here = fs::read_to_string(tmp.path().join("Start Here.md")).unwrap();
        let references: Vec<(i32, Option<String>)> = start_here
            .split("```scene\n")
            .skip(1)
            .filter_map(|fence| {
                let body = fence.split("```").next()?;
                let mut id = None;
                let mut name = None;
                for line in body.lines() {
                    if let Some(rest) = line.strip_prefix("Id: ") {
                        id = rest.trim().parse::<i32>().ok();
                    } else if let Some(rest) = line.strip_prefix("# ") {
                        name = Some(rest.to_string());
                    }
                }
                id.map(|id| (id, name))
            })
            .collect();
        assert!(
            references.len() >= 2,
            "Start Here must embed ≥2 scene fences, found {}",
            references.len()
        );
        for (id, name) in references {
            let seeded: Vec<String> = scenes::table
                .filter(scenes::id.eq(id))
                .select(scenes::name)
                .load(&mut conn)
                .unwrap();
            assert_eq!(
                seeded.len(),
                1,
                "Start Here scene fence references scene id {id}, which is not seeded"
            );
            assert_eq!(
                name.as_deref(),
                Some(seeded[0].as_str()),
                "the name cached in Start Here's fence for scene {id} has gone stale"
            );
        }

        // ── Wikilinks produce real edges (not all stubs) ──────────────────────
        let keep_note_id: Option<i32> = notes::table
            .filter(notes::path.eq("Locations/The Ember Keep.md"))
            .select(notes::id)
            .first(&mut conn)
            .optional()
            .unwrap();
        assert!(
            keep_note_id.is_some(),
            "'Locations/The Ember Keep.md' must exist as a note"
        );

        let incoming_links_to_keep: i64 = note_links::table
            .filter(
                note_links::target_path.eq("Locations/The Ember Keep.md"),
            )
            .count()
            .get_result(&mut conn)
            .unwrap();
        assert!(
            incoming_links_to_keep >= 3,
            "The Ember Keep must have ≥3 backlinks, got {incoming_links_to_keep}"
        );
    }
}
