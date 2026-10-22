// What a GM-typed name has to be before it can become a file or folder name.
//
// One rule for every surface that turns a name into a path, so a template and a
// folder refuse the same things with the same code, and the frontend's
// `badNameReason` (`src/lib/utils/file-name.ts`) can say why as the GM types.
// Windows is the strictest of the three platforms, and a ledger may be synced
// between them, so its rules apply everywhere: before this, `:` and `?` reached
// the OS and came back as "Something went wrong" (2026-10 design review).

/// Characters no file or folder name may contain on Windows.
const FORBIDDEN: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/// Trim `name` and check it can stand as a file or folder name.
///
/// `ERR_EMPTY_NAME` for nothing but whitespace; `ERR_BAD_NAME` for a forbidden
/// character, a control character, `.` or `..`, or a trailing full stop (which
/// Windows silently drops, so the file would not carry the name shown).
pub(crate) fn check_file_name<'a>(name: &'a str, what: &str) -> Result<&'a str, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(format!("ERR_EMPTY_NAME: A {what} needs a name"));
    }
    if trimmed.chars().any(|c| FORBIDDEN.contains(&c) || c.is_control()) {
        return Err(format!("ERR_BAD_NAME: '{trimmed}' contains a character a {what} name can't"));
    }
    if trimmed == "." || trimmed == ".." || trimmed.ends_with('.') {
        return Err(format!("ERR_BAD_NAME: '{trimmed}' is not a {what} name"));
    }
    Ok(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_and_trims_an_ordinary_name() {
        assert_eq!(check_file_name("  The Ember Keep ", "template"), Ok("The Ember Keep"));
    }

    #[test]
    fn refuses_an_empty_name() {
        assert!(check_file_name("   ", "template").unwrap_err().starts_with("ERR_EMPTY_NAME"));
    }

    #[test]
    fn refuses_every_character_windows_refuses() {
        for c in ['/', '\\', ':', '*', '?', '"', '<', '>', '|', '\t'] {
            let err = check_file_name(&format!("Bad{c}Name"), "template").unwrap_err();
            assert!(err.starts_with("ERR_BAD_NAME"), "{c:?}: {err}");
        }
    }

    #[test]
    fn refuses_dots_and_a_trailing_full_stop() {
        for name in [".", "..", "Annals."] {
            let err = check_file_name(name, "folder").unwrap_err();
            assert!(err.starts_with("ERR_BAD_NAME"), "{name}: {err}");
        }
    }

    #[test]
    fn allows_dots_inside_a_name() {
        assert!(check_file_name("Vol. 2 notes", "folder").is_ok());
    }
}
