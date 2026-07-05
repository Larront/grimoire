use crate::ledger::AppLedger;
use std::path::{Path, PathBuf};
use tauri::State;

/// Validates that `relative` resolves to a path inside `ledger_root`.
/// Both sides are canonicalized so the starts_with check works correctly on Windows
/// (where canonicalize returns \\?\ extended-length paths).
fn validate_path(ledger_root: &Path, relative: &str) -> Result<PathBuf, String> {
    let canonical_root = ledger_root
        .canonicalize()
        .map_err(|e| format!("Invalid ledger root: {e}"))?;
    let joined = ledger_root.join(relative);
    let canonical = joined
        .canonicalize()
        .map_err(|e| format!("Invalid path: {e}"))?;
    if !canonical.starts_with(&canonical_root) {
        return Err("Path escapes ledger root".to_string());
    }
    Ok(canonical)
}

const SUPPORTED_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp"];

fn validate_image_extension(path: &PathBuf) -> Result<(), String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .ok_or_else(|| "File has no extension".to_string())?;
    if SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
        Ok(())
    } else {
        Err(format!("ERR_UNSUPPORTED_IMAGE: Unsupported image format: .{}", ext))
    }
}

pub fn resolve_image_filename(images_dir: &Path, file_name: &str) -> PathBuf {
    let stem = PathBuf::from(file_name)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let ext = PathBuf::from(file_name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let candidate = images_dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let mut counter = 2u32;
    loop {
        let path = images_dir.join(format!("{} {}{}", stem, counter, ext));
        if !path.exists() {
            return path;
        }
        counter += 1;
    }
}

pub fn copy_image_file_to(ledger_path: Option<&Path>, absolute_path: &str) -> Result<String, String> {
    let src = PathBuf::from(absolute_path);
    validate_image_extension(&src)?;
    let file_name = src
        .file_name()
        .ok_or("Invalid file path")?
        .to_string_lossy()
        .to_string();
    let ledger_path = ledger_path.ok_or("No ledger open")?;
    let images_dir = ledger_path.join(".grimoire").join("images");
    std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;
    let dest = resolve_image_filename(&images_dir, &file_name);
    let dest_name = dest
        .file_name()
        .ok_or("Invalid destination filename")?
        .to_string_lossy();
    let relative = format!(".grimoire/images/{}", dest_name);
    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(relative)
}

#[tauri::command]
#[specta::specta]
pub fn copy_image_file(absolute_path: String, ledger: State<AppLedger>) -> Result<String, String> {
    let state = ledger.lock().map_err(|e| e.to_string())?;
    copy_image_file_to(state.path.as_deref(), &absolute_path)
}

pub fn save_image_bytes_to(images_dir: &Path, filename: &str, bytes: &[u8]) -> Result<String, String> {
    let path = PathBuf::from(filename);
    validate_image_extension(&path)?;
    let file_name = path
        .file_name()
        .ok_or("Invalid filename")?
        .to_string_lossy()
        .to_string();
    std::fs::create_dir_all(images_dir).map_err(|e| e.to_string())?;
    let dest = resolve_image_filename(images_dir, &file_name);
    let dest_name = dest
        .file_name()
        .ok_or("Invalid destination filename")?
        .to_string_lossy();
    let relative = format!(".grimoire/images/{}", dest_name);
    std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(relative)
}

#[tauri::command]
#[specta::specta]
pub fn save_image_bytes(
    bytes: Vec<u8>,
    filename: String,
    ledger: State<AppLedger>,
) -> Result<String, String> {
    let state = ledger.lock().map_err(|e| e.to_string())?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?;
    let images_dir = ledger_path.join(".grimoire").join("images");
    save_image_bytes_to(&images_dir, &filename, &bytes)
}

#[tauri::command]
#[specta::specta]
pub fn get_image_absolute_path(
    relative_path: String,
    ledger: State<AppLedger>,
) -> Result<String, String> {
    let state = ledger.lock().map_err(|e| e.to_string())?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?;
    let canonical = validate_path(ledger_path, &relative_path)?;
    canonical
        .to_str()
        .map(|s| s.to_string())
        .ok_or("Path contains invalid UTF-8".to_string())
}

/// Resolve a ledger-relative PDF path to a validated absolute path for the
/// frontend to feed through `convertFileSrc` into PDF.js. Reuses `validate_path`
/// so path-traversal attempts are rejected exactly as for images. PDFs are
/// path-addressed (ADR-0011) — there is no id, just the ledger-relative path.
#[tauri::command]
#[specta::specta]
pub fn get_pdf_absolute_path(
    relative_path: String,
    ledger: State<AppLedger>,
) -> Result<String, String> {
    let state = ledger.lock().map_err(|e| e.to_string())?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?;
    let canonical = validate_path(ledger_path, &relative_path)?;
    canonical
        .to_str()
        .map(|s| s.to_string())
        .ok_or("Path contains invalid UTF-8".to_string())
}

/// Rename a PDF within the ledger, keeping it in its current folder. `old_path`
/// is the ledger-relative path to the existing `.pdf`; `new_stem` is the desired
/// filename without extension (the tree shows the stem, not the `.pdf`). Returns
/// the new ledger-relative path so the frontend can re-key its open tab.
///
/// PDFs are path-addressed (ADR-0011), so this is a pure filesystem rename,
/// guarded against traversal (via `validate_path` on the source and a
/// path-separator check on the new name) and against silently clobbering an
/// existing file. The one piece of canonical PDF state — `pdf_scene_links` rows
/// keyed by the path — is re-keyed by the `rename_pdf` command wrapper after this
/// succeeds (ADR-0011 §Consequences); this inner fn stays FS-only and testable.
pub fn rename_pdf_inner(
    ledger_path: &Path,
    old_path: &str,
    new_stem: &str,
) -> Result<String, String> {
    // The new name is a bare filename — reject anything that could redirect the
    // rename out of the PDF's folder or up the tree.
    let trimmed = new_stem.trim();
    if trimmed.is_empty() {
        return Err("PDF name cannot be empty".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("PDF name cannot contain a path separator".to_string());
    }

    // Validate the source resolves inside the ledger and exists.
    let src = validate_path(ledger_path, old_path)?;

    // Same parent folder, new stem, normalised `.pdf` extension.
    let new_rel = match old_path.rsplit_once('/') {
        Some((parent, _)) => format!("{}/{}.pdf", parent, trimmed),
        None => format!("{}.pdf", trimmed),
    };
    let dest = ledger_path.join(&new_rel);

    // An explicit rename onto a taken name is a user error worth surfacing —
    // the auto-suffix behaviour is reserved for drag-and-drop imports. On
    // case-insensitive filesystems a case-only rename hits the source file
    // itself; only a *different* file is a collision.
    if dest.exists() && dest.canonicalize().map(|d| d != src).unwrap_or(true) {
        return Err(format!(
            "ERR_NAME_TAKEN: A file named {}.pdf already exists",
            trimmed
        ));
    }

    std::fs::rename(&src, &dest).map_err(|e| format!("rename pdf: {}", e))?;
    Ok(new_rel)
}

#[tauri::command]
#[specta::specta]
pub fn rename_pdf(
    old_path: String,
    new_stem: String,
    ledger: State<AppLedger>,
) -> Result<String, String> {
    let state = ledger.lock().map_err(|e| e.to_string())?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?.clone();
    drop(state); // release lock before filesystem op

    let new_path = rename_pdf_inner(&ledger_path, &old_path, &new_stem)?;

    // The Scene-link table is keyed by the PDF path (ADR-0011 §Consequences), so a
    // rename must re-key its rows or the links would be orphaned at the old path.
    let mut state = ledger.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    crate::commands::pdf_scene_links::rewrite_pdf_path(conn, &old_path, &new_path)
        .map_err(|e| e.to_string())?;

    Ok(new_path)
}

/// Resolve a non-colliding filename in `dir` for a dropped PDF. An exact name is
/// used as-is; a collision auto-suffixes `Manual.pdf` → `Manual (2).pdf` →
/// `Manual (3).pdf` (the convention from #98/#102). The parenthesised form is
/// deliberately distinct from the image dedup (`portrait 2.png`) — PDFs follow
/// the filename convention the GM sees in their OS file manager.
fn resolve_pdf_filename(dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let p = PathBuf::from(file_name);
    let stem = p
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let ext = p
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let mut counter = 2u32;
    loop {
        let path = dir.join(format!("{} ({}){}", stem, counter, ext));
        if !path.exists() {
            return path;
        }
        counter += 1;
    }
}

fn validate_pdf_extension(path: &Path) -> Result<(), String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .ok_or_else(|| "File has no extension".to_string())?;
    if ext == "pdf" {
        Ok(())
    } else {
        Err(format!("ERR_UNSUPPORTED_PDF: Not a PDF: .{}", ext))
    }
}

/// Import dropped PDF bytes into the ledger at `target_folder` (ledger-relative,
/// forward-slash separated; empty string = ledger root). Name collisions
/// auto-suffix silently (`Manual (2).pdf`) — drag-and-drop never prompts. The
/// bytes are copied in, so nothing outside the ledger is referenced (ADR-0011:
/// PDFs are path-addressed; the returned ledger-relative path *is* the PDF's
/// identity). Traversal in either the folder or the filename is rejected.
pub fn import_pdf_bytes_to(
    ledger_root: &Path,
    target_folder: &str,
    filename: &str,
    bytes: &[u8],
) -> Result<String, String> {
    // Defense in depth: the editor drop handler only forwards PDFs, but the
    // backend must never trust the caller's filtering.
    let name_path = PathBuf::from(filename);
    validate_pdf_extension(&name_path)?;

    // The dropped name must be a bare filename, never a path that could redirect
    // the write out of the target folder.
    let file_name = name_path
        .file_name()
        .filter(|n| *n == name_path.as_os_str())
        .ok_or("Invalid filename")?
        .to_string_lossy()
        .to_string();

    // Resolve the destination directory. Empty folder = ledger root (a quick drop
    // on empty tree space); otherwise the folder must resolve inside the ledger.
    let folder = target_folder.trim();
    let dest_dir = if folder.is_empty() {
        ledger_root.to_path_buf()
    } else {
        validate_path(ledger_root, folder)?
    };
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let dest = resolve_pdf_filename(&dest_dir, &file_name);
    std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;

    // Build the ledger-relative path from the (validated) folder string rather
    // than stripping the canonicalised dest — on Windows the canonical form is a
    // `\\?\` extended path that won't share `ledger_root`'s prefix.
    let written_name = dest
        .file_name()
        .ok_or("Invalid destination filename")?
        .to_string_lossy();
    let rel = if folder.is_empty() {
        written_name.to_string()
    } else {
        format!("{}/{}", folder.trim_end_matches('/'), written_name)
    };
    Ok(rel)
}

#[tauri::command]
#[specta::specta]
pub fn save_pdf_bytes(
    bytes: Vec<u8>,
    filename: String,
    target_folder: String,
    ledger: State<AppLedger>,
) -> Result<String, String> {
    let state = ledger.lock().map_err(|e| e.to_string())?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?.clone();
    drop(state); // release lock before filesystem op
    import_pdf_bytes_to(&ledger_path, &target_folder, &filename, &bytes)
}

/// Delete a PDF from the ledger. PDFs are path-addressed (ADR-0011) — no DB row
/// to clean up, just the file. `validate_path` rejects any traversal attempt.
pub fn delete_pdf_inner(ledger_path: &Path, pdf_path: &str) -> Result<(), String> {
    let abs = validate_path(ledger_path, pdf_path)?;
    std::fs::remove_file(&abs).map_err(|e| format!("remove pdf: {}", e))
}

#[tauri::command]
#[specta::specta]
pub fn delete_pdf(pdf_path: String, ledger: State<AppLedger>) -> Result<(), String> {
    let state = ledger.lock().map_err(|e| e.to_string())?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?.clone();
    drop(state); // release lock before filesystem op
    delete_pdf_inner(&ledger_path, &pdf_path)?;

    // A deleted PDF's Scene-links have no referent and the PDF is not a DB row that
    // could cascade, so remove them explicitly (ADR-0011 §Consequences).
    let mut state = ledger.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    crate::commands::pdf_scene_links::delete_links_for_pdf(conn, &pdf_path)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_no_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let result = resolve_image_filename(dir.path(), "portrait.png");
        assert_eq!(result, dir.path().join("portrait.png"));
    }

    #[test]
    fn test_one_conflict() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("portrait.png"), "").unwrap();
        let result = resolve_image_filename(dir.path(), "portrait.png");
        assert_eq!(result, dir.path().join("portrait 2.png"));
    }

    #[test]
    fn test_multiple_conflicts() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("portrait.png"), "").unwrap();
        fs::write(dir.path().join("portrait 2.png"), "").unwrap();
        let result = resolve_image_filename(dir.path(), "portrait.png");
        assert_eq!(result, dir.path().join("portrait 3.png"));
    }

    #[test]
    fn test_validate_extension_valid() {
        for ext in &["portrait.png", "photo.jpg", "photo.jpeg", "anim.gif", "img.webp"] {
            assert!(validate_image_extension(&PathBuf::from(ext)).is_ok(), "Expected ok for {}", ext);
        }
    }

    #[test]
    fn test_validate_extension_invalid() {
        for ext in &["icon.svg", "virus.exe", "track.mp3", "doc.pdf"] {
            assert!(validate_image_extension(&PathBuf::from(ext)).is_err(), "Expected err for {}", ext);
        }
    }

    #[test]
    fn test_save_image_bytes_end_to_end() {
        let dir = tempfile::tempdir().unwrap();
        let images_dir = dir.path().join("images");
        let fake_bytes = b"fake-png-data";
        let result = save_image_bytes_to(&images_dir, "pasted-image.png", fake_bytes);
        assert!(result.is_ok(), "Expected ok, got {:?}", result);
        let rel = result.unwrap();
        assert_eq!(rel, ".grimoire/images/pasted-image.png");
        let written = fs::read(images_dir.join("pasted-image.png")).unwrap();
        assert_eq!(written, fake_bytes);
    }

    #[test]
    fn test_save_image_bytes_deduplicates_filename() {
        let dir = tempfile::tempdir().unwrap();
        let images_dir = dir.path().join("images");
        fs::create_dir_all(&images_dir).unwrap();
        fs::write(images_dir.join("clip.png"), b"first").unwrap();
        let result = save_image_bytes_to(&images_dir, "clip.png", b"second");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), ".grimoire/images/clip 2.png");
        assert_eq!(fs::read(images_dir.join("clip 2.png")).unwrap(), b"second");
    }

    #[test]
    fn test_save_image_bytes_unicode_filename() {
        let dir = tempfile::tempdir().unwrap();
        let images_dir = dir.path().join("images");
        let result = save_image_bytes_to(&images_dir, "人物.png", b"fake-png-data");
        assert!(result.is_ok(), "Expected ok, got {:?}", result);
        let rel = result.unwrap();
        assert_eq!(rel, ".grimoire/images/人物.png");
        assert!(images_dir.join("人物.png").exists());
        assert_eq!(fs::read(images_dir.join("人物.png")).unwrap(), b"fake-png-data");
    }

    #[test]
    fn test_save_image_bytes_rejects_unsupported_extension() {
        let dir = tempfile::tempdir().unwrap();
        let images_dir = dir.path().join("images");
        let result = save_image_bytes_to(&images_dir, "script.svg", b"<svg/>");
        assert!(result.is_err());
    }

    #[test]
    fn test_copy_image_file_end_to_end() {
        let outer = tempfile::tempdir().unwrap();
        let ledger = outer.path().join("ledger");
        std::fs::create_dir(&ledger).unwrap();
        let src = outer.path().join("portrait.png");
        fs::write(&src, b"png-bytes").unwrap();

        let rel = copy_image_file_to(Some(&ledger), src.to_str().unwrap()).unwrap();
        assert_eq!(rel, ".grimoire/images/portrait.png");
        assert_eq!(
            fs::read(ledger.join(".grimoire/images/portrait.png")).unwrap(),
            b"png-bytes"
        );
    }

    #[test]
    fn test_copy_image_file_no_ledger_open_returns_graceful_error() {
        let outer = tempfile::tempdir().unwrap();
        let src = outer.path().join("portrait.png");
        fs::write(&src, b"png-bytes").unwrap();

        let result = copy_image_file_to(None, src.to_str().unwrap());
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "No ledger open");
    }

    #[test]
    fn test_copy_image_file_rejects_unsupported_extension() {
        let outer = tempfile::tempdir().unwrap();
        let ledger = outer.path().join("ledger");
        std::fs::create_dir(&ledger).unwrap();
        let src = outer.path().join("icon.svg");
        fs::write(&src, b"<svg/>").unwrap();

        let result = copy_image_file_to(Some(&ledger), src.to_str().unwrap());
        assert!(result.is_err());
        assert!(!ledger.join(".grimoire/images").join("icon.svg").exists());
    }

    #[test]
    fn test_validate_path_rejects_parent_escape() {
        let outer = tempfile::tempdir().unwrap();
        let ledger = outer.path().join("ledger");
        std::fs::create_dir(&ledger).unwrap();
        fs::write(outer.path().join("escape.png"), b"x").unwrap();

        let result = validate_path(&ledger, "../escape.png");
        assert!(result.is_err(), "expected ../escape.png to be rejected");
    }

    #[test]
    fn test_validate_path_resolves_pdf_inside_ledger() {
        let outer = tempfile::tempdir().unwrap();
        let ledger = outer.path().join("ledger");
        std::fs::create_dir(&ledger).unwrap();
        fs::write(ledger.join("rulebook.pdf"), b"%PDF-1.4").unwrap();

        let resolved = validate_path(&ledger, "rulebook.pdf").unwrap();
        assert!(resolved.ends_with("rulebook.pdf"));
        assert!(resolved.is_absolute());
        assert!(resolved.exists());
    }

    #[test]
    fn test_validate_path_rejects_pdf_traversal() {
        let outer = tempfile::tempdir().unwrap();
        let ledger = outer.path().join("ledger");
        std::fs::create_dir(&ledger).unwrap();
        fs::write(outer.path().join("secret.pdf"), b"%PDF-1.4").unwrap();

        let result = validate_path(&ledger, "../secret.pdf");
        assert!(result.is_err(), "expected ../secret.pdf to be rejected");
    }

    #[test]
    fn test_validate_path_rejects_absolute_path() {
        let outer = tempfile::tempdir().unwrap();
        let ledger = outer.path().join("ledger");
        std::fs::create_dir(&ledger).unwrap();
        let outside = outer.path().join("outside.png");
        fs::write(&outside, b"x").unwrap();

        let result = validate_path(&ledger, outside.to_str().unwrap());
        assert!(result.is_err(), "expected absolute outside path to be rejected");
    }

    // ── rename_pdf tests ──────────────────────────────────────────────────────

    #[test]
    fn test_rename_pdf_renames_file_and_returns_new_path() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("rulebook.pdf"), b"%PDF-1.4").unwrap();

        let new_rel = rename_pdf_inner(dir.path(), "rulebook.pdf", "Player's Handbook").unwrap();

        assert_eq!(new_rel, "Player's Handbook.pdf");
        assert!(!dir.path().join("rulebook.pdf").exists());
        assert!(dir.path().join("Player's Handbook.pdf").exists());
    }

    #[test]
    fn test_rename_pdf_preserves_parent_folder() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("rulebooks")).unwrap();
        fs::write(dir.path().join("rulebooks").join("DMG.pdf"), b"%PDF-1.4").unwrap();

        let new_rel =
            rename_pdf_inner(dir.path(), "rulebooks/DMG.pdf", "Dungeon Master Guide").unwrap();

        assert_eq!(new_rel, "rulebooks/Dungeon Master Guide.pdf");
        assert!(dir.path().join("rulebooks/Dungeon Master Guide.pdf").exists());
        assert!(!dir.path().join("rulebooks/DMG.pdf").exists());
    }

    #[test]
    fn test_rename_pdf_allows_case_only_rename() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("Manual.pdf"), b"%PDF-1.4").unwrap();

        // On case-insensitive filesystems the destination "exists" (it's the
        // source itself) — this must not be reported as a collision.
        let new_rel = rename_pdf_inner(dir.path(), "Manual.pdf", "manual").unwrap();

        assert_eq!(new_rel, "manual.pdf");
        assert!(dir.path().join("manual.pdf").exists());
    }

    #[test]
    fn test_rename_pdf_rejects_collision() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.pdf"), b"%PDF-1.4").unwrap();
        fs::write(dir.path().join("b.pdf"), b"%PDF-1.4").unwrap();

        let result = rename_pdf_inner(dir.path(), "a.pdf", "b");
        assert!(result.is_err(), "expected collision to be rejected");
        assert!(result.unwrap_err().starts_with("ERR_NAME_TAKEN"));
        // Original is untouched.
        assert!(dir.path().join("a.pdf").exists());
    }

    #[test]
    fn test_rename_pdf_rejects_path_separator_in_name() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.pdf"), b"%PDF-1.4").unwrap();

        assert!(rename_pdf_inner(dir.path(), "a.pdf", "../escape").is_err());
        assert!(rename_pdf_inner(dir.path(), "a.pdf", "sub/name").is_err());
        assert!(dir.path().join("a.pdf").exists());
    }

    #[test]
    fn test_rename_pdf_rejects_empty_name() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.pdf"), b"%PDF-1.4").unwrap();

        assert!(rename_pdf_inner(dir.path(), "a.pdf", "   ").is_err());
    }

    #[test]
    fn test_rename_pdf_rejects_traversal_old_path() {
        let outer = tempfile::tempdir().unwrap();
        let ledger = outer.path().join("ledger");
        std::fs::create_dir(&ledger).unwrap();
        fs::write(outer.path().join("secret.pdf"), b"%PDF-1.4").unwrap();

        let result = rename_pdf_inner(&ledger, "../secret.pdf", "stolen");
        assert!(result.is_err(), "expected traversal old_path to be rejected");
        assert!(outer.path().join("secret.pdf").exists());
    }

    // ── delete_pdf tests ──────────────────────────────────────────────────────

    #[test]
    fn test_delete_pdf_removes_file() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("rulebook.pdf"), b"%PDF-1.4").unwrap();

        delete_pdf_inner(dir.path(), "rulebook.pdf").unwrap();
        assert!(!dir.path().join("rulebook.pdf").exists());
    }

    #[test]
    fn test_delete_pdf_rejects_traversal() {
        let outer = tempfile::tempdir().unwrap();
        let ledger = outer.path().join("ledger");
        std::fs::create_dir(&ledger).unwrap();
        fs::write(outer.path().join("secret.pdf"), b"%PDF-1.4").unwrap();

        let result = delete_pdf_inner(&ledger, "../secret.pdf");
        assert!(result.is_err(), "expected traversal to be rejected");
        assert!(outer.path().join("secret.pdf").exists(), "outside file must survive");
    }

    // ── save_pdf_bytes (drag-and-drop import) tests ───────────────────────────

    #[test]
    fn test_import_pdf_bytes_writes_to_ledger_root() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = b"%PDF-1.4 fake";

        let rel = import_pdf_bytes_to(dir.path(), "", "Manual.pdf", bytes).unwrap();

        assert_eq!(rel, "Manual.pdf");
        assert_eq!(fs::read(dir.path().join("Manual.pdf")).unwrap(), bytes);
    }

    #[test]
    fn test_import_pdf_bytes_writes_to_target_folder() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("rulebooks")).unwrap();
        let bytes = b"%PDF-1.4 fake";

        let rel = import_pdf_bytes_to(dir.path(), "rulebooks", "DMG.pdf", bytes).unwrap();

        assert_eq!(rel, "rulebooks/DMG.pdf");
        assert_eq!(fs::read(dir.path().join("rulebooks/DMG.pdf")).unwrap(), bytes);
    }

    #[test]
    fn test_import_pdf_bytes_auto_suffixes_collision() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("Manual.pdf"), b"original").unwrap();

        let rel = import_pdf_bytes_to(dir.path(), "", "Manual.pdf", b"dropped").unwrap();

        assert_eq!(rel, "Manual (2).pdf");
        // The original is untouched and the dropped bytes land in the suffixed file.
        assert_eq!(fs::read(dir.path().join("Manual.pdf")).unwrap(), b"original");
        assert_eq!(fs::read(dir.path().join("Manual (2).pdf")).unwrap(), b"dropped");
    }

    #[test]
    fn test_import_pdf_bytes_auto_suffixes_multiple_collisions() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("Manual.pdf"), b"x").unwrap();
        fs::write(dir.path().join("Manual (2).pdf"), b"x").unwrap();

        let rel = import_pdf_bytes_to(dir.path(), "", "Manual.pdf", b"dropped").unwrap();

        assert_eq!(rel, "Manual (3).pdf");
        assert!(dir.path().join("Manual (3).pdf").exists());
    }

    #[test]
    fn test_import_pdf_bytes_rejects_non_pdf() {
        let dir = tempfile::tempdir().unwrap();

        let result = import_pdf_bytes_to(dir.path(), "", "notes.txt", b"x");
        assert!(result.is_err(), "expected non-PDF to be rejected");
        assert!(!dir.path().join("notes.txt").exists());
    }

    #[test]
    fn test_import_pdf_bytes_rejects_path_in_filename() {
        let dir = tempfile::tempdir().unwrap();

        assert!(import_pdf_bytes_to(dir.path(), "", "../escape.pdf", b"x").is_err());
        assert!(import_pdf_bytes_to(dir.path(), "", "sub/evil.pdf", b"x").is_err());
        assert!(!dir.path().join("escape.pdf").exists());
    }

    #[test]
    fn test_import_pdf_bytes_rejects_target_folder_traversal() {
        let outer = tempfile::tempdir().unwrap();
        let ledger = outer.path().join("ledger");
        std::fs::create_dir(&ledger).unwrap();

        let result = import_pdf_bytes_to(&ledger, "..", "evil.pdf", b"x");
        assert!(result.is_err(), "expected target-folder traversal to be rejected");
        assert!(!outer.path().join("evil.pdf").exists());
    }
}
