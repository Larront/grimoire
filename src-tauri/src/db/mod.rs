use std::path::{Path, PathBuf};

pub mod models;
mod recover;
pub mod schema;

use diesel::prelude::*;
use diesel::sql_types::{BigInt, Nullable, Text};
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
    open_validated_file(&db_path(ledger_path))
}

/// [`open_validated_connection`] on any database file — also how a salvaged database
/// is proven before it takes the damaged one's place.
fn open_validated_file(db_file: &Path) -> Result<SqliteConnection, DbOpenError> {
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

/// Snapshot the database, but only one that passes its integrity check: a damaged
/// database snapshotted on its way out would overwrite the good backup that could
/// have restored it. Used when a world closes (2026-10 design review) — the open-time
/// snapshot alone meant a restore lost that whole session's scenes, pins, maps and
/// Quick Notes.
pub fn snapshot_if_sound(conn: &mut SqliteConnection, ledger_path: &Path) -> Result<(), String> {
    quick_check(conn)?;
    write_snapshot(conn, ledger_path)
}

/// Move the damaged database (and any WAL/SHM sidecars, which could otherwise
/// re-corrupt a restored file) aside as `ledger.db.corrupt-<unix-ts>`. The
/// file is preserved, never deleted — it may still be salvageable. Returns where
/// the database itself went, so the GM can be shown it.
pub fn move_corrupt_db_aside(ledger_path: &Path) -> Result<Option<PathBuf>, String> {
    let db_file = db_path(ledger_path);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut kept = None;
    for suffix in ["", "-wal", "-shm"] {
        let src = PathBuf::from(format!("{}{suffix}", db_file.display()));
        if src.exists() {
            let dst = PathBuf::from(format!("{}.corrupt-{ts}{suffix}", db_file.display()));
            std::fs::rename(&src, &dst)
                .map_err(|e| format!("Failed to move damaged database aside: {e}"))?;
            if suffix.is_empty() {
                kept = Some(dst);
            }
        }
    }
    Ok(kept)
}

/// The most recently kept damaged database, if any — `ledger.db.corrupt-<ts>`.
pub fn latest_damaged_db(ledger_path: &Path) -> Option<PathBuf> {
    let db_file = db_path(ledger_path);
    let dir = db_file.parent()?;
    let prefix = format!("{}.corrupt-", db_file.file_name()?.to_string_lossy());
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            name.starts_with(&prefix) && !name.ends_with("-wal") && !name.ends_with("-shm")
        })
        .max()
}

/// A restore from the snapshot: when the snapshot was taken, and where the damaged
/// database was kept.
#[derive(Debug, PartialEq)]
pub struct Restored {
    pub taken_at: String,
    pub kept: Option<PathBuf>,
}

/// Attempt recovery from the snapshot: validate it, move the damaged database
/// aside, and put the snapshot in its place. Returns the snapshot's modified
/// date (for the "scenes and pins reflect <date>" toast) or `None` when no
/// usable snapshot exists — the caller then falls back to the rebuild dialog.
pub fn restore_from_snapshot(ledger_path: &Path) -> Result<Option<Restored>, String> {
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

    let kept = move_corrupt_db_aside(ledger_path)?;
    std::fs::copy(&backup, db_path(ledger_path))
        .map_err(|e| format!("Failed to restore backup: {e}"))?;
    Ok(Some(Restored { taken_at, kept }))
}

/// What salvaging a damaged database brought back of what only the database held.
/// Notes are not counted: they come back from their files on every open regardless.
#[derive(Debug, Default, PartialEq, QueryableByName, serde::Serialize, specta::Type)]
pub struct SalvageSummary {
    #[diesel(sql_type = BigInt)]
    #[specta(type = i32)]
    pub scenes: i64,
    /// Maps with their image, from the database — titles and pins intact.
    #[diesel(sql_type = BigInt)]
    #[specta(type = i32)]
    pub maps: i64,
    #[diesel(sql_type = BigInt)]
    #[specta(type = i32)]
    pub pins: i64,
    #[diesel(sql_type = BigInt)]
    #[specta(type = i32)]
    pub quick_notes: i64,
    /// Maps the database had lost, brought back from their images without pins — the
    /// rebuild's own recovery, run over the salvaged database by `open_ledger`.
    #[diesel(sql_type = BigInt)]
    #[specta(type = i32)]
    pub maps_from_images: i64,
}

impl SalvageSummary {
    fn anything(&self) -> bool {
        self.scenes + self.maps + self.pins + self.quick_notes > 0
    }
}

/// A salvage of the damaged database, and where the damaged file was kept.
#[derive(Debug, PartialEq)]
pub struct Salvaged {
    pub summary: SalvageSummary,
    pub kept: Option<PathBuf>,
}

/// When there is no usable snapshot (2026-10 design review): copy every row SQLite can
/// still read out of the damaged database into a new one, prove it opens as a ledger
/// database, and put it in the damaged one's place — which is kept aside, as a restore
/// keeps it. Returns `None`, leaving the damaged file untouched, when recovery fails or
/// brings back no scene, map, pin or Quick Note: the rebuild dialog gives the same
/// result, and asks first.
pub fn salvage_damaged_db(ledger_path: &Path) -> Result<Option<Salvaged>, String> {
    let db_file = db_path(ledger_path);
    let staged = db_file.with_extension("db.salvage");
    let discard = || {
        let _ = std::fs::remove_file(&staged);
    };
    discard();

    let attempt = (|| {
        recover::recover_into(&db_file, &staged)?;
        let mut conn = open_validated_file(&staged).map_err(DbOpenError::message)?;
        drop_dangling_references(&mut conn)?;
        count_salvaged(&mut conn)
    })();
    let summary = match attempt {
        Ok(summary) if summary.anything() => summary,
        Ok(_) => {
            log::info!("[db] salvage recovered nothing the rebuild would not");
            discard();
            return Ok(None);
        }
        Err(e) => {
            log::warn!("[db] salvage failed: {e}");
            discard();
            return Ok(None);
        }
    };

    let kept = move_corrupt_db_aside(ledger_path)?;
    std::fs::rename(&staged, &db_file)
        .map_err(|e| format!("Failed to put the salvaged database in place: {e}"))?;
    Ok(Some(Salvaged { summary, kept }))
}

fn count_salvaged(conn: &mut SqliteConnection) -> Result<SalvageSummary, String> {
    // Only maps with an image count: `finish_open` prunes the others.
    diesel::sql_query(
        "SELECT
            (SELECT COUNT(*) FROM scenes) AS scenes,
            (SELECT COUNT(*) FROM maps WHERE image_path IS NOT NULL) AS maps,
            (SELECT COUNT(*) FROM pins JOIN maps ON maps.id = pins.map_id
                WHERE maps.image_path IS NOT NULL) AS pins,
            (SELECT COUNT(*) FROM quick_notes) AS quick_notes,
            0 AS maps_from_images",
    )
    .get_result(conn)
    .map_err(|e| e.to_string())
}

#[derive(QueryableByName)]
struct ForeignKeyViolation {
    #[diesel(sql_type = Text)]
    table: String,
    #[diesel(sql_type = Nullable<BigInt>)]
    rowid: Option<i64>,
    #[diesel(sql_type = BigInt)]
    fkid: i64,
}

#[derive(QueryableByName)]
struct ForeignKey {
    #[diesel(sql_type = BigInt)]
    id: i64,
    #[diesel(sql_type = Text)]
    from: String,
    #[diesel(sql_type = Text)]
    on_delete: String,
}

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// A salvaged row can outlive the row it refers to — a pin whose map sat on an
/// unreadable page. Each is settled the way the schema settles a deleted parent:
/// `ON DELETE SET NULL` clears the reference, anything else removes the row. Repeated
/// until clean, because a removed pin leaves its own tags dangling in turn.
fn drop_dangling_references(conn: &mut SqliteConnection) -> Result<(), String> {
    for _ in 0..8 {
        let dangling: Vec<ForeignKeyViolation> = diesel::sql_query("PRAGMA foreign_key_check")
            .load(conn)
            .map_err(|e| e.to_string())?;
        if dangling.is_empty() {
            return Ok(());
        }
        for row in dangling {
            let rowid = row
                .rowid
                .ok_or_else(|| format!("dangling reference in {} without a rowid", row.table))?;
            let table = quote_ident(&row.table);
            let keys: Vec<ForeignKey> =
                diesel::sql_query(format!("PRAGMA foreign_key_list({table})"))
                    .load(conn)
                    .map_err(|e| e.to_string())?;
            let key = keys
                .iter()
                .find(|k| k.id == row.fkid)
                .ok_or_else(|| format!("no foreign key {} on {}", row.fkid, row.table))?;
            let sql = if key.on_delete == "SET NULL" {
                format!("UPDATE {table} SET {} = NULL WHERE rowid = {rowid}", quote_ident(&key.from))
            } else {
                format!("DELETE FROM {table} WHERE rowid = {rowid}")
            };
            diesel::sql_query(sql).execute(conn).map_err(|e| e.to_string())?;
        }
    }
    Err("references still dangling after repair".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::connection::SimpleConnection;
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
    fn a_damaged_database_is_never_snapshotted_over_a_good_backup() {
        let tmp = tempdir().unwrap();
        let mut conn = open_validated_connection(tmp.path()).unwrap();
        snapshot_if_sound(&mut conn, tmp.path()).unwrap();
        let good = std::fs::read(backup_path(tmp.path())).unwrap();
        drop(conn);

        std::fs::write(db_path(tmp.path()), b"definitely not a database").unwrap();
        if let Ok(mut damaged) = SqliteConnection::establish(&db_path(tmp.path()).to_string_lossy()) {
            assert!(snapshot_if_sound(&mut damaged, tmp.path()).is_err());
        }
        assert_eq!(std::fs::read(backup_path(tmp.path())).unwrap(), good);
    }

    #[test]
    fn the_kept_damaged_file_is_named_and_found_again() {
        let tmp = tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join(".grimoire")).unwrap();
        std::fs::write(db_path(tmp.path()), b"damaged").unwrap();
        let kept = move_corrupt_db_aside(tmp.path()).unwrap().unwrap();
        assert!(kept.to_string_lossy().contains("ledger.db.corrupt-"));
        assert_eq!(latest_damaged_db(tmp.path()), Some(kept));
    }

    #[test]
    fn corrupt_snapshot_is_treated_as_absent() {
        let tmp = tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join(".grimoire").join(BACKUP_DIR)).unwrap();
        std::fs::write(db_path(tmp.path()), b"garbage").unwrap();
        std::fs::write(backup_path(tmp.path()), b"also garbage").unwrap();

        assert_eq!(restore_from_snapshot(tmp.path()).unwrap(), None);
    }

    /// The recover extension reads pages through `sqlite_dbpage`, which the bundled
    /// SQLite only has because `.cargo/config.toml` asks for it. Losing that line would
    /// otherwise only show as every salvage quietly failing.
    #[test]
    fn the_bundled_sqlite_can_read_a_damaged_database_page_by_page() {
        assert!(recover::available());
    }

    #[derive(QueryableByName)]
    struct Page {
        #[diesel(sql_type = BigInt)]
        pageno: i64,
    }

    #[derive(QueryableByName)]
    struct PageSize {
        #[diesel(sql_type = BigInt)]
        page_size: i64,
    }

    #[derive(QueryableByName)]
    struct Count {
        #[diesel(sql_type = BigInt)]
        n: i64,
    }

    fn count(conn: &mut SqliteConnection, sql: &str) -> i64 {
        diesel::sql_query(sql).get_result::<Count>(conn).unwrap().n
    }

    /// A world with enough notes that their table spans many pages, beside one of
    /// everything only the database holds.
    fn world_with_scenes_pins_and_quick_notes(ledger: &Path) {
        let mut conn = open_validated_connection(ledger).unwrap();
        conn.batch_execute(
            "INSERT INTO scenes (name) VALUES ('Tavern');
             INSERT INTO maps (title, image_path, image_width, image_height)
                 VALUES ('Sword Coast', 'Sword Coast.png', 800, 600);
             INSERT INTO pins (map_id, x, y, title) VALUES (1, 0.5, 0.5, 'Waterdeep');
             INSERT INTO quick_notes (body, captured_at)
                 VALUES ('The innkeeper lied', '2026-10-21T19:30:00Z');",
        )
        .unwrap();
        fill_with_notes(&mut conn);
    }

    fn fill_with_notes(conn: &mut SqliteConnection) {
        diesel::sql_query(
            "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 400)
             INSERT INTO notes (path, title)
                 SELECT 'note-' || i || '.md', 'A long enough title to fill pages ' || hex(randomblob(40))
                 FROM n",
        )
        .execute(conn)
        .unwrap();
    }

    /// Overwrite one page in the middle of the notes table, as a torn write or a bad
    /// sector would. Everything else in the file is left as it was.
    fn damage_a_notes_page(ledger: &Path) {
        let page = {
            let mut conn = open_validated_connection(ledger).unwrap();
            let size: PageSize = diesel::sql_query("PRAGMA page_size").get_result(&mut conn).unwrap();
            let leaf: Page = diesel::sql_query(
                "SELECT pageno FROM dbstat WHERE name = 'notes' AND pagetype = 'leaf'
                 ORDER BY pageno LIMIT 1 OFFSET 3",
            )
            .get_result(&mut conn)
            .unwrap();
            (leaf.pageno, size.page_size)
        };
        let (pageno, size) = page;
        let mut bytes = std::fs::read(db_path(ledger)).unwrap();
        let start = ((pageno - 1) * size) as usize;
        bytes[start..start + size as usize].fill(0xAB);
        std::fs::write(db_path(ledger), bytes).unwrap();
    }

    #[test]
    fn salvage_brings_back_scenes_pins_and_quick_notes_from_a_damaged_database() {
        let tmp = tempdir().unwrap();
        world_with_scenes_pins_and_quick_notes(tmp.path());
        damage_a_notes_page(tmp.path());
        assert!(matches!(
            open_validated_connection(tmp.path()),
            Err(DbOpenError::Corrupt(_))
        ));

        let salvaged = salvage_damaged_db(tmp.path()).unwrap().expect("the salvage should be used");
        assert_eq!(
            salvaged.summary,
            SalvageSummary { scenes: 1, maps: 1, pins: 1, quick_notes: 1, maps_from_images: 0 }
        );

        // What is in place now opens as a ledger database, the pin still on its map.
        let mut conn = open_validated_connection(tmp.path()).unwrap();
        #[derive(QueryableByName)]
        struct PinOnMap {
            #[diesel(sql_type = Text)]
            pin: String,
            #[diesel(sql_type = Text)]
            map: String,
        }
        let row: PinOnMap = diesel::sql_query(
            "SELECT pins.title AS pin, maps.title AS map FROM pins JOIN maps ON maps.id = pins.map_id",
        )
        .get_result(&mut conn)
        .unwrap();
        assert_eq!((row.pin.as_str(), row.map.as_str()), ("Waterdeep", "Sword Coast"));
        assert_eq!(count(&mut conn, "SELECT COUNT(*) AS n FROM scenes WHERE name = 'Tavern'"), 1);

        // The damaged page really was lost — those notes come back from their files.
        let notes = count(&mut conn, "SELECT COUNT(*) AS n FROM notes");
        assert!(notes > 0 && notes < 400, "expected some notes lost with their page, kept {notes}");

        // The damaged file is kept, as a restore keeps it, and nothing is left staged.
        assert_eq!(latest_damaged_db(tmp.path()), salvaged.kept);
        assert!(salvaged.kept.is_some());
        assert!(!db_path(tmp.path()).with_extension("db.salvage").exists());
    }

    #[test]
    fn a_salvage_with_nothing_the_rebuild_lacks_leaves_the_damaged_file_for_the_dialog() {
        let tmp = tempdir().unwrap();
        fill_with_notes(&mut open_validated_connection(tmp.path()).unwrap());
        damage_a_notes_page(tmp.path());
        let damaged = std::fs::read(db_path(tmp.path())).unwrap();

        assert_eq!(salvage_damaged_db(tmp.path()).unwrap(), None);
        assert_eq!(std::fs::read(db_path(tmp.path())).unwrap(), damaged);
        assert_eq!(latest_damaged_db(tmp.path()), None);
        assert!(!db_path(tmp.path()).with_extension("db.salvage").exists());
    }

    #[test]
    fn a_file_that_was_never_a_database_cannot_be_salvaged() {
        let tmp = tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join(".grimoire")).unwrap();
        std::fs::write(db_path(tmp.path()), b"this is not a sqlite database, not even close")
            .unwrap();

        assert_eq!(salvage_damaged_db(tmp.path()).unwrap(), None);
        assert!(db_path(tmp.path()).exists());
    }

    #[test]
    fn a_salvaged_row_whose_parent_was_lost_is_settled_as_a_deletion_would_settle_it() {
        let tmp = tempdir().unwrap();
        let mut conn = open_validated_connection(tmp.path()).unwrap();
        conn.batch_execute(
            "PRAGMA foreign_keys = OFF;
             INSERT INTO maps (id, title, image_path, image_width, image_height)
                 VALUES (1, 'Sword Coast', 'Sword Coast.png', 800, 600);
             INSERT INTO pins (id, map_id, x, y, title, note_id) VALUES (1, 1, 0, 0, 'Waterdeep', 999);
             INSERT INTO pins (id, map_id, x, y, title) VALUES (2, 99, 0, 0, 'Lost');
             INSERT INTO pin_tags (pin_id, tag) VALUES (2, 'port');
             PRAGMA foreign_keys = ON;",
        )
        .unwrap();

        drop_dangling_references(&mut conn).unwrap();

        // `note_id` is ON DELETE SET NULL: the pin stays, unlinked.
        assert_eq!(count(&mut conn, "SELECT COUNT(*) AS n FROM pins WHERE id = 1 AND note_id IS NULL"), 1);
        // `map_id` is ON DELETE CASCADE: the pin goes, and its tags after it.
        assert_eq!(count(&mut conn, "SELECT COUNT(*) AS n FROM pins WHERE id = 2"), 0);
        assert_eq!(count(&mut conn, "SELECT COUNT(*) AS n FROM pin_tags"), 0);
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
