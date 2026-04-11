mod commands;
mod db;
mod vault;

use commands::maps::*;
use commands::media::*;
use commands::notes::*;
use commands::recent_vaults::*;
use commands::scenes::*;
use commands::spotify::*;
use commands::tree::*;
use commands::vault::*;

use crate::vault::{AppVault, VaultState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppVault::new(VaultState::new()))
        .invoke_handler(tauri::generate_handler![
            get_vault_path,
            open_vault,
            get_recent_vaults,
            add_recent_vault,
            remove_recent_vault,
            create_note,
            get_notes,
            read_note_content,
            update_note,
            write_note_content,
            delete_note,
            search_notes,
            get_note_by_path,
            get_file_tree,
            create_folder,
            delete_folder,
            rename_folder,
            create_map,
            get_maps,
            update_map,
            delete_map,
            get_map_image_data_url,
            get_pins,
            create_pin,
            update_pin,
            delete_pin,
            get_pin_categories,
            create_pin_category,
            update_pin_category,
            delete_pin_category,
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
            copy_image_file,
            save_image_bytes,
            get_image_absolute_path,
            toggle_scene_favorite,
            get_scenes_with_slot_counts,
            // Spotify
            spotify_get_auth_status,
            spotify_start_auth_flow,
            spotify_exchange_code,
            spotify_refresh_token,
            spotify_get_access_token,
            spotify_revoke,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
