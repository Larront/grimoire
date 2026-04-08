use crate::vault::AppVault;
use std::path::PathBuf;
use tauri::State;

const SUPPORTED_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "svg"];

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

pub fn resolve_image_filename(images_dir: &PathBuf, file_name: &str) -> PathBuf {
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

#[tauri::command]
pub fn copy_image_file(absolute_path: String, vault: State<AppVault>) -> Result<String, String> {
    let src = PathBuf::from(&absolute_path);
    validate_image_extension(&src)?;
    let file_name = src
        .file_name()
        .ok_or("Invalid file path")?
        .to_string_lossy()
        .to_string();

    let (dest, relative) = {
        let state = vault.lock().map_err(|e| e.to_string())?;
        let vault_path = state.path.as_ref().ok_or("No vault open")?;
        let images_dir = vault_path.join("images");
        std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;
        let dest = resolve_image_filename(&images_dir, &file_name);
        let relative = format!("images/{}", dest.file_name().unwrap().to_string_lossy());
        (dest, relative)
    };

    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(relative)
}

#[tauri::command]
pub fn save_image_bytes(
    bytes: Vec<u8>,
    filename: String,
    vault: State<AppVault>,
) -> Result<String, String> {
    let path = PathBuf::from(&filename);
    validate_image_extension(&path)?;
    let file_name = path
        .file_name()
        .ok_or("Invalid filename")?
        .to_string_lossy()
        .to_string();

    let (dest, relative) = {
        let state = vault.lock().map_err(|e| e.to_string())?;
        let vault_path = state.path.as_ref().ok_or("No vault open")?;
        let images_dir = vault_path.join("images");
        std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;
        let dest = resolve_image_filename(&images_dir, &file_name);
        let relative = format!("images/{}", dest.file_name().unwrap().to_string_lossy());
        (dest, relative)
    };

    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(relative)
}

#[tauri::command]
pub fn get_image_absolute_path(
    relative_path: String,
    vault: State<AppVault>,
) -> Result<String, String> {
    let state = vault.lock().map_err(|e| e.to_string())?;
    let vault_path = state.path.as_ref().ok_or("No vault open")?;
    vault_path
        .join(&relative_path)
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
        let result = resolve_image_filename(&dir.path().to_path_buf(), "portrait.png");
        assert_eq!(result, dir.path().join("portrait.png"));
    }

    #[test]
    fn test_one_conflict() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("portrait.png"), "").unwrap();
        let result = resolve_image_filename(&dir.path().to_path_buf(), "portrait.png");
        assert_eq!(result, dir.path().join("portrait 2.png"));
    }

    #[test]
    fn test_multiple_conflicts() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("portrait.png"), "").unwrap();
        fs::write(dir.path().join("portrait 2.png"), "").unwrap();
        let result = resolve_image_filename(&dir.path().to_path_buf(), "portrait.png");
        assert_eq!(result, dir.path().join("portrait 3.png"));
    }

    #[test]
    fn test_validate_extension_valid() {
        for ext in &["portrait.png", "photo.jpg", "icon.svg", "anim.gif", "img.webp"] {
            assert!(validate_image_extension(&PathBuf::from(ext)).is_ok(), "Expected ok for {}", ext);
        }
    }

    #[test]
    fn test_validate_extension_invalid() {
        for ext in &["virus.exe", "track.mp3", "doc.pdf"] {
            assert!(validate_image_extension(&PathBuf::from(ext)).is_err(), "Expected err for {}", ext);
        }
    }
}
