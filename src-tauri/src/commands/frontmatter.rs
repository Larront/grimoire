// YAML frontmatter editing for note files.
//
// Contract (locked in CONTEXT.md):
// - YAML, `---` delimited
// - Key `tags`, inline array form: `tags: [npc, allied]`
// - No `#` prefix on values
// - Non-grimoire frontmatter keys preserved verbatim on write
// - Frontmatter block created on first tag; removed when the last tag is
//   removed *if no other keys remain*
//
// The editor never sees a note's frontmatter: `parseFrontmatter`
// (`src/lib/utils.ts`) splits it off before the buffer is seeded, so the
// markdown a content save carries back is body-only. [`body_save_content`] is
// the inverse of that strip and the reason a save doesn't erase the block.

/// Split `raw` into (frontmatter block, body). Tolerates CRLF line endings —
/// files checked out or written on Windows must parse identically to LF files.
/// The single frontmatter-splitting seam: links.rs and search.rs delegate here.
pub(crate) fn split_frontmatter(raw: &str) -> Option<(String, String)> {
    let after_open = raw
        .strip_prefix("---\r\n")
        .or_else(|| raw.strip_prefix("---\n"))?;
    let close_idx = after_open.find("\n---")?;
    // A CRLF file leaves a \r before the close delimiter's \n; drop it.
    let block = after_open[..close_idx].trim_end_matches('\r');
    let after_close = &after_open[close_idx + 4..];
    let body = after_close
        .strip_prefix("\r\n")
        .or_else(|| after_close.strip_prefix('\n'))
        .unwrap_or(after_close)
        .to_string();
    Some((block.to_string(), body))
}

fn find_list_lines(lines: &[String], key: &str) -> (Vec<String>, Vec<usize>) {
    let prefix = format!("{}:", key);
    for (i, line) in lines.iter().enumerate() {
        let stripped = line.trim_start();
        if let Some(rest) = stripped.strip_prefix(&prefix) {
            let rest = rest.trim_start();
            if let Some(inside) = rest.strip_prefix('[') {
                if let Some(end) = inside.find(']') {
                    let inner = &inside[..end];
                    let values: Vec<String> = inner
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                    return (values, vec![i]);
                }
            } else if rest.is_empty() {
                let mut values = Vec::new();
                let mut indices = vec![i];
                for (j, next_line) in lines.iter().enumerate().skip(i + 1) {
                    let next = next_line.trim_start();
                    if let Some(val) = next.strip_prefix('-') {
                        values.push(val.trim().to_string());
                        indices.push(j);
                    } else {
                        break;
                    }
                }
                return (values, indices);
            }
        }
    }
    (Vec::new(), Vec::new())
}

fn read_list(content: &str, key: &str) -> Vec<String> {
    match split_frontmatter(content) {
        Some((block, _)) => {
            let lines: Vec<String> = block.lines().map(String::from).collect();
            find_list_lines(&lines, key).0
        }
        None => Vec::new(),
    }
}

fn apply_list(content: &str, key: &str, new_values: &[String]) -> String {
    let (block_str, body) = split_frontmatter(content)
        .unwrap_or_else(|| (String::new(), content.to_string()));
    let mut lines: Vec<String> = block_str.lines().map(String::from).collect();
    let (_, indices) = find_list_lines(&lines, key);

    let insert_at = indices.first().copied().unwrap_or(0);
    for idx in indices.into_iter().rev() {
        lines.remove(idx);
    }

    if !new_values.is_empty() {
        let line = format!("{}: [{}]", key, new_values.join(", "));
        let pos = insert_at.min(lines.len());
        lines.insert(pos, line);
    }

    let any_content = lines.iter().any(|l| !l.trim().is_empty());
    if !any_content {
        return body;
    }

    let block_joined = lines.join("\n");
    format!("---\n{}\n---\n{}", block_joined, body)
}

pub fn read_tags(content: &str) -> Vec<String> {
    read_list(content, "tags")
}

pub fn apply_tags(content: &str, new_tags: &[String]) -> String {
    apply_list(content, "tags", new_tags)
}

pub fn read_aliases(content: &str) -> Vec<String> {
    read_list(content, "aliases")
}

/// Put `disk_raw`'s frontmatter block back in front of a body-only `body`.
///
/// The exact inverse of the load-side strip: this splits `disk_raw` by the same
/// rule `parseFrontmatter` used to remove the block, so what came off goes back
/// on. Consequences of that symmetry worth stating, because both look like bugs
/// until you check the pairing:
/// - A body that legitimately opens with a `---` horizontal rule is neither
///   eaten nor duplicated — the load side stripped only the real block, so only
///   the real block is restored.
/// - A file whose leading `---` fence was never frontmatter at all is treated
///   the same way going out as it was coming in, so the bytes still round-trip.
///
/// Frontmatter-only whitespace and line endings normalise to LF exactly as
/// [`apply_list`] already normalises them; the *keys* are what the portability
/// contract preserves verbatim, and the body is untouched either way.
fn reattach(disk_raw: &str, body: &str) -> String {
    match split_frontmatter(disk_raw) {
        Some((block, _)) => {
            let lines: Vec<&str> = block.lines().collect();
            format!("---\n{}\n---\n{}", lines.join("\n"), body)
        }
        None => body.to_string(),
    }
}

/// The bytes a content save should write, given the body the editor produced.
///
/// `full_path` is read here, at write time, rather than trusting a block the
/// frontend captured when the note was opened: a note can sit open for an hour
/// while Obsidian adds a key to it, and the save must not roll that back. A
/// path that can't be read (a note being recreated after an external delete, a
/// brand-new file) simply has no block to restore.
pub fn body_save_content(full_path: &std::path::Path, body: &str) -> String {
    match std::fs::read_to_string(full_path) {
        Ok(disk_raw) => reattach(&disk_raw, body),
        Err(_) => body.to_string(),
    }
}

pub fn apply_aliases(content: &str, new_aliases: &[String]) -> String {
    apply_list(content, "aliases", new_aliases)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_tags_inline() {
        let raw = "---\ntags: [npc, allied]\n---\nBody text\n";
        assert_eq!(read_tags(raw), vec!["npc", "allied"]);
    }

    #[test]
    fn read_tags_block_form() {
        let raw = "---\ntags:\n  - npc\n  - allied\n---\nBody\n";
        assert_eq!(read_tags(raw), vec!["npc", "allied"]);
    }

    #[test]
    fn read_tags_none_when_no_frontmatter() {
        assert_eq!(read_tags("just body").len(), 0);
        assert_eq!(read_tags("").len(), 0);
    }

    #[test]
    fn read_tags_empty_inline_array() {
        let raw = "---\ntags: []\n---\nBody\n";
        assert_eq!(read_tags(raw).len(), 0);
    }

    #[test]
    fn round_trip_read_write_read_inline() {
        let raw = "---\ntags: [npc]\n---\nHello\n";
        let written = apply_tags(raw, &["npc".to_string(), "ally".to_string()]);
        assert_eq!(read_tags(&written), vec!["npc", "ally"]);
        let written2 = apply_tags(&written, &read_tags(&written));
        assert_eq!(written, written2);
    }

    #[test]
    fn first_tag_creates_block_when_no_frontmatter() {
        let raw = "Body only\n";
        let written = apply_tags(raw, &["npc".to_string()]);
        assert_eq!(written, "---\ntags: [npc]\n---\nBody only\n");
    }

    #[test]
    fn first_tag_creates_block_on_empty_body() {
        let written = apply_tags("", &["npc".to_string()]);
        assert_eq!(written, "---\ntags: [npc]\n---\n");
    }

    #[test]
    fn preserves_unknown_keys_verbatim() {
        let raw = "---\ncover: portrait.png\ntags: [npc]\nauthor: GM\n---\nBody\n";
        let written = apply_tags(raw, &["ally".to_string(), "named".to_string()]);
        let expected = "---\ncover: portrait.png\ntags: [ally, named]\nauthor: GM\n---\nBody\n";
        assert_eq!(written, expected);
    }

    #[test]
    fn removes_last_tag_strips_block_when_no_other_keys() {
        let raw = "---\ntags: [npc]\n---\nBody\n";
        let written = apply_tags(raw, &[]);
        assert_eq!(written, "Body\n");
    }

    #[test]
    fn removes_last_tag_keeps_block_when_other_keys_present() {
        let raw = "---\ncover: img.png\ntags: [npc]\n---\nBody\n";
        let written = apply_tags(raw, &[]);
        assert_eq!(written, "---\ncover: img.png\n---\nBody\n");
    }

    #[test]
    fn block_form_tags_replaced_with_inline_form_on_write() {
        let raw = "---\ntags:\n  - npc\n  - allied\nauthor: GM\n---\nBody\n";
        let written = apply_tags(raw, &["other".to_string()]);
        assert_eq!(
            written,
            "---\ntags: [other]\nauthor: GM\n---\nBody\n"
        );
    }

    #[test]
    fn add_tags_to_existing_block_without_tags_key() {
        let raw = "---\ncover: img.png\n---\nBody\n";
        let written = apply_tags(raw, &["npc".to_string()]);
        assert_eq!(written, "---\ntags: [npc]\ncover: img.png\n---\nBody\n");
    }

    #[test]
    fn remove_all_tags_from_tags_only_empty_body() {
        let raw = "---\ntags: [npc]\n---\n";
        let written = apply_tags(raw, &[]);
        assert_eq!(written, "");
    }

    #[test]
    fn round_trip_preserves_unknown_keys() {
        let raw = "---\ncover: portrait.png\ntags: [npc]\n---\nBody\n";
        let tags = read_tags(raw);
        let written = apply_tags(raw, &tags);
        assert_eq!(written, raw);
    }

    #[test]
    fn read_aliases_inline() {
        let raw = "---\naliases: [Captain Ash, Ash the Bold]\n---\nBody\n";
        assert_eq!(read_aliases(raw), vec!["Captain Ash", "Ash the Bold"]);
    }

    #[test]
    fn read_aliases_block_form() {
        let raw = "---\naliases:\n  - Captain Ash\n  - Ash the Bold\n---\nBody\n";
        assert_eq!(read_aliases(raw), vec!["Captain Ash", "Ash the Bold"]);
    }

    #[test]
    fn read_aliases_none_when_no_frontmatter() {
        assert_eq!(read_aliases("just body").len(), 0);
        assert_eq!(read_aliases("").len(), 0);
    }

    #[test]
    fn apply_aliases_creates_block_when_no_frontmatter() {
        let written = apply_aliases("Body\n", &["Captain Ash".to_string()]);
        assert_eq!(written, "---\naliases: [Captain Ash]\n---\nBody\n");
    }

    #[test]
    fn apply_aliases_clears_block_when_only_key() {
        let raw = "---\naliases: [Captain Ash]\n---\nBody\n";
        let written = apply_aliases(raw, &[]);
        assert_eq!(written, "Body\n");
    }

    #[test]
    fn apply_aliases_preserves_other_keys() {
        let raw = "---\ntags: [npc]\naliases: [Captain Ash]\n---\nBody\n";
        let written = apply_aliases(raw, &["Ash".to_string()]);
        assert_eq!(written, "---\ntags: [npc]\naliases: [Ash]\n---\nBody\n");
    }

    #[test]
    fn tags_and_aliases_coexist() {
        let raw = "---\ntags: [npc]\naliases: [Captain Ash]\n---\nBody\n";
        assert_eq!(read_tags(raw), vec!["npc"]);
        assert_eq!(read_aliases(raw), vec!["Captain Ash"]);
    }

    // ── Body-only content saves ───────────────────────────────────────────────
    // The editor autosaves a body with no frontmatter in it. Writing that body
    // verbatim erased the block — tags, aliases and foreign keys alike — so
    // every one of these guards a way a note's metadata could vanish under an
    // ordinary keystroke.

    #[test]
    fn reattach_restores_the_block_a_body_only_save_lacks() {
        let disk = "---\ntags: [npc]\naliases: [Mira]\n---\nOld body\n";
        assert_eq!(
            reattach(disk, "New body\n"),
            "---\ntags: [npc]\naliases: [Mira]\n---\nNew body\n"
        );
    }

    #[test]
    fn reattach_preserves_foreign_keys() {
        let disk = "---\ncover: portrait.png\nauthor: GM\ntags: [npc]\n---\nOld\n";
        assert_eq!(
            reattach(disk, "New\n"),
            "---\ncover: portrait.png\nauthor: GM\ntags: [npc]\n---\nNew\n"
        );
    }

    #[test]
    fn reattach_leaves_an_unadorned_note_alone() {
        assert_eq!(reattach("Old body\n", "New body\n"), "New body\n");
    }

    #[test]
    fn reattach_on_empty_disk_file_writes_the_body() {
        assert_eq!(reattach("", "New body\n"), "New body\n");
    }

    #[test]
    fn reattach_round_trips_an_untouched_note() {
        // Split then rejoin must be byte-identical, or merely opening a note and
        // letting a save fire would rewrite the file.
        let disk = "---\ntags: [npc]\ncover: img.png\n---\nBody text\n";
        let (_, body) = split_frontmatter(disk).unwrap();
        assert_eq!(reattach(disk, &body), disk);
    }

    #[test]
    fn reattach_keeps_a_leading_horizontal_rule_in_the_body() {
        // A note whose prose opens with `---` is the case where eating or
        // duplicating a delimiter is easiest. The rule is body, and stays body.
        let disk = "---\ntags: [npc]\n---\n---\nOld\n";
        let (_, body) = split_frontmatter(disk).unwrap();
        assert_eq!(body, "---\nOld\n");
        assert_eq!(reattach(disk, "---\nNew\n"), "---\ntags: [npc]\n---\n---\nNew\n");
    }

    #[test]
    fn reattach_does_not_invent_a_block_from_an_hr_only_note() {
        // No closing fence ⇒ no frontmatter on the way in, so nothing is put
        // back and the body is not prefixed with a fabricated block.
        let disk = "---\nJust a rule and prose\n";
        assert_eq!(reattach(disk, "---\nEdited prose\n"), "---\nEdited prose\n");
    }

    #[test]
    fn reattach_normalises_crlf_frontmatter_to_lf() {
        // Same normalisation `apply_tags` already performs; the body's own line
        // endings are the editor's business and pass through untouched.
        let disk = "---\r\ntags: [npc]\r\ncover: img.png\r\n---\r\nOld\r\n";
        assert_eq!(
            reattach(disk, "New\r\n"),
            "---\ntags: [npc]\ncover: img.png\n---\nNew\r\n"
        );
    }

    #[test]
    fn body_save_content_restores_the_block_from_the_file_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ash.md");
        std::fs::write(&path, "---\ntags: [npc]\n---\nOld body\n").unwrap();
        assert_eq!(
            body_save_content(&path, "New body\n"),
            "---\ntags: [npc]\n---\nNew body\n"
        );
    }

    #[test]
    fn body_save_content_reads_the_block_at_write_time() {
        // A note can sit open while another tool edits its frontmatter. The save
        // must carry the key that tool added, not the block as it was on open.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ash.md");
        std::fs::write(&path, "---\ntags: [npc]\n---\nOld\n").unwrap();
        std::fs::write(&path, "---\ntags: [npc]\ncover: added.png\n---\nOld\n").unwrap();
        assert_eq!(
            body_save_content(&path, "New\n"),
            "---\ntags: [npc]\ncover: added.png\n---\nNew\n"
        );
    }

    #[test]
    fn body_save_content_on_a_missing_file_writes_the_body() {
        // The recreate-after-external-delete path: the old file (and its block)
        // is gone, and the save must still land rather than fail.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gone.md");
        assert_eq!(body_save_content(&path, "New body\n"), "New body\n");
    }

    // ── CRLF tolerance ────────────────────────────────────────────────────────
    // Windows checkouts (git autocrlf) and Windows-authored vaults produce
    // \r\n-terminated markdown; frontmatter must parse identically.

    #[test]
    fn read_tags_and_aliases_crlf_inline() {
        let raw = "---\r\ntags: [npc]\r\naliases: [Mira, the Herbalist]\r\n---\r\nBody\r\n";
        assert_eq!(read_tags(raw), vec!["npc"]);
        assert_eq!(read_aliases(raw), vec!["Mira", "the Herbalist"]);
    }

    #[test]
    fn read_tags_crlf_block_form() {
        let raw = "---\r\ntags:\r\n  - npc\r\n  - allied\r\n---\r\nBody\r\n";
        assert_eq!(read_tags(raw), vec!["npc", "allied"]);
    }

    #[test]
    fn split_frontmatter_crlf_body_excludes_block() {
        let raw = "---\r\ntags: [npc]\r\n---\r\nBody text\r\n";
        let (block, body) = split_frontmatter(raw).expect("CRLF frontmatter must split");
        assert!(block.contains("tags: [npc]"));
        assert!(!block.ends_with('\r'), "trailing \\r must be trimmed from the block");
        assert_eq!(body, "Body text\r\n");
    }
}
