# Timeline serialized as a fenced markdown code block

Timelines are authored inline in a note via the `/timeline` slash command and stored **in the note's own markdown** as a fenced ` ```timeline ` code block, rather than as an opaque HTML element or a SQLite-backed entity. Each event is a blank-line-separated record of labeled lines inside the fence:

```timeline
Date: 3rd of Frostfall
Title: [[The Shattering]]
The council voted to dissolve the ancient pact.
It began the war.

Date: Midwinter
Title: Siege of [[Highvale]]
```

Within a record the header is the leading lines — an optional `Date:` line followed by the `Title:` line — and the `Title:` line ends the header: every line after it is the description, even one that starts with `Date:` or `Title:`. `Title:` is required; `Date:` and the description are optional. Title and description are plain strings that may contain literal `[[wikilinks]]` (and only wikilinks — no other inline markdown).

## Why

A Timeline Event's data *is* the note content (unlike a Scene, which a block references by SQLite id). The ledger-portability principle — defended for frontmatter tags and elsewhere — therefore applies directly: a fenced block keeps every event legible, greppable, and hand-editable in Obsidian or VS Code, matching the established `mermaid`/`dataview` fenced-block convention. An opaque `<timeline>` HTML blob (the Scene-block approach) would degrade to unreadable soup in any other tool.

The fence body avoids inline delimiters (`|`, `:`) because wikilink display syntax (`[[path|display]]`) and date labels (`Year 812: dawn`) legitimately contain them. Labeled lines are self-describing in the raw file and degrade gracefully when an optional field is absent, where a positional format would silently mislabel fields on a missing line.

## Considered options

- **Opaque HTML block** (`<timeline><event …>`) — rejected: mirrors SceneBlock but bakes all event content into Grimoire-only HTML, reversing the portability principle for content that is not a mere id reference.
- **Native-degrading markdown** (a real heading + list the parser re-reads) — rejected: no unambiguous delimiter, collides with hand-authored prose lists, fragile to re-parse.
- **Pipe/colon-delimited marker line** (`# date | title`) — rejected: `|` collides with wikilink display text, `:` with date labels.

## Consequences

- Wikilinks inside the fence are indexed for free: `extract_wikilinks` scans the whole note body including code fences, so timeline links feed the Link Index, Backlinks, and the Graph with no new indexing code, and rename-rewrite reaches into the fence too.
- The block is an **atom** TipTap node whose event fields are plain `[[...]]`-bearing strings (see CONTEXT.md decision row); true nested-ProseMirror content is deferred.
- A description cannot contain a blank-line paragraph break (the blank line is the event separator). Acceptable for short event blurbs; revisit if multi-paragraph descriptions become a real need.
- Because the `Title:` line ends the header, a hand-authored `Date:` line placed *after* `Title:` is read as description rather than the date. The serializer always emits `Date:` first, so this only affects out-of-canonical-order hand edits — the trade-off that lets description content beginning with `Date:`/`Title:` survive a round-trip intact.
