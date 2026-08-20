# ADR-0004 — Tantivy as the ledger search engine

**Status:** Accepted
**Date:** 2026-05-16

## Context

Phase 6 introduces ledger-wide search across notes, maps, scenes, and tags, with results rendered in the command palette. The success criteria require sub-200ms response on ledgers of 200+ notes, full-text search across note bodies, tag faceting, and the same regenerable-from-ledger-scan lifecycle that Phase 5's tag index established.

## Decision

Use **Tantivy** (Rust crate, embedded) as the single search engine for all ledger search. A single Tantivy index lives at `ledger/.grimoire/search-index/` and holds one document per searchable entity (notes, maps, scenes), discriminated by a `kind` field. Tags are a faceted multi-value field on note documents, not a separate document type. SQLite (`ledger/.grimoire/index.db`) remains the canonical entity store and tag-relationship store; Tantivy is a derived index, regenerable from a ledger scan.

## Rationale

The driving requirement is **fuzzy matching for GM-under-pressure typo tolerance**. A GM mid-session typing "Captian Ash" (transposed letters) and getting zero results fails the _"GM clarity under pressure"_ design principle. SQLite FTS5 supports only prefix wildcards (`capt*`); Tantivy's `FuzzyTermQuery` with Levenshtein distance covers transpositions, dropped letters, and doubled letters — the exact errors stressed humans make.

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

- **Two indexes to coordinate** — SQLite for entity rows and tag relationships, Tantivy for search. Note-write commands wrap both writes in a transaction-like sequence; a failed Tantivy write is logged and the operation still succeeds, because the index is rebuilt in full at the next ledger open (see the amendment below).
- **Two rebuild paths from a ledger scan** — a single `rebuild_indexes` command rebuilds both in sequence. The Phase 5 recovery guarantee extends: _"Deleting `ledger/.grimoire/` and reopening the ledger recovers all tags and search."_
- **Tantivy schema is code** — a schema change is a forced full reindex. Acceptable: schema changes are rare and the rebuild path already exists for recovery.
- **+3–5MB binary size** — Tauri bundle already in the 10MB+ range; not a packaging concern.
- **Incremental updates on save** — every `save_note` / `rename_note` / `delete_note` upserts the Tantivy document inline, so notes created since the last full scan are searchable immediately. Full rebuild is only the cold-start and recovery path.

## Schema (single index)

| Field         | Type                                 | Notes                                              |
| ------------- | ------------------------------------ | -------------------------------------------------- |
| `kind`        | string (stored, indexed)             | `"note"`, `"map"`, `"scene"`                       |
| `entity_id`   | i64 (stored)                         | SQLite row id                                      |
| `path`        | string (stored, not indexed)         | Notes only; relative ledger path                   |
| `title`       | text (stored, indexed, BM25-boosted) | Notes/maps `title`, scenes `name`                  |
| `body`        | text (indexed, not stored)           | Notes only; plain text extracted from markdown     |
| `tags`        | facet, multi-value                   | Notes only; lowercase tag strings                  |
| `archived`    | bool (indexed)                       | Notes only; defaults to filtered-out at query time |
| `modified_at` | datetime (stored, fast)              | For MRU tie-breaking in result ordering            |

## Tokenizer

Tantivy default tokenizer with lowercasing, ASCII folding (diacritics removed for matching, preserved for display), no stemming, minimum token length 2. Stemming deferred because fantasy proper-noun behaviour under English stemmers is unpredictable.

## Amendment — 2026-08-18: the stale marker is removed (issue #205)

**Status:** Accepted

The consequence above promised that a failed Tantivy write would mark the index
stale, schedule a rebuild, and surface a non-blocking status. A marker was
built — `.grimoire/search.stale`, written by the reconcile seam and cleared at
open — and the scheduling and the surfacing were not. Nothing ever read the
marker.

Nothing ever could, either, and that is what settles this. `open_ledger`
rebuilds the whole Search Index from a ledger walk on every open, marker or no
marker, so its presence cannot change what the app does. The only way to make it
matter would be to _skip_ that rebuild when it is absent — and the rebuild is the
one thing that picks up a vault edited while Grimoire was closed, which leaves no
marker behind because no Grimoire was running to write one. Wiring the marker up
would have traded a guarantee for a file.

So the marker, its two writers, its two clear functions and its nine call sites
are gone. In their place:

- **A failed incremental write is logged, not reported.** Every incremental
  Search Index write in the app goes through `search::best_effort`, which is the
  single place a failure is recorded. Notes, maps and scenes all take that path,
  so a miss reads the same wherever it happened (issue #216) — before this, the
  seven map and scene writes discarded their errors outright.
- **A miss costs a stale palette result until the next open, and never content.**
  The operation the GM asked for — the save, the rename, the delete — succeeds
  regardless. That was always the posture; it is now the whole of it.
- **The recovery guarantee is unchanged and is now the only mechanism.**
  _"Deleting `ledger/.grimoire/` and reopening the ledger recovers all tags and
  search"_ — and so does simply reopening.

Nothing is surfaced to the GM. A stale palette entry that heals itself the next
time they open the vault does not earn a place on screen during play.
