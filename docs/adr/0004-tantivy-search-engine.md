# ADR-0004 — Tantivy as the vault search engine

**Status:** Accepted
**Date:** 2026-05-16

## Context

Phase 6 introduces vault-wide search across notes, maps, scenes, and tags, with results rendered in the command palette. The success criteria require sub-200ms response on vaults of 200+ notes, full-text search across note bodies, tag faceting, and the same regenerable-from-vault-scan lifecycle that Phase 5's tag index established.

## Decision

Use **Tantivy** (Rust crate, embedded) as the single search engine for all vault search. A single Tantivy index lives at `vault/.grimoire/search-index/` and holds one document per searchable entity (notes, maps, scenes), discriminated by a `kind` field. Tags are a faceted multi-value field on note documents, not a separate document type. SQLite (`vault/.grimoire/index.db`) remains the canonical entity store and tag-relationship store; Tantivy is a derived index, regenerable from a vault scan.

## Rationale

The driving requirement is **fuzzy matching for GM-under-pressure typo tolerance**. A GM mid-session typing "Captian Ash" (transposed letters) and getting zero results fails the *"GM clarity under pressure"* design principle. SQLite FTS5 supports only prefix wildcards (`capt*`); Tantivy's `FuzzyTermQuery` with Levenshtein distance covers transpositions, dropped letters, and doubled letters — the exact errors stressed humans make.

Secondary benefits that align with future phases:

- **BM25 with per-field boosts** lets title matches outrank body matches without manual scoring.
- **Faceted aggregation** gives tag-count chips (`npc (12 notes)`) for free, and is the natural backbone for Phase 9's graph clustering by tag.
- **Snippet generation with word-boundary awareness** produces cleaner excerpts than FTS5's `snippet()`.

A single Tantivy index (rather than splitting maps/scenes into SQLite `LIKE` queries) was chosen for **query-path consistency** — one ranking model, one fuzzy behaviour, one result-merge code path across all five palette groups.

## Alternatives considered

**SQLite FTS5** — ships with Tauri's bundled SQLite, zero new dependencies, shares a transaction with note-row writes. Rejected on fuzzy matching alone. Prefix wildcards do not cover transposition typos, which are the GM live-play failure mode. BM25 ranking is also less flexible (no per-field boosts without manual scoring).

**Tantivy for notes only, SQLite `LIKE` for maps/scenes** — initial proposal. Rejected at the user's preference for uniform ranking and a single query path. The cost saving (a few small tables not in Tantivy) did not outweigh having two search code paths.

**External engines (Meilisearch, Sonic)** — would mean a separate process bundled with Tauri. Disproportionate for a single-user local app; rejected on packaging cost.

## Consequences

- **Two indexes to coordinate** — SQLite for entity rows and tag relationships, Tantivy for search. Note-write commands wrap both writes in a transaction-like sequence; on Tantivy write failure the index is marked stale and a rebuild is scheduled. Surfaced to the user as a non-blocking status when relevant.
- **Two rebuild paths from a vault scan** — a single `rebuild_indexes` command rebuilds both in sequence. The Phase 5 recovery guarantee extends: *"Deleting `vault/.grimoire/` and reopening the vault recovers all tags and search."*
- **Tantivy schema is code** — a schema change is a forced full reindex. Acceptable: schema changes are rare and the rebuild path already exists for recovery.
- **+3–5MB binary size** — Tauri bundle already in the 10MB+ range; not a packaging concern.
- **Incremental updates on save** — every `save_note` / `rename_note` / `delete_note` upserts the Tantivy document inline, so notes created since the last full scan are searchable immediately. Full rebuild is only the cold-start and recovery path.

## Schema (single index)

| Field | Type | Notes |
|---|---|---|
| `kind` | string (stored, indexed) | `"note"`, `"map"`, `"scene"` |
| `entity_id` | i64 (stored) | SQLite row id |
| `path` | string (stored, not indexed) | Notes only; relative vault path |
| `title` | text (stored, indexed, BM25-boosted) | Notes/maps `title`, scenes `name` |
| `body` | text (indexed, not stored) | Notes only; plain text extracted from markdown |
| `tags` | facet, multi-value | Notes only; lowercase tag strings |
| `archived` | bool (indexed) | Notes only; defaults to filtered-out at query time |
| `modified_at` | datetime (stored, fast) | For MRU tie-breaking in result ordering |

## Tokenizer

Tantivy default tokenizer with lowercasing, ASCII folding (diacritics removed for matching, preserved for display), no stemming, minimum token length 2. Stemming deferred because fantasy proper-noun behaviour under English stemmers is unpredictable.
