// Reactive counter bumped by the Command Wrapper after any command that changes
// a tag ledger-wide — renaming, merging or deleting it (and undoing that), or its
// graph colour or visibility (see TAG_WRITING_COMMANDS in `$lib/api`). Every
// note and pin [[Details Source]] and the Graph Pane subscribe.
//
// The sibling of `links-tick.svelte.ts`, for the same reason: the Tag Manager
// rewrote every note carrying a tag while an open note's Details went on showing
// the old name, and the graph went on drawing the old colour until it was
// reopened. A refresh the writer has to remember is a refresh someone forgets.
let tick = $state(0);

export const tagsTick = {
  get value() {
    return tick;
  },
  bump() {
    tick++;
  },
};
