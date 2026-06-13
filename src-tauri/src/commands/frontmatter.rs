// YAML frontmatter editing for note files.
//
// Contract (locked in CONTEXT.md):
// - YAML, `---` delimited
// - Key `tags`, inline array form: `tags: [npc, allied]`
// - No `#` prefix on values
// - Non-grimoire frontmatter keys preserved verbatim on write
// - Frontmatter block created on first tag; removed when the last tag is
//   removed *if no other keys remain*

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
