//! The single chokepoint for writing note (`.md`) file bytes to disk.
//!
//! Every command that writes note content — save, create, template creation,
//! tag/alias frontmatter rewrites, and the wikilink backlink rewrites a rename
//! fans out to — routes through [`write_note_file`]. On each write it records a
//! content hash of the exact bytes written into a bounded, process-global
//! registry keyed by canonical path.
//!
//! The registry exists so the ledger watcher (added in a later slice) can tell
//! the app's *own* writes apart from genuine external edits: a watch event
//! whose on-disk content hashes to a value the registry remembers is the app's
//! echo and is dropped; a differing hash is a real external change. Comparing
//! content (not timestamps) makes this race-free — an external edit that lands
//! between our write and the watch event produces a hash we never recorded, so
//! it is correctly treated as external.
//!
//! It is a process-global rather than a field on `LedgerState` deliberately:
//! the writers live across `notes.rs`, `links.rs`, and (via the shared backlink
//! rewriter) `tree.rs`, and only one ledger is ever open at a time. Threading a
//! `&mut` registry through every helper would churn signatures and unit-test
//! call sites for no lifecycle benefit — [`reset_recent_writes`] clears it on
//! ledger open, which is the only lifecycle event that matters.

use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, VecDeque};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

/// Cap on the number of distinct paths tracked. A bulk rewrite (folder rename
/// touching hundreds of backlink sources) must not grow the registry without
/// bound; oldest paths are evicted first.
const MAX_PATHS: usize = 512;

/// Recent hashes kept per path. Autosave can write the same file several times
/// in quick succession; keeping the last few lets the watcher match any of the
/// in-flight writes rather than only the most recent.
const MAX_HASHES_PER_PATH: usize = 4;

static RECENT_WRITES: LazyLock<Mutex<RecentWrites>> =
    LazyLock::new(|| Mutex::new(RecentWrites::default()));

#[derive(Default)]
struct RecentWrites {
    /// Insertion order of tracked paths, for bounded FIFO eviction.
    order: VecDeque<PathBuf>,
    /// Path → recent content hashes of bytes this process wrote there.
    hashes: HashMap<PathBuf, Vec<u64>>,
}

impl RecentWrites {
    fn record(&mut self, path: &Path, bytes: &[u8]) {
        let key = normalize(path);
        let h = hash_bytes(bytes);
        match self.hashes.get_mut(&key) {
            Some(list) => {
                list.push(h);
                let len = list.len();
                if len > MAX_HASHES_PER_PATH {
                    list.drain(0..len - MAX_HASHES_PER_PATH);
                }
            }
            None => {
                self.hashes.insert(key.clone(), vec![h]);
                self.order.push_back(key);
            }
        }
        while self.order.len() > MAX_PATHS {
            if let Some(old) = self.order.pop_front() {
                self.hashes.remove(&old);
            }
        }
    }

    fn clear(&mut self) {
        self.order.clear();
        self.hashes.clear();
    }
}

/// Canonicalize so the write side and the watch side key on the same path even
/// through symlinks or `..` segments. Falls back to the path as-given when the
/// file can't be canonicalized (it should always exist right after a write).
fn normalize(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn hash_bytes(bytes: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

/// Write note-file bytes to disk and remember their content hash. This is the
/// only place `.md` bytes should be written — see the module docs.
pub fn write_note_file(full_path: &Path, bytes: &[u8]) -> Result<(), String> {
    std::fs::write(full_path, bytes).map_err(|e| e.to_string())?;
    // A poisoned lock must not fail a write the user asked for; the worst case
    // of a missed record is one un-suppressed echo, not data loss.
    if let Ok(mut guard) = RECENT_WRITES.lock() {
        guard.record(full_path, bytes);
    }
    Ok(())
}

/// Forget all remembered writes. Called on ledger open so echo suppression can
/// never match a hash left over from a previously-open ledger.
pub fn reset_recent_writes() {
    if let Ok(mut guard) = RECENT_WRITES.lock() {
        guard.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_keeps_only_recent_hashes_per_path() {
        let mut rw = RecentWrites::default();
        let p = PathBuf::from("nonexistent-note.md");
        for i in 0..(MAX_HASHES_PER_PATH + 3) {
            rw.record(&p, format!("body {i}").as_bytes());
        }
        let key = normalize(&p);
        assert_eq!(rw.hashes.get(&key).unwrap().len(), MAX_HASHES_PER_PATH);
    }

    #[test]
    fn record_evicts_oldest_paths_beyond_cap() {
        let mut rw = RecentWrites::default();
        for i in 0..(MAX_PATHS + 10) {
            rw.record(&PathBuf::from(format!("note-{i}.md")), b"x");
        }
        assert!(rw.order.len() <= MAX_PATHS);
        assert!(rw.hashes.len() <= MAX_PATHS);
    }

    #[test]
    fn clear_forgets_everything() {
        let mut rw = RecentWrites::default();
        rw.record(&PathBuf::from("a.md"), b"a");
        rw.clear();
        assert!(rw.order.is_empty());
        assert!(rw.hashes.is_empty());
    }
}
