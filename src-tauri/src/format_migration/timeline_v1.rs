//! The Timeline grammar change — format 0 → 1, and the first real
//! [[Format Migration]] (issue #184).
//!
//! Timeline's format changed over a **bug**, not consistency. Under the old
//! grammar any blank line was a record boundary, so a hand-authored
//! two-paragraph description was silently split into a second, untitled event on
//! the next autosave. The new grammar makes the event's `#` heading the boundary,
//! after which blank lines inside a description are just prose.
//!
//! This module is that change written down twice over, deliberately:
//!
//! **It is the old parser followed by the new serializer**, both re-implemented
//! here rather than shared with `src/lib/editor/timeline-block.ts`. A migration
//! is a snapshot of two frozen grammars — the live serializer will keep moving,
//! and the day it does, a migration that borrowed it would start writing format
//! 3 while claiming to write format 1. The duplication is the point; the tests
//! below pin both halves against the TypeScript ones.
//!
//! **Deciding a body is old-format is the whole risk.** A false positive feeds
//! new-format text to the old parser and mangles it; a false negative leaves a
//! fence behind, and with no reader for the old grammar its content is dropped
//! on the next save. Two markers decide it (see `is_old_format`), and the
//! new-format one is not optional: a partial failure means the next run scans a
//! vault where some files are *already* migrated.

use super::Rewrite;

/// Rewrite every old-format ` ```timeline ` fence in a note's text.
///
/// `None` means untouched — no timeline fences, or every one of them already on
/// the new grammar. Fence lines themselves are never rewritten, so a `~~~` fence
/// or one indented inside a callout keeps the characters the GM used.
pub fn apply(text: &str) -> Option<Rewrite> {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut out: Vec<String> = Vec::with_capacity(lines.len());
    let mut warnings: Vec<String> = Vec::new();
    let mut changed = false;

    let mut i = 0;
    while i < lines.len() {
        let open = match open_fence(lines[i]) {
            Some(open) => open,
            None => {
                out.push(lines[i].to_string());
                i += 1;
                continue;
            }
        };

        // Gather the fence body, keeping the raw lines so an untouched fence can
        // be re-emitted byte for byte rather than reconstructed.
        let mut raw: Vec<&str> = Vec::new();
        let mut j = i + 1;
        while j < lines.len() && !is_close_fence(lines[j], &open) {
            raw.push(lines[j]);
            j += 1;
        }
        let body: Vec<&str> = raw.iter().map(|l| strip_prefix(l, &open.prefix)).collect();

        out.push(lines[i].to_string());
        match migrate_body(&body) {
            Some((new_body, mut warns)) => {
                changed = true;
                warnings.append(&mut warns);
                for line in new_body {
                    out.push(reattach(&open.prefix, &line));
                }
            }
            None => out.extend(raw.iter().map(|l| l.to_string())),
        }
        // The closing fence, when there is one — an unterminated fence runs to
        // the end of the file and there is nothing left to copy.
        if j < lines.len() {
            out.push(lines[j].to_string());
        }
        i = j + 1;
    }

    changed.then(|| Rewrite {
        text: out.join("\n"),
        warnings,
    })
}

// ── Finding the fences ───────────────────────────────────────────────────────

/// An opening ` ```timeline ` fence: what came before it on the line, and the
/// run of fence characters, so the matching close can be recognised.
struct Open {
    /// Indentation and blockquote markers ahead of the fence — a timeline can be
    /// nested inside a Callout, and #158 is the standing reminder that a
    /// column-zero-only scan misses those.
    prefix: String,
    fence_char: char,
    len: usize,
}

/// The leading run of indentation and blockquote markers on a line.
fn nesting_len(line: &str) -> usize {
    line.len()
        - line
            .trim_start_matches(|c| c == ' ' || c == '\t' || c == '>')
            .len()
}

fn open_fence(line: &str) -> Option<Open> {
    let (prefix, rest) = line.split_at(nesting_len(line));
    let fence_char = rest.chars().next()?;
    if fence_char != '`' && fence_char != '~' {
        return None;
    }
    let len = rest.chars().take_while(|c| *c == fence_char).count();
    // The info string must be the block's name and nothing else — the same
    // byte-identity rule the editor's claim follows (`fence-claim.ts`).
    if len < 3 || rest[len..].trim() != "timeline" {
        return None;
    }
    Some(Open {
        prefix: prefix.to_string(),
        fence_char,
        len,
    })
}

fn is_close_fence(line: &str, open: &Open) -> bool {
    let rest = &line[nesting_len(line)..];
    let run = rest.chars().take_while(|c| *c == open.fence_char).count();
    run >= open.len && rest[run..].trim().is_empty()
}

/// A body line with its nesting removed. Exact when the line carries the opening
/// fence's prefix; otherwise whatever indentation and quoting it does carry, so
/// a lazily-continued blockquote still yields its content.
fn strip_prefix<'a>(line: &'a str, prefix: &str) -> &'a str {
    match line.strip_prefix(prefix) {
        Some(rest) => rest,
        None => &line[nesting_len(line)..],
    }
}

/// Put the nesting back on a rewritten body line. A line that is now blank takes
/// the prefix with its trailing space dropped — `>` rather than `> ` — which is
/// what a markdown writer emits, so the migrated file is already in the shape the
/// next save would put it in.
fn reattach(prefix: &str, line: &str) -> String {
    if line.is_empty() {
        prefix.trim_end().to_string()
    } else {
        format!("{prefix}{line}")
    }
}

// ── The grammars ─────────────────────────────────────────────────────────────

/// One event, as the old grammar recorded it.
struct Event {
    date: String,
    title: String,
    description: String,
}

/// Old grammar: records separated by blank lines. Within a record the header is
/// an optional `Date:` line then the `Title:` line, and the `Title:` line ends
/// the header — every line after it is description even if it, too, looks like a
/// label. Mirrors the `parseTimelineBody` this ticket replaced.
fn parse_old(body: &[&str]) -> Vec<Event> {
    old_records(body)
        .into_iter()
        .map(|record| {
            let mut date = String::new();
            let mut title = String::new();
            let mut title_seen = false;
            let mut desc: Vec<&str> = Vec::new();

            for line in record {
                if !title_seen && line.starts_with("Date: ") {
                    date = line["Date: ".len()..].to_string();
                } else if !title_seen && line.starts_with("Title: ") {
                    title = line["Title: ".len()..].to_string();
                    title_seen = true;
                } else {
                    desc.push(line);
                }
            }

            Event {
                date,
                title,
                description: desc.join("\n"),
            }
        })
        .collect()
}

/// The old grammar's records: runs of lines between blank lines, dropping runs
/// that hold nothing but whitespace.
fn old_records<'a>(body: &[&'a str]) -> Vec<Vec<&'a str>> {
    let mut records: Vec<Vec<&str>> = Vec::new();
    let mut current: Vec<&str> = Vec::new();
    for line in body {
        if line.is_empty() {
            if !current.is_empty() {
                records.push(std::mem::take(&mut current));
            }
        } else {
            current.push(line);
        }
    }
    if !current.is_empty() {
        records.push(current);
    }
    records.retain(|r| r.iter().any(|l| !l.trim().is_empty()));
    records
}

/// New grammar: a `#` heading carrying the title, an optional `Date:` line, then
/// the description under a blank line. Mirrors `serializeTimelineEvents`,
/// including the one place it edits what the GM wrote.
fn serialize_new(events: &[Event]) -> (Vec<String>, Vec<String>) {
    let mut lines: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    for (n, event) in events.iter().enumerate() {
        if n > 0 {
            lines.push(String::new());
        }
        lines.push(format!("# {}", event.title));
        if !event.date.is_empty() {
            lines.push(format!("Date: {}", event.date));
        }
        if !event.description.is_empty() {
            lines.push(String::new());
            for line in event.description.split('\n') {
                if is_heading(line) {
                    // The one change that edits the GM's own prose rather than
                    // Grimoire's syntax, so it is the one the prompt warns about.
                    warnings.push(format!(
                        "a description line starting with # is indented by one space, so it \
                         stays part of the event \"{}\" instead of starting a new one",
                        display_title(&event.title)
                    ));
                    lines.push(format!(" {line}"));
                } else {
                    lines.push(line.to_string());
                }
            }
        }
    }

    (lines, warnings)
}

/// A column-zero heading line: `# Title`, or a bare `#`.
fn is_heading(line: &str) -> bool {
    line == "#" || line.starts_with("# ")
}

fn display_title(title: &str) -> &str {
    if title.trim().is_empty() {
        "(untitled)"
    } else {
        title
    }
}

// ── Deciding whether a body is old ───────────────────────────────────────────

/// Is this fence body on the old grammar?
///
/// Yes when some record carries a `Title:` line in header position — the marker
/// the old serializer always wrote — **and** no record opens with a heading,
/// which is the new grammar's marker. The second condition is what makes a
/// re-run safe after a partial failure, and it also refuses a new-format body
/// whose description happens to contain the line `Title: a quote from the play`.
///
/// One case slips through it: an old file whose *second* description paragraph
/// began with a column-zero `#`, which the old grammar had already split into a
/// heading-opening record of its own. That fence reads as new and is left alone.
/// It is the safe direction of the two — a fence left behind is visible, a fence
/// mangled by the wrong parser is not — and such a note is already broken today.
fn is_old_format(body: &[&str]) -> bool {
    let records = old_records(body);
    let has_new_marker = records.iter().any(|r| is_heading(r[0]));
    let has_old_marker = records
        .iter()
        .any(|r| r.iter().take(2).any(|l| l.starts_with("Title: ")));
    has_old_marker && !has_new_marker
}

/// The body rewritten, or `None` if it was not on the old grammar.
fn migrate_body(body: &[&str]) -> Option<(Vec<String>, Vec<String>)> {
    if !is_old_format(body) {
        return None;
    }
    let (lines, warnings) = serialize_new(&parse_old(body));
    // Belt and braces: a rewrite that changes nothing is not a rewrite, and
    // reporting a file as touched when its bytes are identical would put a name
    // in the report that the GM cannot account for.
    if lines == body {
        return None;
    }
    Some((lines, warnings))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn migrated(text: &str) -> String {
        apply(text).expect("expected a rewrite").text
    }

    // ── The grammar change itself ────────────────────────────────────────────

    #[test]
    fn title_line_becomes_a_heading_and_date_follows_it() {
        let before = "```timeline\nDate: Year 0\nTitle: The Shattering\n```";
        let after = "```timeline\n# The Shattering\nDate: Year 0\n```";
        assert_eq!(migrated(before), after);
    }

    #[test]
    fn a_description_is_separated_from_the_header_by_a_blank_line() {
        let before = "```timeline\nTitle: The Shattering\nThe council voted.\n```";
        let after = "```timeline\n# The Shattering\n\nThe council voted.\n```";
        assert_eq!(migrated(before), after);
    }

    #[test]
    fn events_are_separated_by_a_blank_line() {
        let before = "```timeline\nTitle: Alpha\n\nDate: Year 2\nTitle: Beta\nNotes.\n```";
        let after = "```timeline\n# Alpha\n\n# Beta\nDate: Year 2\n\nNotes.\n```";
        assert_eq!(migrated(before), after);
    }

    #[test]
    fn the_split_second_event_the_old_grammar_produced_is_carried_across_as_it_stands() {
        // The corruption already on disk: a GM's two-paragraph description had
        // become a second, untitled event. The migration is not a repair — it
        // cannot know which untitled events were meant to be paragraphs — so it
        // carries both events across and the GM can merge them by hand, now that
        // the format lets them.
        let before = "```timeline\nTitle: The Shattering\nOne.\n\nTwo.\n```";
        let after = "```timeline\n# The Shattering\n\nOne.\n\n# \n\nTwo.\n```";
        assert_eq!(migrated(before), after);
    }

    #[test]
    fn text_outside_the_fence_is_untouched() {
        let before = "# A note\n\nProse.\n\n```timeline\nTitle: Alpha\n```\n\nMore prose.\n";
        let after = "# A note\n\nProse.\n\n```timeline\n# Alpha\n```\n\nMore prose.\n";
        assert_eq!(migrated(before), after);
    }

    #[test]
    fn every_fence_in_a_note_is_migrated() {
        let before = "```timeline\nTitle: Alpha\n```\n\n```timeline\nTitle: Beta\n```";
        let after = "```timeline\n# Alpha\n```\n\n```timeline\n# Beta\n```";
        assert_eq!(migrated(before), after);
    }

    #[test]
    fn wikilinks_colons_and_pipes_are_carried_across_verbatim() {
        let before = "```timeline\nDate: [[Calendar#Frostfall]]\nTitle: [[A|B]]: the pact\nSee [[Highvale]].\n```";
        let after = "```timeline\n# [[A|B]]: the pact\nDate: [[Calendar#Frostfall]]\n\nSee [[Highvale]].\n```";
        assert_eq!(migrated(before), after);
    }

    #[test]
    fn a_description_line_that_looks_like_a_label_survives() {
        let before = "```timeline\nTitle: Alpha\nDate: not a field\nTitle: nor this\n```";
        let after = "```timeline\n# Alpha\n\nDate: not a field\nTitle: nor this\n```";
        assert_eq!(migrated(before), after);
    }

    // ── The one change that edits prose ──────────────────────────────────────

    #[test]
    fn a_heading_shaped_description_line_is_space_prefixed_and_warned_about() {
        let before = "```timeline\nTitle: Alpha\n# Not a new event\n```";
        let rewrite = apply(before).expect("expected a rewrite");

        assert_eq!(rewrite.text, "```timeline\n# Alpha\n\n # Not a new event\n```");
        assert_eq!(rewrite.warnings.len(), 1);
        assert!(rewrite.warnings[0].contains("Alpha"), "{:?}", rewrite.warnings);
        assert!(rewrite.warnings[0].contains('#'));
    }

    #[test]
    fn a_bare_hash_description_line_is_space_prefixed_too() {
        let before = "```timeline\nTitle: Alpha\n#\n```";
        assert_eq!(migrated(before), "```timeline\n# Alpha\n\n #\n```");
    }

    #[test]
    fn a_hashtag_is_not_a_heading_and_raises_no_warning() {
        let before = "```timeline\nTitle: Alpha\n#lore and #ashfen\n```";
        let rewrite = apply(before).expect("expected a rewrite");

        assert_eq!(rewrite.text, "```timeline\n# Alpha\n\n#lore and #ashfen\n```");
        assert!(rewrite.warnings.is_empty());
    }

    #[test]
    fn an_untouched_migration_reports_no_warnings() {
        let rewrite = apply("```timeline\nTitle: Alpha\n```").unwrap();
        assert!(rewrite.warnings.is_empty());
    }

    // ── What must be left alone ──────────────────────────────────────────────

    #[test]
    fn a_note_with_no_timeline_is_untouched() {
        assert!(apply("# Just a note\n\nWith prose and a [[link]].\n").is_none());
    }

    #[test]
    fn an_already_migrated_fence_is_untouched() {
        // The re-run case: a partial failure leaves a vault half-migrated, and
        // the next open scans all of it again.
        assert!(apply("```timeline\n# Alpha\nDate: Year 1\n\nProse.\n```").is_none());
    }

    #[test]
    fn a_new_format_description_holding_a_title_line_is_untouched() {
        // The false positive the new-format marker exists to refuse: after a
        // blank line, `Title: …` is the first line of a record.
        let text = "```timeline\n# Alpha\n\nTitle: a quote from the play\n```";
        assert!(apply(text).is_none());
    }

    #[test]
    fn a_half_migrated_note_migrates_only_the_fence_still_behind() {
        let before = "```timeline\n# Alpha\n```\n\n```timeline\nTitle: Beta\n```";
        let after = "```timeline\n# Alpha\n```\n\n```timeline\n# Beta\n```";
        assert_eq!(migrated(before), after);
    }

    #[test]
    fn another_language_s_fence_is_untouched() {
        assert!(apply("```python\nTitle: Alpha\n```").is_none());
    }

    #[test]
    fn a_fence_carrying_more_than_the_block_name_is_untouched() {
        // The editor declines this fence too, so migrating it would be Grimoire
        // rewriting a code block it does not own.
        assert!(apply("```timeline extra\nTitle: Alpha\n```").is_none());
    }

    #[test]
    fn an_empty_fence_is_untouched() {
        assert!(apply("```timeline\n```").is_none());
    }

    #[test]
    fn a_migration_is_idempotent() {
        let once = migrated("```timeline\nDate: Year 0\nTitle: Alpha\nProse.\n\nTitle: Beta\n```");
        assert!(apply(&once).is_none(), "second pass changed {once:?}");
    }

    // ── Nesting ──────────────────────────────────────────────────────────────

    #[test]
    fn a_fence_inside_a_callout_is_migrated_with_its_quote_markers_intact() {
        let before = "> [!encounter] The Ambush\n> ```timeline\n> Title: Goblins strike\n> ```";
        let after = "> [!encounter] The Ambush\n> ```timeline\n> # Goblins strike\n> ```";
        assert_eq!(migrated(before), after);
    }

    #[test]
    fn a_blank_line_added_inside_a_quoted_fence_carries_no_trailing_space() {
        let before = "> ```timeline\n> Title: Alpha\n> Prose.\n> ```";
        let after = "> ```timeline\n> # Alpha\n>\n> Prose.\n> ```";
        assert_eq!(migrated(before), after);
    }

    #[test]
    fn an_indented_fence_is_migrated_at_its_indentation() {
        let before = "- a list item\n\n  ```timeline\n  Title: Alpha\n  ```";
        let after = "- a list item\n\n  ```timeline\n  # Alpha\n  ```";
        assert_eq!(migrated(before), after);
    }

    #[test]
    fn a_tilde_fence_keeps_its_fence_characters() {
        let before = "~~~timeline\nTitle: Alpha\n~~~";
        let after = "~~~timeline\n# Alpha\n~~~";
        assert_eq!(migrated(before), after);
    }

    #[test]
    fn a_longer_fence_run_is_closed_by_a_longer_run() {
        let before = "````timeline\nTitle: Alpha\n\n```\nnot the close\n```\n````";
        let rewrite = apply(before).expect("expected a rewrite");
        // The inner ``` run is shorter than the opening ````, so it does not
        // close the fence — it is part of the body.
        assert!(rewrite.text.starts_with("````timeline\n# Alpha"));
        assert!(rewrite.text.ends_with("````"));
    }

    #[test]
    fn an_unterminated_fence_still_migrates_what_it_holds() {
        let before = "```timeline\nTitle: Alpha";
        assert_eq!(migrated(before), "```timeline\n# Alpha");
    }

    #[test]
    fn a_trailing_newline_is_preserved() {
        let before = "```timeline\nTitle: Alpha\n```\n";
        assert!(migrated(before).ends_with("```\n"));
    }

    #[test]
    fn crlf_line_endings_survive_as_they_are_outside_the_migrated_fence() {
        // Split on `\n` leaves the `\r` on the line, and an unmigrated line is
        // re-emitted verbatim — so a CRLF file does not become a mixed one.
        let before = "Prose.\r\nMore.\r\n";
        assert!(apply(before).is_none());
    }
}
