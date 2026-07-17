import { api } from "$lib/api";
import { createLedgerCollection } from "./ledger-collection.svelte";
import type { Note } from "$lib/types/ledger";

function createNotesStore() {
  const base = createLedgerCollection<Note>({
    fetch: () => api.getNotes(),
  });

  async function readContent(id: number): Promise<string | null> {
    try {
      const note = base.items.find((n) => n.id === id);
      if (!note) return null;
      return await api.readNoteContent(note.path);
    } catch (e) {
      base.setError(String(e));
      return null;
    }
  }

  return {
    get notes() {
      return base.items;
    },
    // Called after any create/delete mutation to keep the count reactive.
    // AppSidebar calls notes.load() after handleNewNote and delete operations.
    get noteCount() {
      return base.count;
    },
    get isLoading() {
      return base.isLoading;
    },
    get error() {
      return base.error;
    },
    load: base.load,
    readContent,
  };
}

export const notes = createNotesStore();
