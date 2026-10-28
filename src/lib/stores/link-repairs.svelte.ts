// Links that point to where a note used to be, and the GM's way to heal them — the
// "Repair links" tool ADR-0014 left as the bulk path's escape hatch.
//
// A reorganisation too big for the Ledger Watcher to follow file by file (a branch
// switch, a sync, folders dragged in Explorer) re-creates the moved notes, so nothing
// remembers where each went, and a link written as a path stops resolving. The note
// is usually still there under its name; the backend finds it by that name
// (`plan_link_repairs`) and rewrites only what the GM ticks (`apply_link_repairs`).
//
// Two ways in, by the owner's choice (2026-10 design review): after notes turn up at
// new places — on open, or mid-session — the world's "needs attention" place lists it
// quietly, and the palette's "Repair links…" checks on demand. Neither rewrites
// anything by itself: the GM's documents are never rewritten without being asked.
import { api } from "$lib/api";
import { toastSuccess } from "$lib/toast";
import type { LinkRepair, LinkRepairChoice } from "$lib/bindings.gen";

let repairs = $state<LinkRepair[]>([]);
let open = $state(false);
/** Listed in "needs attention": found after a change, not yet reviewed or left. */
let noticed = $state(false);
/** Bumped on every open and close, so a check that lands late is for no world. */
let generation = 0;

async function plan(): Promise<LinkRepair[] | null> {
  const asked = generation;
  const found = await api.silent.planLinkRepairs().catch(() => null);
  return asked === generation ? found : null;
}

export const linkRepairs = {
  get repairs() {
    return repairs;
  },
  /** How many links, counting each note that holds one. */
  get linkCount() {
    return repairs.reduce((n, r) => n + r.sources.length, 0);
  },
  get noticed() {
    return noticed && repairs.length > 0;
  },
  get open() {
    return open;
  },
  set open(v: boolean) {
    open = v;
  },

  /** Notes turned up at new places: list what can be healed, if anything. */
  async check() {
    const found = await plan();
    if (!found) return;
    repairs = found;
    noticed = found.length > 0;
  },

  /** Open the list, found afresh — the palette's way in, and "needs attention"'s. */
  async review() {
    const found = await plan();
    if (found) repairs = found;
    open = true;
  },

  /** Point the chosen links at their notes. The list has been reviewed: it goes. */
  async apply(choices: LinkRepairChoice[]) {
    const n = await api.applyLinkRepairs(choices);
    repairs = [];
    noticed = false;
    open = false;
    if (n > 0) toastSuccess(`${n} ${n === 1 ? "note" : "notes"} updated`);
  },

  /** Leave the links as they are. They still show as links to nothing. */
  leave() {
    repairs = [];
    noticed = false;
    open = false;
  },

  /** A world opened or closed: this list was the last one's. */
  clear() {
    generation++;
    repairs = [];
    noticed = false;
    open = false;
  },
};
