# ADR-0014 — The external-move backlink prompt may pin a persistent toast

**Status:** Accepted
**Date:** 2026-07-17

## Context

When a note is renamed _inside_ Grimoire, `rename_note` rewrites every `[[old path]]`
wikilink in every other note (phase B) so inbound backlinks follow the move. When
the same file is renamed or moved _outside_ Grimoire — Obsidian, a file explorer,
a terminal `mv`, a sync tool — the [[Ledger Watcher]] correlates the move and
re-keys the moved note's own row (phase A), but it deliberately does **not**
rewrite the other notes' wikilink text: chasing an external tool's edits with
our own writes is exactly the kind of behind-the-GM's-back change the live-sync
design (ADR-0013) is careful to avoid. The result is that inbound `[[old path]]`
links silently degrade to broken/Stub links, with no signal to the GM.

Issue #135 closes that gap by _offering_ to heal those backlinks — never
silently, never without consent. The natural surface is a `svelte-sonner` toast
with two buttons (_Update_ / _Leave as-is_). But it has an unusual requirement:
it must **not auto-dismiss**. If the GM was looking at the other tool when the
move happened, a toast that fades in 8 seconds is a toast they never see, and the
broken backlinks stay broken with the one chance to fix them gone.

This collides with a standing principle in `toast.ts`, drawn from DESIGN.md's
"the tool disappears, the world remains": **the tool must never pin a permanent
surface to the corner during live play.** Every existing toast — success, error,
even the partial-import failure with its "Show details" action — has a finite
duration for this reason. A `duration: Infinity` toast is, on its face, exactly
what that principle forbids.

## Decision

Permit **one** persistent (`duration: Infinity`) toast: the external-move
backlink prompt (`toastExternalMoveLinks`). It stays on screen until the GM picks
_Update_ or _Leave as-is_. This narrows — does not repeal — the `toast.ts`
principle: **tool-generated corner-noise still always auto-expires; a persistent
toast is licensed only as a Conflict-Banner-class response to an unresolved
external change.**

The prompt is backed by a dedicated event and an on-demand command:

- The Ledger Watcher, after phase A of a _targeted_ (per-file) external move,
  computes how many other notes still link to the old path. If that count is
  greater than zero it emits `note:external-move-links-stale { from, to, count }`
  **in addition to** the existing `note:moved` event, so the existing refetch
  listener is untouched and the prompt subscriber fires only when there is
  something to offer.
- On the Watcher's **bulk** path (a batch over the adaptive full-rebuild
  threshold — a `git checkout`, a cloud-sync settling), **no prompt is emitted**;
  the case is logged. `rebuild_all_from_ledger` still makes the indexes
  consistent with disk, but the external tool owns that reorg and the app must
  not chase its wikilink text with a flood of prompts. Broken backlinks remain
  visible as dimmed/Stub links, recoverable later (a manual _Repair backlinks_
  tool is a recorded follow-up, out of scope here).
- _Update_ calls `apply_backlink_rewrite(from, to)`, which **recomputes** the
  affected set from the current ledger rather than trusting the count the toast
  displayed — the ledger may have changed while the prompt sat on screen, so the
  count is display-only and a stale count can never edit the wrong notes.
  _Leave as-is_ dismisses with no backend call.

## Rationale

### Why this toast is not the noise the principle forbids

The principle exists to stop the _tool_ from announcing _itself_ — a success
banner for an action whose result is already visible, an error that lingers past
usefulness. This prompt is categorically different: it is the app's response to
**something the world did that the app cannot silently resolve** — the same class
of surface as the [[Conflict Banner]] (an open note diverging on disk with unsaved
edits). Both are non-destructive, both wait for a choice, both exist precisely
because auto-resolving would either lose data or hide a real divergence. The
Conflict Banner is already an accepted permanent-until-answered surface (ADR-0013
point 4); this is the toast-shaped equivalent for a note that is _not_ currently
open, so there is no pane to host an in-line banner.

### Why persistence is non-negotiable here

An external move is frequently something the GM did in _another_ window. A finite
toast assumes the GM is watching Grimoire at the moment the filesystem event
lands — precisely the assumption that fails for external edits. Auto-dismiss
would turn "offer to heal" into "occasionally offer to heal, if you happened to
be looking," which is worse than not offering at all because it is
unpredictable.

### Why ignoring it is safe

Persistence is only defensible because _Leave as-is_ is a real, safe answer.
Doing nothing never risks data: the backlinks stay exactly as the external tool
left them, visible as dimmed/Stub links, and healable later. The prompt never
rewrites anything without an explicit _Update_. So a GM who dismisses it — or
never clicks either button — loses nothing.

### Why recompute at apply time

Because the toast can sit on screen indefinitely, the count it shows can go
stale (the GM edits, another external change lands). Trusting a captured plan
could rewrite notes that no longer link to the old path, or miss ones that now
do. Recomputing in `apply_backlink_rewrite` makes the _displayed_ count purely
informational and the _applied_ change always correct for the ledger as it is
when the GM consents.

## Consequences

- `toast.ts` gains `toastExternalMoveLinks` (the only `duration: Infinity` toast)
  and its top-of-file comment is updated to record this single narrowing.
- The frontend event contract (ADR-0013) gains `note:external-move-links-stale`,
  emitted only alongside `note:moved` on the targeted path, only when count > 0.
- A new command `apply_backlink_rewrite(from_path, to_path)` performs phase B on
  demand via the [[Note Mutation]] `commit_many` envelope, recomputing the plan.
- The bulk external-move path deliberately does **not** heal or prompt; the
  manual _Repair backlinks_ tool remains a recorded follow-up.
- The principle stands for everything else: a future contributor adding a
  permanent tool-generated toast is still doing the thing this ADR explicitly
  did _not_ license.
