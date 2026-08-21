# ADR-0018 — A Quick Note is a row, not a note

**Status:** Accepted
**Date:** 2026-08-20

## Context

A **Quick Note** is one line a GM captures mid-session: a thought that came up, does not belong
in the note they have open, and has no home yet. It is captured from anywhere by keyboard through
the [[Quick Notes Dialog]] and read back in the [[Quick Notes Pane]], grouped by the day it was
captured.

Everything else in a ledger that holds the GM's prose is a **note**: a markdown file on disk plus
a `notes` row, visible in the Files tree, filed in the [[Link Index]], matched by the
[[Search Index]] and drawn in the [[Graph Pane]]. That uniformity is load-bearing — it is why
notes are portable, why wikilinks resolve, and why "notes are plain files, never locked in" is a
promise the app can keep.

This ADR settles whether a Quick Note is one of those. The question is not cosmetic: it decides
whether a `[[wikilink]]` inside a Quick Note produces a Backlink, whether the pen shows up in
search results next to the world's own notes, and what a Quick Note is made of on disk.

## Decision

**A Quick Note is a row in the ledger's SQLite database, not a note and not a file.** It has no
path, no title and no place in the Files tree, and no surface in the app can open it as a note.

**Every derived index is blind to Quick Notes, without exception.** Their text may contain
`[[wikilinks]]`, and those links are drawn and clickable in the pane — but they are not filed in
the Link Index. A Quick Note produces no Backlinks, adds no edge to the graph, and is not matched
by the Search Index. Retrieval inside the pen is served by a text filter over the rows the pane
has already loaded, not by Tantivy.

**Filed links arrive when the Quick Note does.** The deferred _file it_ action appends a Quick
Note's line into a real note; from that moment its links are ordinary prose wikilinks and are
indexed like any others. Promotion into the world is what makes a link real.

## Considered Options

- **A note row the Files tree hides** (rejected) — `Quick Notes.md` at the ledger root, an
  ordinary note filtered out of `get_file_tree`. Nearly free, and it keeps links, search, the
  watcher and portability with no new machinery. Rejected because "hidden" has to be re-asserted
  at every entrance: a search hit, a graph-node click, and any other path that would open a
  `NotePane` each need a redirect, or the GM gets a second live editor buffer on a file the
  capture box is also writing — against the invariant `openTab` holds everywhere else (one note,
  one buffer). One special case in five subsystems is worse than one entity that is honestly not
  a note.

- **A markdown file the `notes` table does not know about** (rejected) — path-addressed the way
  PDFs are ([ADR-0011](./0011-pdfs-path-addressed-not-entities.md)). Keeps the scraps greppable
  in any editor, which is a real benefit. Rejected on identity: editing and deleting a single
  Quick Note — and later filing one — needs a stable id per item, and a bullet in a markdown file
  has none, so every operation becomes a text-range rewrite of a file two surfaces are appending
  to. A table gives identity, capture-day grouping and ordering for free. The PDF precedent also
  does not transfer: a PDF contains no wikilinks, so path-addressing costs it nothing.

- **A note row, with the Link Index extended to a second source kind** (rejected) — would let
  Quick Notes carry real Backlinks. Rejected as the expensive answer to a question the GM did not
  ask: it widens `BacklinkNote`, adds a Search Index doc kind, adds a graph node kind and amends
  [ADR-0005](./0005-link-index-path-keyed.md), so that unfiled scraps can appear beside the
  world's own notes in exactly the surfaces the "not filed" decision exists to keep clean.

## Consequences

- **`LinkedTextField`'s rule inverts, deliberately.** Its header argues that every free-text value
  must draw its links because the scanner is fence-blind, so "a field that showed flat text would
  be lying about a link Grimoire has already filed." Quick Notes are the mirror image: a field
  drawing a link Grimoire has _not_ filed. The rule becomes **drawn links are a superset of filed
  links, and the gap is exactly the unfiled pen.** Any future surface outside a note that draws
  wikilinks inherits this reading, and must say so.

- **Quick Notes are not human-readable outside Grimoire.** They travel with the ledger, since
  `.grimoire/` lives inside the ledger folder, so copying or moving a world keeps them — but they
  cannot be grepped or opened in another markdown editor. Accepted because a Quick Note is
  explicitly pre-filing: the moment its content matters it becomes prose in a note, which is
  portable. What is lost is legibility for the scraps that never earned a home.

- **Quick Notes are lost on a database rebuild**, alongside scenes and pins, mitigated by the same
  snapshot that keeps corruption at most one session stale. `DbRecoveryDialog` must name them in
  the sentence that already names scenes and pins.

- **The Sample Ledger seeds one**, in code, following `seed_sample_world_maps` and
  `seed_sample_world_scenes` — the sample's non-file entities are already seeded this way.

- **No [[Ledger Format Version]] bump.** No note file changes shape, so
  [ADR-0017](./0017-consented-vault-migration.md)'s consent flow does not apply; a dated Diesel
  migration adds the table like any other.

- **Until _file it_ ships, clearing the pen means deleting.** The count badge encourages a GM to
  empty a list whose only exits are edit and delete. This is accepted for the first version and is
  the strongest argument for building _file it_ next.
