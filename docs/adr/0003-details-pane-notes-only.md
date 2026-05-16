# Details Pane is notes-only; pins keep the floating panel

In Phase 5 we considered making the right rail ("Details Pane") the single details surface for everything — notes, maps, pins, annotations — and retiring the in-map floating `PinDetailPanel`. We chose not to. The Details Pane engages only on note panes; map panes keep the existing floating panel (which gains tag and Pin Category editing); scene panes have no rail engagement. The rail also hides entirely (width 0, toggle gone) when the focused pane is not a note.

The unifying argument was "one mental model for details" but the cost — re-designing the pin panel into rail-shaped space, deciding rail behaviour for in-pane selection across map and scene panes, handling auto-open and sidebar-mutual-exclusion on tablets — was a Phase-5-sized chunk of work on its own, separate from Tags. The floating panel works for pins today and a 300px rail is the same width as the existing floating w-80, so the GM ergonomics aren't materially better in the rail. Keeping the pane scope notes-only ships Phase 5 cleanly and leaves the door open to extend the rail to other pane types later when there's a concrete need.

## Consequences

- The Details Pane domain term is bounded: it shows note metadata only. Future pane types can opt in.
- `PinDetailPanel`'s `shadow-2xl` violation of the Shadowless Rule remains — separate issue, not in scope for this decision.
- Adding rail support for a new pane type later is a localised change: it does not require unifying or retiring existing in-pane panels.
