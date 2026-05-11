# ADR-0001 — Vault media directory split by intent

**Status:** Accepted
**Date:** 2026-05-11

## Context

Two features require storing image files inside the vault:

- **Phase 2 (Scenes):** Scene thumbnails — user-uploaded images that label a scene card
- **Phase 4 (Images):** Note images — images the GM inserts inline into note content

Both could live in a single `vault/media/` directory, but they represent different kinds of content.

## Decision

Split storage by intent:

- `vault/media/` — note images (user-authored content that appears in documents)
- `vault/.grimoire/thumbnails/` — scene thumbnails (app-managed metadata that labels scenes)

## Rationale

Note images are **user content** — the GM explicitly authors them into a document, and they are part of the document's meaning. Scene thumbnails are **app metadata** — the app associates them with a scene as a decorative label; they do not appear in any authored document.

The vault already uses `vault/.grimoire/` for app-internal bookkeeping (Phase 7 puts custom templates there). Thumbnails fit that pattern. Keeping `vault/media/` as "things that appear in notes" gives GMs a predictable mental model: if it's in `media/`, it came from a note.

## Alternatives considered

**Single `vault/media/` directory** — simpler path, but blurs the content/metadata distinction. A GM browsing their vault folder would find scene thumbnails mixed with note images, which is confusing.

## Consequences

- `vault/media/` is reserved for note-embedded images. Future media types (e.g., map overlays) should be evaluated against the content/metadata boundary before being placed here.
- Scene thumbnail paths stored in SQLite are relative to the vault root (e.g., `.grimoire/thumbnails/42.webp`), consistent with how audio file paths are stored.
