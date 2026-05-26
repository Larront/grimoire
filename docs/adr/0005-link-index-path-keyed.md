# ADR-0005 — Path-keyed link index for backlinks and graph

**Status:** Accepted
**Date:** 2026-05-27

## Context

Phase 9 introduces backlinks (Details Pane), outbound links (Details Pane), and a vault-wide graph. All three require a persistent record of which notes link to which. The existing wikilink system (`[[path]]` syntax in TipTap) resolves links at click time with no persistence — there is no index to answer "which notes reference this note?"

Two credible storage shapes were considered:

**Option A — Id-keyed:** `note_links(source_id INTEGER, target_id INTEGER)`, both FKs into `notes.id`. Resolution happens at index time: when `save_note` extracts wikilinks, it immediately resolves each `[[target]]` string to a note id. Unresolvable links are silently dropped.

**Option B — Path-keyed:** `note_links(source_id INTEGER, target_path TEXT)`. `source_id` is the authoring note's id. `target_path` is the raw `[[...]]` text exactly as written. Resolution is deferred to query time via a join against `notes.path` and `note_aliases.alias`.

## Decision

Use **Option B: path-keyed** (`target_path TEXT`). Populated incrementally on every `save_note` (same pipeline as `note_tags`); fully regenerable from a vault scan on `open_vault`.

## Rationale

### Broken links are a first-class concept

A GM writing `[[The Harbourmaster]]` before that note exists is a normal workflow — they're capturing a reference mid-session to flesh out later. The id-keyed approach silently drops this row. Path-keyed preserves it, enabling:

- **Stub Note rendering** in the graph (nodes for referenced-but-not-yet-created notes)
- **Dimmed outbound link** indicators in the Details Pane
- **Automatic resolution** when the stub note is eventually created — no re-scan needed, the row already exists

### Alias resolution stays flexible

Phase 9 also introduces `note_aliases(note_id, alias TEXT)`. A link like `[[Captain Ash]]` might resolve to `npcs/ash.md` because that note has `aliases: [Captain Ash]`. Id-keyed would require alias resolution at index time — if aliases change, the link index silently goes stale until the next `save_note` on the source note. Path-keyed resolves at query time against the current alias table, so alias edits are immediately reflected.

### Same pattern as `note_tags`

`note_tags(note_path, tag TEXT)` is already path-keyed for the same reason: the tag string is the canonical value, not a row id. Backlinks follow the same convention, keeping the two derived tables symmetric and the vault-scan rebuild logic consistent.

## Consequences

- Queries for backlinks require a join: `WHERE target_path = notes.path OR target_path IN (SELECT alias FROM note_aliases WHERE note_id = ?)` — slightly more complex than `WHERE target_id = ?`.
- Stub note detection is an anti-join: `SELECT DISTINCT target_path FROM note_links WHERE target_path NOT IN (SELECT path FROM notes) AND target_path NOT IN (SELECT alias FROM note_aliases)`.
- Rename handling must rewrite `target_path` rows in addition to updating markdown source files.
