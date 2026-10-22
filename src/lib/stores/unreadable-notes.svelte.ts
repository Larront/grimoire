// Notes — and folders — Grimoire couldn't read when the world opened, and the GM's way
// through them.
//
// A cloud-only file with the sync app off, a file another program has locked, a
// folder that won't list: the open walks past them and leaves their records alone
// (`import.rs`), so nothing is lost — they just won't open or show in search until
// they read. This is the list of them until they do.
//
// The pattern is `unlinked-pins.svelte.ts`'s (2026-10 design review): the list is the
// state, not the dialog's. Its toast is calm and stays, and counts down; the palette
// and the file tree reopen it; Try again reads the world's notes again without
// reopening it. It used to be a red ten-second toast whose list was gone once read.
import { api } from "$lib/api";
import { toastSuccess, toastUnreadableNotes } from "$lib/toast";
import { unlinkedPins } from "$lib/stores/unlinked-pins.svelte";
import type { FailedImport } from "$lib/bindings.gen";

let items = $state<FailedImport[]>([]);
let open = $state(false);
/** How many have come good since the list began — "still" in the toast. */
let fixed = $state(0);
let retrying = $state(false);

function announce() {
  toastUnreadableNotes(items.length, fixed > 0, () => (open = true));
}

export const unreadableNotes = {
  get items() {
    return items;
  },
  get count() {
    return items.length;
  },
  get open() {
    return open;
  },
  set open(v: boolean) {
    open = v;
  },
  get retrying() {
    return retrying;
  },

  /** A world opened: what its open couldn't read, in place of any other world's. */
  replace(next: FailedImport[]) {
    items = next;
    fixed = 0;
    open = false;
    announce();
  },

  show() {
    open = true;
  },

  /** Whether `path` (a note's, or a folder's) is one Grimoire couldn't read. */
  has(path: string): boolean {
    return items.some((i) => i.path === path);
  },

  /**
   * Read the world's notes again — once OneDrive is running, or the other program has
   * let go. Answers how many read this time. Anything the re-read unlinked joins the
   * pins to re-link.
   */
  async retry(): Promise<number> {
    if (retrying) return 0;
    retrying = true;
    try {
      const report = await api.rereadNotes();
      const before = items.length;
      items = report.failed_imports;
      const opened = Math.max(0, before - items.length);
      fixed += opened;
      if (items.length === 0) {
        open = false;
        if (before > 0) toastSuccess("Every note opens again");
      }
      announce();
      if (report.unlinked_pins.length) unlinkedPins.add(report.unlinked_pins);
      return opened;
    } finally {
      retrying = false;
    }
  },
};
