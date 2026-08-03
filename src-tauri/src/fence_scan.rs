//! Finding a fenced [[Note Block]] in a note's text, from the backend.
//!
//! CommonMark fence mechanics and nothing above them: where a fence opens, which
//! line closes it, and what a body line looks like with its nesting taken off and
//! put back. No block's grammar is in here, which is the line that makes sharing
//! this safe.
//!
//! ## Why the backend reads fences at all
//!
//! ADR-0016 §3 puts a block's parser in the editor, and the Rust side is meant to
//! know nothing about block grammar. Two jobs are the standing exceptions, both
//! about *files* rather than documents:
//!
//!   * a [[Format Migration]] rewriting a frozen grammar into its successor
//!     (`format_migration/timeline_v1.rs`, `scene_v2.rs`);
//!   * a scene rename bringing the name cached in every referencing note along with
//!     it (`scene_fence.rs`).
//!
//! Each of those holds its own reading of the *grammar inside* the fence — a
//! migration's is deliberately a frozen copy, because the live serializer will keep
//! moving. What none of them should hold is a private copy of *this*, which is why
//! it was extracted after the third one appeared: the parts below have no version, so
//! three copies could only ever drift apart by accident rather than on purpose.
//!
//! Nesting is the whole reason this is more than a `starts_with`: a fence can sit
//! inside a Callout, and #158 is the standing reminder that a column-zero-only scan
//! renders those as dead grey code boxes.

/// An opening fence: what came before it on the line, and the run of fence
/// characters, so the matching close can be recognised.
pub struct Open {
    /// Indentation and blockquote markers ahead of the fence.
    pub prefix: String,
    fence_char: char,
    len: usize,
}

/// The leading run of indentation and blockquote markers on a line.
///
/// Public because Scene's migration needs it for a line that is not a fence at all —
/// the legacy `<scene-block>` tag it replaces, whose nesting the fence has to inherit.
pub fn nesting_len(line: &str) -> usize {
    line.len() - line.trim_start_matches([' ', '\t', '>']).len()
}

/// The fence this line opens for the block called `name`, or `None`.
///
/// The info string must be the block's name and nothing else — the same
/// byte-identity rule the editor's own claim follows (`fence-claim.ts`): nothing
/// here could re-emit the extra characters of a ` ```timeline {foo} `, so claiming
/// it would edit a GM's file.
pub fn open_fence(line: &str, name: &str) -> Option<Open> {
    let (prefix, rest) = line.split_at(nesting_len(line));
    let fence_char = rest.chars().next()?;
    if fence_char != '`' && fence_char != '~' {
        return None;
    }
    let len = rest.chars().take_while(|c| *c == fence_char).count();
    if len < 3 || rest[len..].trim() != name {
        return None;
    }
    Some(Open {
        prefix: prefix.to_string(),
        fence_char,
        len,
    })
}

/// Whether this line closes `open`.
pub fn is_close_fence(line: &str, open: &Open) -> bool {
    let rest = &line[nesting_len(line)..];
    let run = rest.chars().take_while(|c| *c == open.fence_char).count();
    run >= open.len && rest[run..].trim().is_empty()
}

/// A body line with its nesting removed. Exact when the line carries the opening
/// fence's prefix; otherwise whatever indentation and quoting it does carry, so a
/// lazily-continued blockquote still yields its content.
pub fn strip_prefix<'a>(line: &'a str, prefix: &str) -> &'a str {
    match line.strip_prefix(prefix) {
        Some(rest) => rest,
        None => &line[nesting_len(line)..],
    }
}

/// Put the nesting back on a rewritten body line. A line that is now blank takes
/// the prefix with its trailing space dropped — `>` rather than `> ` — which is what
/// a markdown writer emits, so a rewritten file is already in the shape the next
/// save would put it in.
pub fn reattach(prefix: &str, line: &str) -> String {
    if line.is_empty() {
        prefix.trim_end().to_string()
    } else {
        format!("{prefix}{line}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opens(line: &str, name: &str) -> bool {
        open_fence(line, name).is_some()
    }

    #[test]
    fn a_fence_opens_when_its_info_string_is_the_block_name_and_nothing_else() {
        assert!(opens("```timeline", "timeline"));
        assert!(opens("~~~timeline", "timeline"));
        assert!(opens("````timeline", "timeline"), "more than three is still a fence");
        assert!(opens("```timeline  ", "timeline"), "trailing space is not an info string");

        assert!(!opens("```timeline extra", "timeline"), "nothing here could re-emit it");
        assert!(!opens("```timelines", "timeline"));
        assert!(!opens("``timeline", "timeline"), "two backticks is inline code");
        assert!(!opens("```", "timeline"));
        assert!(!opens("```scene", "timeline"), "another block's fence is not ours");
        assert!(!opens("", "timeline"));
    }

    #[test]
    fn a_fence_nested_inside_a_callout_opens_and_keeps_its_prefix() {
        // #158: the reason this is not a `starts_with`.
        let open = open_fence("> ```scene", "scene").expect("a quoted fence still opens");
        assert_eq!(open.prefix, "> ");

        let indented = open_fence("  > > ```scene", "scene").expect("any nesting opens");
        assert_eq!(indented.prefix, "  > > ");
    }

    #[test]
    fn the_close_matches_its_own_character_and_at_least_its_own_length() {
        let backticks = open_fence("```scene", "scene").unwrap();
        assert!(is_close_fence("```", &backticks));
        assert!(is_close_fence("````", &backticks), "a longer close is legal");
        assert!(is_close_fence("> ```", &backticks), "nesting is skipped");
        assert!(is_close_fence("```   ", &backticks));
        assert!(!is_close_fence("``", &backticks), "a shorter run does not close");
        assert!(!is_close_fence("~~~", &backticks), "the other character does not close");
        assert!(!is_close_fence("``` trailing", &backticks));

        let tildes = open_fence("~~~~scene", "scene").unwrap();
        assert!(is_close_fence("~~~~", &tildes));
        assert!(!is_close_fence("~~~", &tildes), "shorter than the open does not close");
    }

    #[test]
    fn a_body_line_gives_up_its_nesting_and_takes_it_back() {
        let open = open_fence("> ```scene", "scene").unwrap();
        assert_eq!(strip_prefix("> Id: 7", &open.prefix), "Id: 7");
        assert_eq!(reattach(&open.prefix, "Id: 7"), "> Id: 7");

        // A lazily-continued blockquote: the line's own quoting is not the opening
        // fence's, and its content is still reachable.
        assert_eq!(strip_prefix(">Id: 7", &open.prefix), "Id: 7");
        assert_eq!(strip_prefix("Id: 7", &open.prefix), "Id: 7");

        // A blank line inside a quote is `>`, not `> ` — what a markdown writer emits.
        assert_eq!(reattach("> ", ""), ">");
        assert_eq!(reattach("", ""), "");
    }
}
