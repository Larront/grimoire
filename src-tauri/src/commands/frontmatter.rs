// YAML frontmatter editing for note files.
//
// Contract (locked in CONTEXT.md):
// - YAML, `---` delimited
// - Key `tags`, inline array form: `tags: [npc, allied]`
// - No `#` prefix on values
// - Non-grimoire frontmatter keys preserved verbatim on write
// - Frontmatter block created on first tag; removed when the last tag is
//   removed *if no other keys remain*

fn split_frontmatter(raw: &str) -> Option<(String, String)> {
    if !raw.starts_with("---\n") {
        return None;
    }
    let after_open = &raw[4..];
    let close_idx = after_open.find("\n---")?;
    let block = &after_open[..close_idx];
    let after_close = &after_open[close_idx + 4..];
    let body = match after_close.strip_prefix('\n') {
        Some(rest) => rest.to_string(),
        None => after_close.to_string(),
    };
    Some((block.to_string(), body))
}

fn find_tag_lines(lines: &[String]) -> (Vec<String>, Vec<usize>) {
    for (i, line) in lines.iter().enumerate() {
        let stripped = line.trim_start();
        if let Some(rest) = stripped.strip_prefix("tags:") {
            let rest = rest.trim_start();
            if let Some(inside) = rest.strip_prefix('[') {
                if let Some(end) = inside.find(']') {
                    let inner = &inside[..end];
                    let tags: Vec<String> = inner
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                    return (tags, vec![i]);
                }
            } else if rest.is_empty() {
                let mut tags = Vec::new();
                let mut indices = vec![i];
                for (j, next_line) in lines.iter().enumerate().skip(i + 1) {
                    let next = next_line.trim_start();
                    if let Some(val) = next.strip_prefix('-') {
                        tags.push(val.trim().to_string());
                        indices.push(j);
                    } else {
                        break;
                    }
                }
                return (tags, indices);
            }
        }
    }
    (Vec::new(), Vec::new())
}

pub fn read_tags(content: &str) -> Vec<String> {
    match split_frontmatter(content) {
        Some((block, _)) => {
            let lines: Vec<String> = block.lines().map(String::from).collect();
            find_tag_lines(&lines).0
        }
        None => Vec::new(),
    }
}

pub fn apply_tags(content: &str, new_tags: &[String]) -> String {
    let (block_str, body) = split_frontmatter(content)
        .unwrap_or_else(|| (String::new(), content.to_string()));
    let mut lines: Vec<String> = block_str.lines().map(String::from).collect();
    let (_, tag_indices) = find_tag_lines(&lines);

    let insert_at = tag_indices.first().copied().unwrap_or(0);
    let mut sorted = tag_indices.clone();
    sorted.sort_unstable();
    for idx in sorted.into_iter().rev() {
        lines.remove(idx);
    }

    if !new_tags.is_empty() {
        let tag_line = format!("tags: [{}]", new_tags.join(", "));
        let pos = insert_at.min(lines.len());
        lines.insert(pos, tag_line);
    }

    let any_content = lines.iter().any(|l| !l.trim().is_empty());
    if !any_content {
        return body;
    }

    let block_joined = lines.join("\n");
    format!("---\n{}\n---\n{}", block_joined, body)
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
}
