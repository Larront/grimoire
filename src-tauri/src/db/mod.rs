use std::path::Path;

pub mod models;
pub mod schema;

use diesel::prelude::*;
use diesel_migrations::{embed_migrations, EmbeddedMigrations, MigrationHarness};

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

pub fn establish_connection(vault_path: &Path) -> Result<SqliteConnection, String> {
    let db_path = vault_path.join("vault.db");
    let db_url = db_path.to_str().ok_or("Invalid Vault path.")?;

    let mut conn = SqliteConnection::establish(db_url)
        .map_err(|e| format!("Failed to connect to database: {}", e))?;
    conn.run_pending_migrations(MIGRATIONS)
        .map_err(|e| format!("Migration failed: {}", e))?;
    Ok(conn)
}
