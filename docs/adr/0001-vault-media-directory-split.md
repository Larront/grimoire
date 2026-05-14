# ADR-0001 — Vault image directory split by intent

**Status:** Accepted
**Date:** 2026-05-11
**Revised:** 2026-05-15 — renamed `vault/media/` → `vault/images/` (see Revision note below)

## Context

Two features require storing image files inside the vault:

- **Phase 2 (Scenes):** Scene thumbnails — user-uploaded images that label a scene card
- **Phase 4 (Images):** Note images — images the GM inserts inline into note content

Both could live in a single directory, but they represent different kinds of content.

## Decision

Split storage by intent:

- `vault/images/` — note images (user-authored content that appears in documents)
- `vault/.grimoire/thumbnails/` — scene thumbnails (app-managed metadata that labels scenes)

## Rationale

Note images are **user content** — the GM explicitly authors them into a document, and they are part of the document's meaning. Scene thumbnails are **app metadata** — the app associates them with a scene as a decorative label; they do not appear in any authored document.

The vault already uses `vault/.grimoire/` for app-internal bookkeeping (Phase 7 puts custom templates there). Thumbnails fit that pattern. Keeping `vault/images/` as "things that appear in notes" gives GMs a predictable mental model: if it's in `images/`, it came from a note.

## Alternatives considered

**Single shared directory** — simpler path, but blurs the content/metadata distinction. A GM browsing their vault folder would find scene thumbnails mixed with note images, which is confusing.

**Name the user-content directory `media/`** — was the original decision. Revised because Phase 4 deliberately scopes only to images (no PDFs, audio attachments, or video), so `media/` was doing no extra work over `images/`. `images/` is also more literal for a GM browsing files looking for "the picture I dropped in".

## Consequences

- `vault/images/` is reserved for note-embedded images. If a future phase introduces non-image attachments (PDFs, audio in notes), revisit this naming rather than overloading `images/`.
- Scene thumbnail paths stored in SQLite are relative to the vault root (e.g., `.grimoire/thumbnails/42.webp`), consistent with how audio file paths are stored.

## Revision note (2026-05-15)

Originally specified `vault/media/`. Code shipped as `vault/images/` during Phase 2 thumbnail work. Reconciled to `vault/images/` rather than migrating, because the rename to `media/` was abstract framing that didn't reflect Phase 4's scope.
