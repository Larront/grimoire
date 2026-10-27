// What in the open world needs the GM: pins that lost their note, notes Grimoire
// couldn't open, and notes moved outside Grimoire whose links point at their old
// place. One list, worded once, drawn by the world menu and the World Home.
//
// These were three lasting toasts until the 2026-10 design review: they stacked,
// hid one another, and stayed on the Splash after their world closed. The owner
// chose one quiet place instead, which belongs to its world by construction — each
// source is cleared when a world opens or closes.
import { unlinkedPins } from "$lib/stores/unlinked-pins.svelte";
import { unreadableNotes } from "$lib/stores/unreadable-notes.svelte";
import { staleLinks } from "$lib/stores/stale-links.svelte";

export type AttentionKind = "pins" | "notes" | "links";

export interface AttentionItem {
  kind: AttentionKind;
  /** A key unique within the list. */
  key: string;
  /** What needs attention, in the GM's words. */
  label: string;
  /** The one thing to do about it. */
  action: { label: string; run: () => void | Promise<void> };
  /** Set aside without doing it, where that is safe. */
  dismiss?: { label: string; run: () => void };
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export const needsAttention = {
  get items(): AttentionItem[] {
    const items: AttentionItem[] = [];
    const pins = unlinkedPins.count;
    if (pins) {
      items.push({
        kind: "pins",
        key: "pins",
        label: `${plural(pins, "pin", "pins")} lost ${pins === 1 ? "its" : "their"} note`,
        action: { label: "Show pins", run: () => unlinkedPins.show() },
      });
    }
    const notes = unreadableNotes.count;
    if (notes) {
      items.push({
        kind: "notes",
        key: "notes",
        label: `${plural(notes, "note", "notes")} couldn't be opened`,
        action: { label: "Show notes", run: () => unreadableNotes.show() },
      });
    }
    for (const move of staleLinks.moves) {
      items.push({
        kind: "links",
        key: `links:${move.from}`,
        label: `“${move.name}” moved outside Grimoire; ${plural(move.count, "link", "links")} still point${move.count === 1 ? "s" : ""} to where it was`,
        action: { label: "Update links", run: () => staleLinks.update(move.from) },
        dismiss: { label: "Leave them", run: () => staleLinks.leave(move.from) },
      });
    }
    return items;
  },
  get count() {
    return unlinkedPins.count + unreadableNotes.count + staleLinks.count;
  },
};
