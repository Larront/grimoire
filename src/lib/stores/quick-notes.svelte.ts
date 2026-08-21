// The open ledger's Quick Notes (#230).
//
// A [[Quick Note]] is a row and nothing else (ADR-0018), so this store is the
// whole of the frontend's model of one: no path to key by, no file to watch, no
// index to invalidate. It is a ledger-scoped list like Scenes or Templates —
// loaded when a ledger opens, emptied when it closes — and `count` is what the
// rail badge (#233) will read.
import { api } from "$lib/api";
import { createLedgerCollection } from "./ledger-collection.svelte";
import type { QuickNote } from "$lib/bindings.gen";

function createQuickNotesStore() {
  const base = createLedgerCollection<QuickNote>({
    fetch: () => api.listQuickNotes(),
  });

  /**
   * Commit one captured line, and return the row it became — or `null` when
   * there was nothing to commit. **An empty box writes nothing**: every capture
   * surface can be left without typing, and a blank row would be a thought the
   * GM cannot read.
   *
   * Re-reads the list rather than appending locally, as every other ledger
   * collection's mutations do: the row's id and stamp come from the ledger, so
   * the ledger is what says what the list now holds.
   */
  async function capture(body: string): Promise<QuickNote | null> {
    if (!body.trim()) return null;
    const note = await api.createQuickNote(body);
    await base.load();
    return note;
  }

  /**
   * Rewrite one Quick Note's line, and return the row it became — or `null` when
   * there was nothing to write.
   *
   * **A cleared field is not a delete.** Emptying the box refuses the same way
   * capture does, and the drawn value snaps back to what the ledger still holds:
   * forgetting a thought is its own gesture, with its own undo window, and a blank
   * commit that silently destroyed a line would have none.
   *
   * Re-reads the list rather than patching the row in place, as capture does — the
   * ledger is what says what the list now holds.
   */
  async function edit(id: number, body: string): Promise<QuickNote | null> {
    if (!body.trim()) return null;
    const note = await api.updateQuickNote(id, body);
    await base.load();
    return note;
  }

  /**
   * Forget one Quick Note.
   *
   * Called only once an undo window has elapsed, which is why nothing here is
   * deferred: the row is still in the ledger for the whole of that window, so
   * undo is a cancelled timer rather than a restore, and nothing has to know how
   * to rebuild a thought.
   */
  async function remove(id: number): Promise<void> {
    await api.deleteQuickNote(id);
    await base.load();
  }

  return {
    get notes() {
      return base.items;
    },
    get count() {
      return base.count;
    },
    get isLoading() {
      return base.isLoading;
    },
    get error() {
      return base.error;
    },
    load: base.load,
    capture,
    edit,
    remove,
  };
}

export const quickNotes = createQuickNotesStore();
