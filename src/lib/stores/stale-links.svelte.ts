// Notes moved outside Grimoire that other notes still link to at their old place
// (issue #135, ADR-0014), until the GM updates those links or leaves them.
//
// It was a toast that never closed, with "Update" and "Leave as-is", that outlived
// its world (2026-10 design review). The owner moved every world-level problem into
// one "needs attention" place — the ledger menu and the Ledger Home — so this is the
// list, and they draw it. Leaving the links is safe: they stay visible and can be
// healed later (ADR-0014).
import { api } from "$lib/api";
import { toastSuccess } from "$lib/toast";

export interface StaleMove {
  from: string;
  to: string;
  /** The note as the GM knows it: its name at the old place. */
  name: string;
  /** For display only — the update recomputes the real set. */
  count: number;
}

let moves = $state<StaleMove[]>([]);

function drop(from: string) {
  moves = moves.filter((m) => m.from !== from);
}

export const staleLinks = {
  get moves() {
    return moves;
  },
  get count() {
    return moves.length;
  },

  /** A move the watcher reported. A note moved twice is one entry, the latest. */
  add(from: string, to: string, count: number) {
    const name = from.split("/").pop()?.replace(/\.md$/i, "") ?? from;
    moves = [...moves.filter((m) => m.from !== from), { from, to, name, count }];
  },

  /** Rewrite the links to point at where the note is now. */
  async update(from: string) {
    const move = moves.find((m) => m.from === from);
    if (!move) return;
    const n = await api.applyBacklinkRewrite(move.from, move.to);
    drop(from);
    if (n > 0) toastSuccess(`${n} ${n === 1 ? "note" : "notes"} updated`);
  },

  /** Leave the links as they are. */
  leave(from: string) {
    drop(from);
  },

  /** A world opened or closed: this list was the last one's. */
  clear() {
    moves = [];
  },
};
