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

/// Names in the order a person reads them: case aside, and a run of digits by its
/// value, so "Annal 2" comes before "Annal 10". The file tree sorted as text — Annal
/// 1, 10, 100, 101 … 2 — while templates sorted this way (2026-10 design review). The
/// frontend's `compareNames` (`src/lib/utils/file-name.ts`) is the same rule.
pub(crate) fn compare_names(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let (mut x, mut y) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (x.peek().copied(), y.peek().copied()) {
            // Equal but for case: settle it, so the order never depends on input order.
            (None, None) => return a.cmp(b),
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(c), Some(d)) if c.is_ascii_digit() && d.is_ascii_digit() => {
                let digits = |it: &mut std::iter::Peekable<std::str::Chars>| {
                    let mut run = String::new();
                    while let Some(ch) = it.peek().copied().filter(char::is_ascii_digit) {
                        run.push(ch);
                        it.next();
                    }
                    run
                };
                let (m, n) = (digits(&mut x), digits(&mut y));
                let (m, n) = (m.trim_start_matches('0'), n.trim_start_matches('0'));
                // Without leading zeros, a longer run is a larger number.
                match m.len().cmp(&n.len()).then_with(|| m.cmp(n)) {
                    Ordering::Equal => continue,
                    other => return other,
                }
            }
            (Some(c), Some(d)) => {
                x.next();
                y.next();
                match c.to_lowercase().cmp(d.to_lowercase()) {
                    Ordering::Equal => continue,
                    other => return other,
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orders_numbers_by_their_value() {
        let mut names = vec!["Annal 10", "Annal 2", "Annal 1", "Annal 100", "Annal 11"];
        names.sort_by(|a, b| compare_names(a, b));
        assert_eq!(names, ["Annal 1", "Annal 2", "Annal 10", "Annal 11", "Annal 100"]);
    }

    #[test]
    fn ignores_case_but_settles_ties_the_same_way_every_time() {
        let mut names = vec!["mira", "Aldric", "Mira", "aldric"];
        names.sort_by(|a, b| compare_names(a, b));
        assert_eq!(names, ["Aldric", "aldric", "Mira", "mira"]);
    }

    #[test]
    fn reads_leading_zeros_as_the_same_number() {
        assert_eq!(compare_names("Session 007", "Session 7").is_eq(), false);
        let mut names = vec!["Session 10", "Session 007"];
        names.sort_by(|a, b| compare_names(a, b));
        assert_eq!(names, ["Session 007", "Session 10"]);
    }

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
