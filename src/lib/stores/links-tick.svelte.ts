// Reactive counter bumped by the Command Wrapper after any command that can
// rewrite note bodies or change what a wikilink resolves to (see
// LINK_WRITING_COMMANDS in `$lib/api`). The RightRail and every note
// [[Details Source]] subscribe, so Backlinks and Outbound reload on save.
//
// The bump lives in the write path rather than at the call site because it used
// to be a caller obligation with exactly one caller who honoured it — and a
// second write path already existed in Rust (`commit_backlink_rewrites`, behind
// scene rename), so backlinks went stale with nothing to fail (#212).
let tick = $state(0);

export const linksTick = {
  get value() {
    return tick;
  },
  bump() {
    tick++;
  },
};
