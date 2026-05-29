# ADR-0006 — Pane-local detail surface with width-based dock/float

**Status:** Accepted
**Date:** 2026-05-29

## Context

Grimoire grew three separate "detail" surfaces that drifted apart in look, edit
contract, and token vocabulary:

- `RightRail.svelte` — the **note** Details Pane. An *app-level* `<aside>` docked at the
  far right of the window, a singleton that "follows focus" in split view (ADR-0003,
  and the `Right rail in split view → follows focus` decision in CONTEXT.md). Self-fetching
  edit model. Collapses to width 0 with its toggle hidden whenever the focused pane is not
  a note.
- `map/PinDetailPanel.svelte` — the **pin** editor. A *pane-local* floating panel anchored
  over the map. Controlled (`onUpdate(patch)`) edit model.
- `map/AnnotationDetailPanel.svelte` — the **annotation** editor. Same floating, pane-local,
  controlled pattern.

A prototype (separate session) compared docked vs floating placement, including floating
detail panels in note panes. The app-level singleton was identified as the root cause of the
model's awkwardness: it forces a follows-focus tiebreak, makes two notes' details
unviewable at once, and detaches a left-pane note's rail to the far-right edge. The only real
reason it was app-level is **width** — a 300px rail docked *inside* a half-width split pane
leaves an unusably narrow editor (~220px on a 1280px laptop).

The tab model (`tabs.svelte.ts`) has at most two panes (`left` + nullable `right`), each
showing exactly one active tab. So the design space is "≤2 panes," not "N tabs."

## Decision

The detail surface becomes **pane-local, user-controlled, with width-based presentation.**

1. **Pane-local.** Each pane owns and renders its own detail surface for its active tab's
   entity. There is no app-level singleton and no follows-focus arbitration.
2. **Width-based dock/float.** A pane's detail surface renders **docked** (rail on the pane's
   right edge) when the pane is wider than the dock threshold (~820px), and **floating**
   (anchored overlay within the pane) when it is narrower. Maps always float regardless of
   width, so the surface never shrinks or occludes the map canvas.
   - No split → the single pane fills the content area → its docked rail sits at the window's
     right edge, **visually identical to the previous app-level rail**. The common case does
     not regress.
   - Split on a typical laptop → panes fall below the threshold → note surfaces float.
   - Split on a wide monitor → panes may exceed the threshold → note surfaces stay docked.
   - The mode is re-evaluated as the paneforge divider is dragged.
3. **Per-pane, user-controlled visibility.** Each pane toggles its own surface independently
   (note: rail toggle in that pane's editor toolbar; map: selecting a pin/annotation opens the
   panel). 0, 1, or 2 surfaces may be visible at once. The user decides their information load
   — nothing is auto-hidden to enforce restraint.
4. **One shared component, plural bodies.** A single `DetailPanel` shell (header, scroll body,
   `DetailSection` primitive, tokens, empty/save-status states) hosts pluggable bodies
   (`NoteDetails`, `PinDetails`, `AnnotationDetails`). Bodies stay different in content; the
   shell, section kit, controlled edit contract, and token vocabulary are unified. The shell
   is rendered docked or floating by its pane host.

## Rationale

- **Symmetry dissolves the hard cases.** When every pane owns its surface, "same vs different
  types across panes" and "coexist vs follows-focus" stop being questions: note|note shows two
  note surfaces, map|map shows two floating panels, note|map shows one of each — each toggled
  by the user. The `Right rail in split view → follows focus` arbitration is no longer needed.
- **Dock/float on width, not entity type.** The real axis is roomy-vs-cramped. Keying
  presentation to pane width preserves editor space in splits and keeps the docked experience
  for the full-width common case. Maps opt to float always because occluding/shrinking the
  canvas is worse than for prose.
- **User owns the information load.** Allowing two panels (the explicit ask) means the GM can
  see everything they want during prep, and reduce on-screen info by closing panels when they
  want focus. The tool does not decide for them.
- **Consolidation is the payoff.** One shell + section kit + controlled edit contract retires
  the three divergent token dialects (`bg-canvas`/`text-danger`/`text-accent`/`font-display`
  in the map panels vs `bg-sidebar`/`text-error`/`font-heading` in the rail) and the duplicated
  color-swatch rows, and fixes `PinDetailPanel`'s stale `goto('/note/:id')` navigation
  (route it through `tabs.openTab`).

## Consequences

- **Supersedes** the `Right rail in split view → follows focus` and `Rail visibility on
  non-note panes` decisions in CONTEXT.md, and extends ADR-0003 (Details Pane is notes-only):
  the rail/surface now engages on map panes too, via the shared `DetailPanel`. ADR-0003's
  "leave the door open to extend later" is the door now being opened.
- **Selection must be keyed per pane, not per entity id.** With the same map openable in both
  panes, selection lives on the pane instance (`left`/`right`), so two panes hold independent
  selections. Keying by `map_id` would drive both panes' panels from one selection — a bug.
- **Edit commit on tab/pane switch.** Switching a pane's active tab (e.g. map → note) must
  dismiss its floating panel cleanly and commit-or-cancel any in-flight pin title/description
  edit, so edits are neither lost nor leaked into a stale panel.
- **A measured breakpoint enters layout.** The dock threshold (~820px, tunable) is evaluated
  per pane and re-evaluated on divider drag; the surface animates between docked and floating
  modes. Reduced-motion snaps instead of animating.
- A floating note surface can overlap prose. It is user-opened, draggable/dismissible, and
  defaults to a pane corner — accepted, and validated by the prototype.
- Spatial note: a docked surface still lives on its pane's right edge; for a left-pane note in
  a wide split that edge is mid-window. Inherent to docking; accepted.
