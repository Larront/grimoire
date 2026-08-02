//! The Scene format change — format 1 → 2, and the second registered
//! [[Format Migration]] (issue #185).
//!
//! A [[Scene]] reference used to be written into a note as opaque HTML —
//! `<scene-block data-id="1" data-expanded="false"></scene-block>` — so a GM who
//! opened that note in Obsidian saw the tag where a scene reference should be. It
//! becomes a fence naming the scene:
//!
//! ~~~text
//! ```scene
//! # Boss Battle
//! Id: 1
//! ```
//! ~~~
//!
//! Three things about this module are worth knowing before changing it:
//!
//! **The name comes from the database, which is why this migration earned a
//! context.** Every other transform so far is a function of the file's text
//! alone; this one has to look a scene's name up by id, and that is the whole
//! reason [`super::MigrationContext`] exists. An id that resolves to no scene
//! (the scene was deleted, the note kept the reference) writes the `Id:` line
//! alone — the reference is still dangling, and inventing a name for it would be
//! worse than showing none.
//!
//! **`data-expanded` is dropped, deliberately and with no replacement.** It was
//! view state persisted into the GM's file (ADR-0016 §6); collapse is now the
//! node view's business for as long as the view lives.
//!
//! **Detection is exact, which makes it safe to re-run.** Only a line that is a
//! `<scene-block>` tag *and nothing else* is rewritten, and the new form carries
//! no tag at all — so a vault half-migrated by a partial failure is scanned again
//! with no risk of a second pass touching what the first one wrote. The same
//! exactness is what leaves a GM's own hand-written HTML alone.
//!
//! One corner is documented and left: a `<scene-block>` tag a GM typed *inside* a
//! code fence, to write about the old syntax, is rewritten like any other. That
//! is a note about Grimoire rather than a campaign note, and teaching this pass
//! to track fence state to protect it would be a larger risk than the one it
//! removes.

use super::{MigrationContext, Rewrite};

/// Rewrite every legacy `<scene-block>` tag in a note's text.
///
/// `None` means untouched — the overwhelmingly common case, since a vault holds
/// far more notes without scene references than with them.
pub fn apply(text: &str, ctx: &MigrationContext) -> Option<Rewrite> {
    let mut out: Vec<String> = Vec::new();
    let mut changed = false;

    for line in text.split('\n') {
        match read_tag(line) {
            Some(tag) => {
                changed = true;
                out.extend(fence_lines(&tag, ctx));
            }
            None => out.push(line.to_string()),
        }
    }

    changed.then(|| Rewrite {
        text: out.join("\n"),
        // Nothing here edits the GM's *prose* — a tag was never anything a human
        // wrote on purpose — so this transform has nothing to warn about.
        warnings: Vec::new(),
    })
}

// ── Reading the legacy tag ───────────────────────────────────────────────────

/// A `<scene-block>` tag found alone on a line.
struct Tag {
    /// Indentation and blockquote markers ahead of the tag, kept verbatim so a
    /// reference nested inside a Callout comes out nested inside it.
    prefix: String,
    /// The scene the tag referenced, or `None` when it named none — a `/scene`
    /// the GM inserted and never bound.
    scene_id: Option<i32>,
}

/// The leading run of indentation and blockquote markers on a line. Same shape as
/// `timeline_v1`'s, and the same reason: #158 is the standing reminder that a
/// column-zero-only scan misses a block nested inside a quote.
fn nesting_len(line: &str) -> usize {
    line.len()
        - line
            .trim_start_matches([' ', '\t', '>'])
            .len()
}

/// The tag a line *is*, or `None` if the line is anything else.
///
/// Accepts both forms that reached a vault: the paired `<scene-block …></scene-block>`
/// Grimoire wrote, and the self-closing `<scene-block … />` a GM may have hand-written.
/// Anything sharing the line with the tag is not a tag line: rewriting it would move
/// the GM's characters onto a fence line, where they would read as scene grammar.
fn read_tag(line: &str) -> Option<Tag> {
    let (prefix, rest) = line.split_at(nesting_len(line));
    let rest = rest.trim_end();

    let inner = rest.strip_prefix("<scene-block")?;
    // The next character must end the tag name, or `<scene-blockade>` is a tag.
    if !inner.is_empty() && !inner.starts_with(|c: char| c.is_whitespace() || c == '>' || c == '/') {
        return None;
    }
    let attrs_end = inner.find('>')?;
    let attrs = &inner[..attrs_end];
    let after = &inner[attrs_end + 1..];
    let self_closing = attrs.trim_end().ends_with('/');
    if !(self_closing && after.is_empty()) && after != "</scene-block>" {
        return None;
    }

    Some(Tag {
        prefix: prefix.to_string(),
        scene_id: read_id(attrs),
    })
}

/// The `data-id` an attribute string carries, when it carries a whole number.
///
/// A missing, empty or unparseable id is `None` — the same reading the editor gave
/// it, which is what makes an unbound reference survive the migration as an unbound
/// reference rather than as a broken one.
fn read_id(attrs: &str) -> Option<i32> {
    let at = attrs.find("data-id=")?;
    let rest = &attrs[at + "data-id=".len()..];
    let quote = rest.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let value = &rest[1..];
    let end = value.find(quote)?;
    value[..end].trim().parse::<i32>().ok()
}

// ── Writing the fence ────────────────────────────────────────────────────────

/// The fence a tag becomes, one line at a time, each carrying the tag's nesting.
///
/// This is a snapshot of the grammar `src/lib/editor/scene-block.svelte.ts` writes
/// today, re-implemented here rather than shared, for `timeline_v1`'s reason: a
/// migration is a frozen format, and the live serializer will keep moving. The
/// tests below pin this half against the TypeScript one.
fn fence_lines(tag: &Tag, ctx: &MigrationContext) -> Vec<String> {
    let mut body: Vec<String> = Vec::new();
    if let Some(name) = tag.scene_id.and_then(|id| ctx.scene_name(id)) {
        // A name is one line in this format, and a database column is not
        // constrained to one — so the copy is flattened on the way in, exactly as
        // the editor's serializer does.
        let one_line = name.replace(['\r', '\n'], " ");
        if !one_line.is_empty() {
            body.push(format!("# {one_line}"));
        }
    }
    if let Some(id) = tag.scene_id {
        body.push(format!("Id: {id}"));
    }

    let mut lines = vec![format!("{}```scene", tag.prefix)];
    lines.extend(body.into_iter().map(|line| format!("{}{line}", tag.prefix)));
    lines.push(format!("{}```", tag.prefix));
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> MigrationContext {
        MigrationContext::from_scene_names([(1, "Boss Battle"), (2, "Town Market")])
    }

    fn migrate(text: &str) -> Option<String> {
        apply(text, &ctx()).map(|r| r.text)
    }

    // ── The rewrite ──────────────────────────────────────────────────────────

    #[test]
    fn a_tag_becomes_a_fence_carrying_the_id_and_the_scene_name() {
        assert_eq!(
            migrate(r#"<scene-block data-id="1" data-expanded="false"></scene-block>"#).unwrap(),
            "```scene\n# Boss Battle\nId: 1\n```"
        );
    }

    #[test]
    fn the_expanded_flag_leaves_no_trace_in_the_document() {
        // It was view state persisted into the GM's file, and it is not replaced by
        // anything: collapse is the node view's, for as long as the view lives.
        for raw in [
            r#"<scene-block data-id="1" data-expanded="true"></scene-block>"#,
            r#"<scene-block data-id="1" data-expanded="false"></scene-block>"#,
        ] {
            let out = migrate(raw).unwrap();
            assert_eq!(out, "```scene\n# Boss Battle\nId: 1\n```", "raw={raw}");
            assert!(!out.contains("xpanded"), "raw={raw}");
        }
    }

    #[test]
    fn an_id_that_resolves_to_no_scene_keeps_the_id_and_writes_no_name() {
        // The scene was deleted and the note kept its reference. Inventing a name
        // for a dangling reference would be worse than showing none — and the fence
        // still renders the not-found state, because the id is what it reads.
        assert_eq!(
            migrate(r#"<scene-block data-id="99" data-expanded="false"></scene-block>"#).unwrap(),
            "```scene\nId: 99\n```"
        );
    }

    #[test]
    fn a_tag_bound_to_nothing_becomes_an_empty_fence() {
        // A `/scene` the GM inserted and never bound. Writing `Id:` with no id
        // would read back as no id anyway.
        for raw in [
            r#"<scene-block data-id="" data-expanded="false"></scene-block>"#,
            r#"<scene-block data-expanded="false"></scene-block>"#,
            "<scene-block></scene-block>",
        ] {
            assert_eq!(migrate(raw).unwrap(), "```scene\n```", "raw={raw}");
        }
    }

    #[test]
    fn a_hand_written_self_closing_tag_is_migrated_too() {
        assert_eq!(
            migrate(r#"<scene-block data-id="2" />"#).unwrap(),
            "```scene\n# Town Market\nId: 2\n```"
        );
        assert_eq!(
            migrate(r#"<scene-block data-id="2"/>"#).unwrap(),
            "```scene\n# Town Market\nId: 2\n```"
        );
    }

    #[test]
    fn single_quoted_attributes_are_read() {
        assert_eq!(
            migrate("<scene-block data-id='1'></scene-block>").unwrap(),
            "```scene\n# Boss Battle\nId: 1\n```"
        );
    }

    #[test]
    fn a_scene_name_holding_a_newline_is_flattened_onto_one_line() {
        // The name is a copy of a database column, and a column is not constrained
        // to one line. A two-line name would write a second fence line that reads
        // back as something else entirely.
        let ctx = MigrationContext::from_scene_names([(1, "Boss\nBattle")]);
        let out = apply(r#"<scene-block data-id="1"></scene-block>"#, &ctx).unwrap();
        assert_eq!(out.text, "```scene\n# Boss Battle\nId: 1\n```");
    }

    #[test]
    fn prose_around_a_tag_is_untouched() {
        let text = "## Set the scene\n\n\
                    <scene-block data-id=\"1\" data-expanded=\"true\"></scene-block>\n\n\
                    Press play.\n";
        assert_eq!(
            migrate(text).unwrap(),
            "## Set the scene\n\n```scene\n# Boss Battle\nId: 1\n```\n\nPress play.\n"
        );
    }

    #[test]
    fn two_tags_in_one_note_both_migrate() {
        let text = "<scene-block data-id=\"1\"></scene-block>\n\n\
                    <scene-block data-id=\"2\"></scene-block>";
        assert_eq!(
            migrate(text).unwrap(),
            "```scene\n# Boss Battle\nId: 1\n```\n\n```scene\n# Town Market\nId: 2\n```"
        );
    }

    #[test]
    fn a_tag_nested_inside_a_callout_stays_nested() {
        // #158's standing reminder: a column-zero-only scan misses these, and a
        // fence written without the quote markers would fall out of the callout.
        assert_eq!(
            migrate("> [!encounter] The Ambush\n>\n> <scene-block data-id=\"1\"></scene-block>")
                .unwrap(),
            "> [!encounter] The Ambush\n>\n> ```scene\n> # Boss Battle\n> Id: 1\n> ```"
        );
    }

    // ── Leaving things alone ─────────────────────────────────────────────────

    #[test]
    fn a_note_with_no_tag_is_untouched() {
        assert!(migrate("# Just prose\n\nAnd a [[link]].\n").is_none());
    }

    #[test]
    fn a_note_already_on_the_new_format_is_untouched() {
        // What makes re-running after a partial failure safe: the new form carries
        // no tag, so a second pass finds nothing in a file the first one wrote.
        assert!(migrate("```scene\n# Boss Battle\nId: 1\n```").is_none());
    }

    #[test]
    fn a_tag_sharing_its_line_with_anything_else_is_left_alone() {
        // Rewriting it would move the GM's characters onto a fence line, where they
        // would be read as scene grammar rather than as the prose they are.
        for raw in [
            r#"Press play: <scene-block data-id="1"></scene-block>"#,
            r#"<scene-block data-id="1"></scene-block> then read aloud."#,
            r#"<scene-block data-id="1"></scene-block><scene-block data-id="2"></scene-block>"#,
        ] {
            assert!(migrate(raw).is_none(), "raw={raw}");
        }
    }

    #[test]
    fn a_gms_own_html_is_left_alone() {
        for raw in [
            r#"<div class="note">Hand-written HTML</div>"#,
            "<scene-blockade></scene-blockade>",
            "<scene-block>",
            "the words scene-block written in prose",
        ] {
            assert!(migrate(raw).is_none(), "raw={raw}");
        }
    }
}
