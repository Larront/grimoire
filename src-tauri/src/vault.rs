use std::{path::PathBuf, sync::Mutex};

use diesel::SqliteConnection;

pub struct VaultState {
    pub path: Option<PathBuf>,
    pub connection: Option<SqliteConnection>,
    pub spotify_client_id: String,
    pub pending_spotify_verifier: Option<String>,
    pub pending_spotify_state: Option<String>,
}

impl VaultState {
    pub fn new(spotify_client_id: String) -> Self {
        VaultState {
            path: None,
            connection: None,
            spotify_client_id,
            pending_spotify_verifier: None,
            pending_spotify_state: None,
        }
    }
}

pub type AppVault = Mutex<VaultState>;
