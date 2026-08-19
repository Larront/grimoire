use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use diesel::SqliteConnection;
use tantivy::Index;

/// What every command says when the `AppLedger` mutex was poisoned by a panic in
/// another command. Spelled once so the frontend only ever has one string to
/// recognise.
pub const ERR_LOCK_POISONED: &str = "Ledger lock poisoned";

/// What every command says when it is asked to do ledger work with no ledger
/// open. One place decides this, because the frontend matches on it.
pub const ERR_NO_LEDGER: &str = "No ledger open";

pub struct LedgerState {
    pub path: Option<PathBuf>,
    pub connection: Option<SqliteConnection>,
    pub search_index: Option<Index>,
    pub spotify_client_id: String,
    pub pending_spotify_verifier: Option<String>,
    pub pending_spotify_state: Option<String>,
}

/// A ledger that *is* open — the invariant `LedgerState`'s three `Option`s only
/// imply. Borrowed from the state behind the lock, so holding one is proof the
/// folder and the database are both there for as long as it lives.
///
/// The three fields are the borrow-checker split every command used to write by
/// hand: `path` and `index` read-only, `conn` mutable, all three live at once.
/// That only type-checks because they are separate fields of the same struct,
/// which is the fact the comment at each old call site was explaining.
///
/// `index` stays optional: a ledger opens even when the search index could not
/// be built (a corrupt tantivy directory, an unwritable disk), and every writer
/// treats "no index" as "nothing to update" rather than a failure.
pub struct OpenLedger<'a> {
    /// The vault folder — notes, media and `.grimoire/` all live under it.
    pub path: &'a Path,
    pub conn: &'a mut SqliteConnection,
    pub index: Option<&'a Index>,
}

impl LedgerState {
    pub fn new(spotify_client_id: String) -> Self {
        LedgerState {
            path: None,
            connection: None,
            search_index: None,
            spotify_client_id,
            pending_spotify_verifier: None,
            pending_spotify_state: None,
        }
    }

    /// The open ledger this state holds, or [`ERR_NO_LEDGER`].
    ///
    /// Prefer [`with_open_ledger`]; reach for this directly only when the
    /// command needs the guard for something else as well (Spotify's pending
    /// OAuth fields, replacing the search index).
    pub fn open(&mut self) -> Result<OpenLedger<'_>, String> {
        Ok(OpenLedger {
            path: self.path.as_deref().ok_or(ERR_NO_LEDGER)?,
            conn: self.connection.as_mut().ok_or(ERR_NO_LEDGER)?,
            index: self.search_index.as_ref(),
        })
    }
}

pub type AppLedger = Mutex<LedgerState>;

/// Lock the ledger and hand the open one to `f`. The command↔state seam: a
/// command says what it does with an open ledger, and nothing about locking,
/// poisoning, or which fields have to be borrowed apart.
///
/// The lock is held for the whole closure, so nothing inside it may call another
/// command that locks `AppLedger` — that deadlocks. Work that only needs the
/// folder should use [`ledger_path`], which releases the lock first.
pub fn with_open_ledger<T>(
    ledger: &AppLedger,
    f: impl FnOnce(OpenLedger<'_>) -> Result<T, String>,
) -> Result<T, String> {
    let mut state = ledger.lock().map_err(|_| ERR_LOCK_POISONED)?;
    f(state.open()?)
}

/// The open ledger's folder, with the lock already released — for the commands
/// whose work is all on disk and must not hold the database while it runs.
pub fn ledger_path(ledger: &AppLedger) -> Result<PathBuf, String> {
    let state = ledger.lock().map_err(|_| ERR_LOCK_POISONED)?;
    state.path.clone().ok_or_else(|| ERR_NO_LEDGER.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::Connection;

    fn state() -> LedgerState {
        LedgerState::new("client-id".to_string())
    }

    #[test]
    fn a_closed_ledger_refuses_with_one_message() {
        let mut closed = state();
        assert_eq!(closed.open().err().unwrap(), ERR_NO_LEDGER);
        assert_eq!(
            ledger_path(&AppLedger::new(state())).unwrap_err(),
            ERR_NO_LEDGER
        );
    }

    #[test]
    fn a_path_without_a_database_is_still_closed() {
        // Half-open is not open: `open_ledger` sets all three fields together, so
        // a state with only a path is a ledger mid-open or mid-close, never one
        // that commands may write to.
        let mut half = state();
        half.path = Some(PathBuf::from("/vault"));
        assert_eq!(half.open().err().unwrap(), ERR_NO_LEDGER);
    }

    #[test]
    fn an_open_ledger_carries_folder_database_and_no_index() {
        let mut open = state();
        open.path = Some(PathBuf::from("/vault"));
        open.connection = Some(SqliteConnection::establish(":memory:").unwrap());

        let ledger = AppLedger::new(open);
        let path = with_open_ledger(&ledger, |l| {
            assert!(l.index.is_none(), "no index was built for this state");
            Ok(l.path.to_path_buf())
        })
        .unwrap();
        assert_eq!(path, PathBuf::from("/vault"));
        assert_eq!(ledger_path(&ledger).unwrap(), PathBuf::from("/vault"));
    }
}
