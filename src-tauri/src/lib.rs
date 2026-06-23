mod commands;
mod db;
mod ledger;
mod note_index;
mod search;

use commands::app_prefs::*;
use commands::graph::*;
use commands::graph_styles::*;
use commands::ledger::*;
use commands::links::*;
use commands::maps::*;
use commands::media::*;
use commands::notes::*;
use commands::preferences::*;
use commands::recent::*;
use commands::recent_ledgers::*;
use commands::sample::*;
use commands::scenes::*;
use commands::spotify::*;
use commands::tags::*;
use commands::templates::*;
use commands::tree::*;

use crate::ledger::{AppLedger, LedgerState};

/// Export-only tauri-specta builder (ADR-0009). It collects the specta-annotated
/// commands purely so their TypeScript bindings can be generated; the runtime
/// invoke handler remains `generate_handler!` below (the source of truth), which
/// already serves these commands. Throw mode â†’ generated commands return
/// `Promise<T>` and call `invoke` directly, so no handler swap is needed and the
/// migration can proceed command-by-command.
// Command names + their tauri-specta helper macros are in scope via the
// `use commands::*::*` glob imports at the top of this file.
#[cfg(debug_assertions)]
fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .error_handling(tauri_specta::ErrorHandlingMode::Throw)
        .commands(tauri_specta::collect_commands![
            add_recent_ledger,
            adopt_sample_ledger,
            assign_map_image,
            close_ledger,
            copy_audio_file,
            copy_image_file,
            copy_thumbnail_file,
            // create_annotation: carved out (14-arg arity limit), hand-wrapped in $lib/api
            create_folder,
            create_map,
            create_map_empty,
            create_note,
            create_note_from_template,
            create_pin,
            create_pin_category,
            create_scene,
            create_scene_slot,
            create_template,
            delete_annotation,
            delete_folder,
            delete_map,
            delete_note,
            delete_pdf,
            delete_pin,
            delete_pin_category,
            delete_scene,
            delete_scene_slot,
            delete_template,
            explore_sample_ledger,
            get_accent_preset,
            get_alias_collisions,
            get_annotations,
            get_app_prefs,
            get_audio_absolute_path,
            get_backlinks,
            get_density_level,
            get_file_tree,
            get_graph_data,
            get_image_absolute_path,
            get_ledger_path,
            get_map_image_data_url,
            get_maps,
            get_note_aliases,
            get_note_backlink_count,
            get_note_by_path,
            get_notes,
            get_outbound_links,
            get_pdf_absolute_path,
            get_pin_categories,
            get_pin_categories_for_map,
            get_pin_tags,
            get_pins,
            get_recent_entities,
            get_recent_ledgers,
            get_scene_slots,
            get_scenes,
            get_scenes_with_slot_counts,
            get_tag_graph_styles,
            get_tag_usage_counts,
            list_all_tags,
            list_templates,
            open_ledger,
            read_note_content,
            read_note_tags,
            read_template,
            rebuild_search_index,
            record_recent,
            remove_recent_ledger,
            rename_folder,
            rename_note,
            rename_pdf,
            retag_tag,
            rename_template,
            reorder_scene_slots,
            resolve_note_target,
            restore_builtin_templates,
            save_accent_preset,
            save_app_prefs,
            save_density_level,
            save_image_bytes,
            save_note_as_template,
            search_all,
            search_notes,
            set_note_aliases,
            set_pin_tags,
            set_tag_graph_style,
            spotify_exchange_code,
            spotify_get_access_token,
            spotify_get_auth_status,
            spotify_play_track,
            spotify_refresh_token,
            spotify_resume,
            spotify_revoke,
            spotify_skip_next,
            spotify_skip_prev,
            spotify_start_auth_flow,
            toggle_scene_favorite,
            update_annotation,
            update_map,
            update_note,
            update_pin,
            update_pin_category,
            update_scene,
            update_scene_slot,
            update_scene_thumbnail,
            write_note_content,
            write_note_tags,
            write_template,
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();

    // ADR-0009: regenerate committed TS bindings from the annotated commands.
    // Runs on every debug launch; `GRIMOIRE_EXPORT_ONLY=1 cargo run` exports and
    // exits before creating a window (headless-friendly generation).
    #[cfg(debug_assertions)]
    {
        // Note: specta exports f32/f64 as `number | null` (its NaN/Infinity
        // guard). Grimoire's floats are never null, so the frontend narrows them
        // to the refined `$lib/types/ledger` types with a cast at the api seam
        // (see ADR-0009 migration outcome) â€” no exporter float config needed.
        specta_builder()
            .export(
                specta_typescript::Typescript::default(),
                "../src/lib/bindings.gen.ts",
            )
            .expect("failed to export specta bindings");
        if std::env::var("GRIMOIRE_EXPORT_ONLY").is_ok() {
            return;
        }
    }

    // Spotify client ID: prefer the value baked in at compile time (set by the
    // release build), falling back to the runtime env / .env for local dev. A
    // PKCE client ID is not a secret, so embedding it in the binary is fine.
    let client_id = option_env!("SPOTIFY_CLIENT_ID")
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("SPOTIFY_CLIENT_ID").ok())
        .unwrap_or_default();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init());

    // The updater plugin is desktop-only; gate it so mobile targets still compile.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .manage(AppLedger::new(LedgerState::new(client_id)))
        .invoke_handler(tauri::generate_handler![
            get_ledger_path,
            open_ledger,
            close_ledger,
            get_app_prefs,
            save_app_prefs,
            save_accent_preset,
            get_accent_preset,
            save_density_level,
            get_density_level,
            get_recent_ledgers,
            add_recent_ledger,
            remove_recent_ledger,
            explore_sample_ledger,
            adopt_sample_ledger,
            create_note,
            create_note_from_template,
            get_notes,
            read_note_content,
            update_note,
            rename_note,
            write_note_content,
            delete_note,
            search_notes,
            search_all,
            rebuild_search_index,
            get_note_by_path,
            read_note_tags,
            write_note_tags,
            list_all_tags,
            get_tag_usage_counts,
            retag_tag,
            get_pin_tags,
            set_pin_tags,
            get_file_tree,
            create_folder,
            delete_folder,
            rename_folder,
            create_map,
            create_map_empty,
            get_maps,
            update_map,
            delete_map,
            assign_map_image,
            get_map_image_data_url,
            get_pins,
            create_pin,
            update_pin,
            delete_pin,
            get_pin_categories,
            get_pin_categories_for_map,
            create_pin_category,
            update_pin_category,
            delete_pin_category,
            // Annotations
            get_annotations,
            create_annotation,
            update_annotation,
            delete_annotation,
            // Scenes
            get_scenes,
            create_scene,
            update_scene,
            delete_scene,
            get_scene_slots,
            create_scene_slot,
            update_scene_slot,
            delete_scene_slot,
            reorder_scene_slots,
            copy_audio_file,
            get_audio_absolute_path,
            update_scene_thumbnail,
            copy_thumbnail_file,
            copy_image_file,
            save_image_bytes,
            get_image_absolute_path,
            get_pdf_absolute_path,
            rename_pdf,
            delete_pdf,
            toggle_scene_favorite,
            get_scenes_with_slot_counts,
            // Recent entities
            record_recent,
            get_recent_entities,
            // Spotify
            spotify_get_auth_status,
            spotify_start_auth_flow,
            spotify_exchange_code,
            spotify_refresh_token,
            spotify_get_access_token,
            spotify_revoke,
            spotify_play_track,
            spotify_resume,
            spotify_skip_next,
            spotify_skip_prev,
            // Templates
            list_templates,
            restore_builtin_templates,
            rename_template,
            delete_template,
            create_template,
            read_template,
            write_template,
            save_note_as_template,
            // Links
            get_backlinks,
            get_outbound_links,
            get_note_backlink_count,
            get_note_aliases,
            set_note_aliases,
            get_alias_collisions,
            resolve_note_target,
            // Graph data
            get_graph_data,
            // Graph styles
            get_tag_graph_styles,
            set_tag_graph_style,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
