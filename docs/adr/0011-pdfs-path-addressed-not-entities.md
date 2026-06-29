# ADR-0011 — PDFs are path-addressed ledger files, not SQLite entities

**Status:** Accepted
**Date:** 2026-06-23

## Context

We are adding a PDF reader: PDFs appear in the Files tree with a distinct indicator and open in a tab like any other tab type. The codebase has two precedents for "a thing you open in a tab":

- **Maps** are SQLite entities (`maps` table, integer id). They earn that table because they own rich app-authored child data — pins, annotations, image dimensions — that has nowhere else to live.
- **Templates** are plain files keyed by path (`TabType "template"` + `templatePath`, rendered by `TemplatePane`). No table, no id, no registration.

A PDF carries no app-authored metadata today. The question was whether to register PDFs as first-class SQLite entities (a `pdfs` table, populated on `open_ledger`) or to treat them as path-addressed files like templates. The decision was complicated by a stated future intent to (a) link to PDFs via wikilinks and (b) full-text search PDF contents, and a roadmapped intent to (c) annotate PDFs — including Scene-links.

## Decision

PDFs are **path-addressed**. No `pdfs` SQLite entity table. The tab is `TabType "pdf"` carrying the ledger-relative path (mirroring the template pattern); tab-matching and persistence key on path. The Rust file-tree walk (`tree.rs`) adds `.pdf` to its curated allowlist as a plain `FileNode`; the frontend detects the extension from the node path — no id field is added to `FileNode`.

## Rationale

### The future features are path-based, not id-based

- **Linking** rides the existing Link Index, which is *already* path-keyed (`note_links(source_id, target_path)`, see [ADR-0005](./0005-link-index-path-keyed.md)). A `[[…]]` to a PDF is just a `target_path` that resolves to a `.pdf` instead of a `.md`. An id-keyed `pdfs` table would be the *wrong* shape — we'd resolve paths to ids and back.
- **Search** is a regenerable derived index (Tantivy, [ADR-0004](./0004-tantivy-search-engine.md)) rebuilt from a ledger scan inside the idempotent setup framework. PDF full-text search is a new derive step (scan `.pdf`, extract text, add docs). If it ever wants a row to hang metadata off, that row is a *derived, regenerable* index keyed by path — not canonical state, not a migration.

### The tab stays path-keyed regardless

Templates prove a tab needs no id. Even after search/link/annotation features exist, the tab still only needs to render a file by path. Any id that ever appears serves the graph/Tantivy layer, which keys on path anyway.

### Portability

A PDF dropped into the ledger folder appears; deleted, it's gone — with zero derived state to reconcile. This is the "delete `.grimoire/` and recover from a ledger scan" principle holding for a new file type.

## Consequences

- The Files tree now surfaces a file type the app did not author. The `tree.rs` walk stays a curated allowlist (`.md` + map images + `.pdf`); other arbitrary files remain hidden. Adding a file type is an explicit allowlist edit, not "show everything."
- **Scene-link annotations are the one canonical exception** (in scope for this feature, built last). A Scene-link is *not* regenerable from PDF bytes, so it is canonical SQLite state keyed by the PDF path: `pdf_scene_links(id, pdf_path, page, start_offset, end_offset, quote, scene_id, created_at)`. This means **renaming/moving a PDF must rewrite the `pdf_path` rows**, reusing the existing wikilink-rename path-rewrite machinery. Path-keying survives this — the key is the path, not a new PDF entity id. (`scene_id` is a real FK with `ON DELETE CASCADE`; the canonical state hangs off the path, not off a `pdfs` row.)
