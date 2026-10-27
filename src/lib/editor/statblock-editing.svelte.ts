// Which statblock is open for editing: one, across every note on screen.
//
// Each block kept its own flag, so a GM could leave three creatures' structure open and
// lose track of which fields belonged to which (2026-10 design review). Opening one now
// closes whichever was open; a block asks here rather than holding the answer itself.
let current = $state<symbol | null>(null);

export const statblockEditing = {
  /** Whether the block holding `token` is the one open for editing. */
  is(token: symbol): boolean {
    return current === token;
  },
  open(token: symbol): void {
    current = token;
  },
  /** Close the block holding `token`, if it is the open one — and only then. */
  close(token: symbol): void {
    if (current === token) current = null;
  },
};
