# ADR-0002 — Scene thumbnail icon persists when an image is uploaded

**Status:** Accepted
**Date:** 2026-05-11

## Context

Scene cards have a two-layer thumbnail: a background layer (color or image) and an icon layer (Lucide icon). When a user uploads a custom image, the image replaces the color background. The question is whether the icon should disappear when an image is present.

## Decision

The icon always renders, regardless of whether an image is uploaded. Uploading an image replaces the color background only. The icon renders on top of both color and image backgrounds.

## Rationale

Treating the icon as a pure fallback (visible only when no image exists) means the icon has no persistent value — it disappears the moment the user customises the scene. Treating it as a persistent identity marker means GMs can use the icon as a quick visual discriminator even across scenes that all have uploaded images.

This is consistent with how music apps (Spotify, Apple Music) handle playlist art with overlaid type marks, and with the "GM clarity under pressure" principle — the icon gives an immediate categorical signal (skull = combat, flame = dramatic, scroll = lore reveal) that a photo alone may not.

## Alternatives considered

**Icon as fallback only** — simpler rendering, but loses the identity signal the moment an image is uploaded. Reduces the icon to a temporary placeholder rather than a design element.

## Consequences

- The icon renders at a consistent position and size over both color and image backgrounds. Implementation must ensure legibility contrast (semi-transparent dark overlay or icon shadow may be needed over light images).
- `thumbnail_icon` is stored as a nullable column. `NULL` means "use the default icon." The icon is always rendered — `NULL` does not mean "no icon."
- When designing the hero header in the Scene Editor, the same two-layer treatment applies: image (or color) as background, icon overlaid.
