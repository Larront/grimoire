use crate::vault::AppVault;
use std::path::{Path, PathBuf};
use tauri::State;

/// Validates that `relative` resolves to a path inside `vault_root`.
/// Both sides are canonicalized so the starts_with check works correctly on Windows
/// (where canonicalize returns \\?\ extended-length paths).
fn validate_path(vault_root: &Path, relative: &str) -> Result<PathBuf, String> {
    let canonical_root = vault_root
        .canonicalize()
        .map_err(|e| format!("Invalid vault root: {e}"))?;
    let joined = vault_root.join(relative);
    let canonical = joined
        .canonicalize()
        .map_err(|e| format!("Invalid path: {e}"))?;
    if !canonical.starts_with(&canonical_root) {
        return Err("Path escapes vault root".to_string());
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
        Err(format!("Unsupported image format: .{}", ext))
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

pub fn copy_image_file_to(vault_path: Option<&Path>, absolute_path: &str) -> Result<String, String> {
    let src = PathBuf::from(absolute_path);
    validate_image_extension(&src)?;
    let file_name = src
        .file_name()
        .ok_or("Invalid file path")?
        .to_string_lossy()
        .to_string();
    let vault_path = vault_path.ok_or("No vault open")?;
    let images_dir = vault_path.join("images");
    std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;
    let dest = resolve_image_filename(&images_dir, &file_name);
    let relative = format!("images/{}", dest.file_name().unwrap().to_string_lossy());
    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(relative)
}

#[tauri::command]
pub fn copy_image_file(absolute_path: String, vault: State<AppVault>) -> Result<String, String> {
    let state = vault.lock().map_err(|e| e.to_string())?;
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
    let relative = format!("images/{}", dest.file_name().unwrap().to_string_lossy());
    std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(relative)
}

#[tauri::command]
pub fn save_image_bytes(
    bytes: Vec<u8>,
    filename: String,
    vault: State<AppVault>,
) -> Result<String, String> {
    let state = vault.lock().map_err(|e| e.to_string())?;
    let vault_path = state.path.as_ref().ok_or("No vault open")?;
    let images_dir = vault_path.join("images");
    save_image_bytes_to(&images_dir, &filename, &bytes)
}

#[tauri::command]
pub fn get_image_absolute_path(
    relative_path: String,
    vault: State<AppVault>,
) -> Result<String, String> {
    let state = vault.lock().map_err(|e| e.to_string())?;
    let vault_path = state.path.as_ref().ok_or("No vault open")?;
    let canonical = validate_path(vault_path, &relative_path)?;
    canonical
        .to_str()
        .map(|s| s.to_string())
        .ok_or("Path contains invalid UTF-8".to_string())
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
        assert_eq!(rel, "images/pasted-image.png");
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
        assert_eq!(result.unwrap(), "images/clip 2.png");
        assert_eq!(fs::read(images_dir.join("clip 2.png")).unwrap(), b"second");
    }

    #[test]
    fn test_save_image_bytes_unicode_filename() {
        let dir = tempfile::tempdir().unwrap();
        let images_dir = dir.path().join("images");
        let result = save_image_bytes_to(&images_dir, "人物.png", b"fake-png-data");
        assert!(result.is_ok(), "Expected ok, got {:?}", result);
        let rel = result.unwrap();
        assert_eq!(rel, "images/人物.png");
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
        let vault = outer.path().join("vault");
        std::fs::create_dir(&vault).unwrap();
        let src = outer.path().join("portrait.png");
        fs::write(&src, b"png-bytes").unwrap();

        let rel = copy_image_file_to(Some(&vault), src.to_str().unwrap()).unwrap();
        assert_eq!(rel, "images/portrait.png");
        assert_eq!(fs::read(vault.join("images/portrait.png")).unwrap(), b"png-bytes");
    }

    #[test]
    fn test_copy_image_file_no_vault_open_returns_graceful_error() {
        let outer = tempfile::tempdir().unwrap();
        let src = outer.path().join("portrait.png");
        fs::write(&src, b"png-bytes").unwrap();

        let result = copy_image_file_to(None, src.to_str().unwrap());
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "No vault open");
    }

    #[test]
    fn test_copy_image_file_rejects_unsupported_extension() {
        let outer = tempfile::tempdir().unwrap();
        let vault = outer.path().join("vault");
        std::fs::create_dir(&vault).unwrap();
        let src = outer.path().join("icon.svg");
        fs::write(&src, b"<svg/>").unwrap();

        let result = copy_image_file_to(Some(&vault), src.to_str().unwrap());
        assert!(result.is_err());
        assert!(!vault.join("images").join("icon.svg").exists());
    }

    #[test]
    fn test_validate_path_rejects_parent_escape() {
        let outer = tempfile::tempdir().unwrap();
        let vault = outer.path().join("vault");
        std::fs::create_dir(&vault).unwrap();
        fs::write(outer.path().join("escape.png"), b"x").unwrap();

        let result = validate_path(&vault, "../escape.png");
        assert!(result.is_err(), "expected ../escape.png to be rejected");
    }

    #[test]
    fn test_validate_path_rejects_absolute_path() {
        let outer = tempfile::tempdir().unwrap();
        let vault = outer.path().join("vault");
        std::fs::create_dir(&vault).unwrap();
        let outside = outer.path().join("outside.png");
        fs::write(&outside, b"x").unwrap();

        let result = validate_path(&vault, outside.to_str().unwrap());
        assert!(result.is_err(), "expected absolute outside path to be rejected");
    }
}
