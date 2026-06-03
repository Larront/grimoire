mod commands;
mod db;
mod ledger;
mod note_index;
mod search;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();
    let client_id = std::env::var("SPOTIFY_CLIENT_ID").unwrap_or_default();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppLedger::new(LedgerState::new(client_id)))
        .invoke_handler(tauri::generate_handler![
            get_ledger_path,
            open_ledger,
            close_ledger,
            save_accent_preset,
            get_accent_preset,
            save_density_level,
            get_density_level,
            get_recent_ledgers,
            add_recent_ledger,
            remove_recent_ledger,
            explore_sample_ledger,
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
            resolve_note_by_alias,
            // Graph data
            get_graph_data,
            // Graph styles
            get_tag_graph_styles,
            set_tag_graph_style,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
