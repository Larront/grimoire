// Deleting a GM's own files: notes, folders and PDFs go to the system's
// Recycle Bin (the Trash on macOS and Linux), not out of existence.
//
// The owner's call in the 2026-10 design review. A world is a folder of plain
// files the GM owns, and a delete from the file tree used to be
// `remove_dir_all` behind a five-second Undo toast: a folder of notes was gone
// the moment the toast was. From the bin a GM can bring it back whenever they
// notice, with the OS's own tools, and the file watcher picks it up as it
// arrives. Maps and scenes don't come here — what makes one lives in the
// database, which no recycle bin gives back — so they keep their Undo toast.

use std::path::Path;

/// Send `path`, a file or a folder, to the Recycle Bin.
///
/// `ERR_RECYCLE` when the OS won't take it (a drive with no bin, a file in
/// use), so the frontend can say so rather than claim it went.
pub(crate) fn to_recycle_bin(path: &Path) -> Result<(), String> {
    discard(path).map_err(|e| {
        format!(
            "ERR_RECYCLE: couldn't move '{}' to the Recycle Bin: {e}",
            path.display()
        )
    })
}

#[cfg(not(test))]
fn discard(path: &Path) -> Result<(), String> {
    trash::delete(path).map_err(|e| e.to_string())
}

// The tests delete for real rather than fill the bin of whoever runs them.
#[cfg(test)]
fn discard(path: &Path) -> Result<(), String> {
    let gone = if path.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    };
    gone.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_refusal_is_said_as_err_recycle() {
        let dir = tempfile::tempdir().unwrap();
        let err = to_recycle_bin(&dir.path().join("not-there.md")).unwrap_err();
        assert!(err.starts_with("ERR_RECYCLE:"), "{err}");
    }
}
