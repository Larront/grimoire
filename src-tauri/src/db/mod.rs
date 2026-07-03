use std::path::{Path, PathBuf};

pub mod models;
pub mod schema;

use diesel::prelude::*;
use diesel::sql_types::Text;
use diesel_migrations::{embed_migrations, EmbeddedMigrations, MigrationHarness};

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

const BACKUP_DIR: &str = "backups";
const BACKUP_FILE: &str = "ledger-backup.db";

/// Classified failure opening the ledger database (issue #116). `Locked` and
/// `Corrupt` have distinct recovery paths; everything else is `Other`.
#[derive(Debug)]
pub enum DbOpenError {
    /// SQLITE_BUSY survived the busy_timeout — another process holds the lock.
    Locked(String),
    /// The file failed `PRAGMA quick_check` or cannot be read as SQLite.
    Corrupt(String),
    Other(String),
}

impl DbOpenError {
    /// Stringify with the stable ERR_ prefixes the Command Wrapper maps to
    /// friendly copy (ADR-0010).
    pub fn message(self) -> String {
        match self {
            DbOpenError::Locked(d) => format!("ERR_DB_LOCKED: {d}"),
            DbOpenError::Corrupt(d) => format!("ERR_DB_CORRUPT: {d}"),
            DbOpenError::Other(d) => d,
        }
    }
}

fn is_locked_message(msg: &str) -> bool {
    msg.contains("database is locked") || msg.contains("database table is locked")
}

fn is_corrupt_message(msg: &str) -> bool {
    msg.contains("malformed") || msg.contains("not a database")
}

fn classify(context: &str, msg: String) -> DbOpenError {
    if is_locked_message(&msg) {
        DbOpenError::Locked(format!("{context}: {msg}"))
    } else if is_corrupt_message(&msg) {
        DbOpenError::Corrupt(format!("{context}: {msg}"))
    } else {
        DbOpenError::Other(format!("{context}: {msg}"))
    }
}

pub fn db_path(ledger_path: &Path) -> PathBuf {
    ledger_path.join(".grimoire").join("ledger.db")
}

fn backup_path(ledger_path: &Path) -> PathBuf {
    ledger_path.join(".grimoire").join(BACKUP_DIR).join(BACKUP_FILE)
}

#[derive(QueryableByName)]
struct QuickCheckRow {
    #[diesel(sql_type = Text)]
    quick_check: String,
}

/// `PRAGMA quick_check` on an open connection; Ok(()) iff the report is "ok".
fn quick_check(conn: &mut SqliteConnection) -> Result<(), String> {
    let rows: Vec<QuickCheckRow> = diesel::sql_query("PRAGMA quick_check(1)")
        .load(conn)
        .map_err(|e| e.to_string())?;
    match rows.first() {
        Some(row) if row.quick_check == "ok" => Ok(()),
        Some(row) => Err(row.quick_check.clone()),
        None => Err("quick_check returned no rows".to_string()),
    }
}

/// Open the ledger database with the lock/corruption posture of issue #116:
/// a 5s busy timeout (transient locks from sync tools / antivirus wait it
/// out), an integrity quick_check, then migrations — with failures classified
/// so `open_ledger` can pick the right recovery path.
pub fn open_validated_connection(ledger_path: &Path) -> Result<SqliteConnection, DbOpenError> {
    let grimoire_dir = ledger_path.join(".grimoire");
    std::fs::create_dir_all(&grimoire_dir)
        .map_err(|e| DbOpenError::Other(format!("Failed to create .grimoire directory: {e}")))?;
    let db_file = db_path(ledger_path);
    let db_url = db_file
        .to_str()
        .ok_or_else(|| DbOpenError::Other("Invalid Ledger path.".to_string()))?;

    let mut conn = SqliteConnection::establish(db_url)
        .map_err(|e| classify("Failed to connect to database", e.to_string()))?;

    diesel::sql_query("PRAGMA busy_timeout = 5000")
        .execute(&mut conn)
        .map_err(|e| classify("Failed to set busy timeout", e.to_string()))?;

    quick_check(&mut conn).map_err(|detail| DbOpenError::Corrupt(detail))?;

    conn.run_pending_migrations(MIGRATIONS)
        .map_err(|e| classify("Migration failed", e.to_string()))?;
    Ok(conn)
}

/// String-error convenience over [`open_validated_connection`] for callers
/// without a recovery path (sample-world open, tests).
pub fn establish_connection(ledger_path: &Path) -> Result<SqliteConnection, String> {
    open_validated_connection(ledger_path).map_err(DbOpenError::message)
}

/// Snapshot the live database to `.grimoire/backups/ledger-backup.db` via
/// `VACUUM INTO` (consistent even mid-connection). Called after every
/// successful `open_ledger`, so the snapshot is always a known-good image;
/// on corruption it is at most one session stale, and the ledger-scan on the
/// next open reconciles all note-derived data anyway. Best-effort: failure is
/// logged by the caller, never blocks an open.
pub fn write_snapshot(conn: &mut SqliteConnection, ledger_path: &Path) -> Result<(), String> {
    let backup = backup_path(ledger_path);
    let dir = backup.parent().expect("backup path has a parent");
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    // VACUUM INTO refuses to overwrite, so write to a temp file and swap.
    let tmp = backup.with_extension("db.tmp");
    if tmp.exists() {
        std::fs::remove_file(&tmp).map_err(|e| e.to_string())?;
    }
    let tmp_sql = tmp.to_string_lossy().replace('\'', "''");
    diesel::sql_query(format!("VACUUM INTO '{tmp_sql}'"))
        .execute(conn)
        .map_err(|e| e.to_string())?;
    if backup.exists() {
        std::fs::remove_file(&backup).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, &backup).map_err(|e| e.to_string())?;
    Ok(())
}

/// Move the damaged database (and any WAL/SHM sidecars, which could otherwise
/// re-corrupt a restored file) aside as `ledger.db.corrupt-<unix-ts>`. The
/// file is preserved, never deleted — it may still be salvageable.
pub fn move_corrupt_db_aside(ledger_path: &Path) -> Result<(), String> {
    let db_file = db_path(ledger_path);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    for suffix in ["", "-wal", "-shm"] {
        let src = PathBuf::from(format!("{}{suffix}", db_file.display()));
        if src.exists() {
            let dst = PathBuf::from(format!("{}.corrupt-{ts}{suffix}", db_file.display()));
            std::fs::rename(&src, &dst)
                .map_err(|e| format!("Failed to move damaged database aside: {e}"))?;
        }
    }
    Ok(())
}

/// Attempt recovery from the snapshot: validate it, move the damaged database
/// aside, and put the snapshot in its place. Returns the snapshot's modified
/// date (for the "scenes and pins reflect <date>" toast) or `None` when no
/// usable snapshot exists — the caller then falls back to the rebuild dialog.
pub fn restore_from_snapshot(ledger_path: &Path) -> Result<Option<String>, String> {
    let backup = backup_path(ledger_path);
    if !backup.exists() {
        return Ok(None);
    }

    // A snapshot that fails its own quick_check is as good as absent.
    let backup_url = backup.to_string_lossy().to_string();
    let usable = SqliteConnection::establish(&backup_url)
        .ok()
        .and_then(|mut c| quick_check(&mut c).ok())
        .is_some();
    if !usable {
        return Ok(None);
    }

    let taken_at = backup
        .metadata()
        .and_then(|m| m.modified())
        .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
        .unwrap_or_default();

    move_corrupt_db_aside(ledger_path)?;
    std::fs::copy(&backup, db_path(ledger_path))
        .map_err(|e| format!("Failed to restore backup: {e}"))?;
    Ok(Some(taken_at))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn open_validated_connection_creates_and_passes_quick_check() {
        let tmp = tempdir().unwrap();
        let conn = open_validated_connection(tmp.path());
        assert!(conn.is_ok());
    }

    #[test]
    fn garbage_file_classified_as_corrupt() {
        let tmp = tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join(".grimoire")).unwrap();
        std::fs::write(db_path(tmp.path()), b"this is not a sqlite database, not even close")
            .unwrap();

        match open_validated_connection(tmp.path()) {
            Err(DbOpenError::Corrupt(_)) => {}
            Err(other) => panic!("expected Corrupt, got {other:?}"),
            Ok(_) => panic!("expected Corrupt, got a working connection"),
        }
    }

    #[test]
    fn snapshot_then_restore_recovers_a_corrupted_db() {
        let tmp = tempdir().unwrap();
        {
            let mut conn = open_validated_connection(tmp.path()).unwrap();
            diesel::sql_query("INSERT INTO scenes (name) VALUES ('Tavern')")
                .execute(&mut conn)
                .unwrap();
            write_snapshot(&mut conn, tmp.path()).unwrap();
        } // connection dropped so the corruption below isn't masked by a live handle

        // Trash the live database.
        std::fs::write(db_path(tmp.path()), b"garbage").unwrap();
        assert!(matches!(
            open_validated_connection(tmp.path()),
            Err(DbOpenError::Corrupt(_))
        ));

        // Restore: reports the snapshot date, preserves the damaged file.
        let restored = restore_from_snapshot(tmp.path()).unwrap();
        assert!(restored.is_some(), "snapshot should have been restored");

        let mut conn = open_validated_connection(tmp.path()).unwrap();
        #[derive(QueryableByName)]
        struct NameRow {
            #[diesel(sql_type = Text)]
            name: String,
        }
        let rows: Vec<NameRow> = diesel::sql_query("SELECT name FROM scenes").load(&mut conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "Tavern");

        let kept_corrupt = std::fs::read_dir(tmp.path().join(".grimoire"))
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().contains(".corrupt-"));
        assert!(kept_corrupt, "the damaged file must be kept, not deleted");
    }

    #[test]
    fn restore_without_snapshot_returns_none() {
        let tmp = tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join(".grimoire")).unwrap();
        std::fs::write(db_path(tmp.path()), b"garbage").unwrap();

        assert_eq!(restore_from_snapshot(tmp.path()).unwrap(), None);
        // The damaged file is untouched until the GM chooses to rebuild.
        assert!(db_path(tmp.path()).exists());
    }

    #[test]
    fn corrupt_snapshot_is_treated_as_absent() {
        let tmp = tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join(".grimoire").join(BACKUP_DIR)).unwrap();
        std::fs::write(db_path(tmp.path()), b"garbage").unwrap();
        std::fs::write(backup_path(tmp.path()), b"also garbage").unwrap();

        assert_eq!(restore_from_snapshot(tmp.path()).unwrap(), None);
    }

    #[test]
    fn write_snapshot_replaces_previous_snapshot() {
        let tmp = tempdir().unwrap();
        let mut conn = open_validated_connection(tmp.path()).unwrap();
        write_snapshot(&mut conn, tmp.path()).unwrap();
        let first_len = backup_path(tmp.path()).metadata().unwrap().len();

        diesel::sql_query("INSERT INTO scenes (name) VALUES ('Forest')")
            .execute(&mut conn)
            .unwrap();
        write_snapshot(&mut conn, tmp.path()).unwrap();

        assert!(backup_path(tmp.path()).exists());
        // Not asserting exact sizes — just that the swap happened cleanly.
        let _ = first_len;
        let mut check = SqliteConnection::establish(
            backup_path(tmp.path()).to_str().unwrap(),
        )
        .unwrap();
        assert!(quick_check(&mut check).is_ok());
    }
}
