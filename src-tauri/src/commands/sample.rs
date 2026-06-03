use std::path::Path;
use tauri::{AppHandle, Manager};

/// Recursively copies src into dst, creating dst if it does not exist.
/// If dst already exists it is removed first (reset-to-pristine semantics).
pub fn copy_dir_tree(src: &Path, dst: &Path) -> Result<(), String> {
    if dst.exists() {
        std::fs::remove_dir_all(dst)
            .map_err(|e| format!("Failed to remove existing sandbox: {}", e))?;
    }
    std::fs::create_dir_all(dst)
        .map_err(|e| format!("Failed to create sandbox directory: {}", e))?;
    for entry in std::fs::read_dir(src)
        .map_err(|e| format!("Failed to read source directory {:?}: {}", src, e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_tree(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("Failed to copy {:?}: {}", src_path, e))?;
        }
    }
    Ok(())
}

/// Copies the bundled sample-world resource tree to a writable sandbox at
/// `app_data_dir/sample-world/`, wiping any prior sandbox, and returns the
/// sandbox path.  The frontend follows up with `open_ledger` and skips
/// `add_recent_ledger` to keep the sample ephemeral.
#[tauri::command]
pub fn explore_sample_ledger(app: AppHandle) -> Result<String, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource directory: {}", e))?;
    let sample_src = resource_dir.join("sample-world");

    if !sample_src.exists() {
        return Err(format!(
            "Bundled sample-world not found at {:?}",
            sample_src
        ));
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    let sample_dst = app_data_dir.join("sample-world");

    copy_dir_tree(&sample_src, &sample_dst)?;

    Ok(sample_dst.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::copy_dir_tree;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn copy_dir_tree_copies_nested_tree() {
        let src = tempdir().unwrap();
        let dst_parent = tempdir().unwrap();
        let dst = dst_parent.path().join("output");

        fs::create_dir(src.path().join("subdir")).unwrap();
        fs::write(src.path().join("root.md"), "# Root").unwrap();
        fs::write(src.path().join("subdir").join("child.md"), "# Child").unwrap();

        copy_dir_tree(src.path(), &dst).unwrap();

        assert!(dst.join("root.md").exists());
        assert!(dst.join("subdir").join("child.md").exists());
        assert_eq!(fs::read_to_string(dst.join("root.md")).unwrap(), "# Root");
        assert_eq!(
            fs::read_to_string(dst.join("subdir").join("child.md")).unwrap(),
            "# Child"
        );
    }

    #[test]
    fn copy_dir_tree_replaces_existing_destination() {
        let src = tempdir().unwrap();
        let dst_parent = tempdir().unwrap();
        let dst = dst_parent.path().join("output");

        fs::write(src.path().join("first.md"), "First").unwrap();
        copy_dir_tree(src.path(), &dst).unwrap();
        assert!(dst.join("first.md").exists());

        // Change src: remove first.md, add second.md
        fs::remove_file(src.path().join("first.md")).unwrap();
        fs::write(src.path().join("second.md"), "Second").unwrap();
        copy_dir_tree(src.path(), &dst).unwrap();

        assert!(!dst.join("first.md").exists(), "old file must be gone after re-copy");
        assert!(dst.join("second.md").exists());
        assert_eq!(
            fs::read_to_string(dst.join("second.md")).unwrap(),
            "Second"
        );
    }
}
