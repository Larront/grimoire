import { invoke } from "@tauri-apps/api/core";
import { ledger } from "./ledger.svelte";
import type { Note } from "$lib/types/ledger";

function createNotesStore() {
  let notes = $state<Note[]>([]);
  let isLoading = $state(false);
  let error = $state<string | null>(null);

  async function load() {
    isLoading = true;
    error = null;
    try {
      notes = await invoke<Note[]>("get_notes");
    } catch (e) {
      error = String(e);
    } finally {
      isLoading = false;
    }
  }

  async function readContent(id: number): Promise<string | null> {
    try {
      const note = notes.find((n) => n.id === id);
      if (!note) return null;
      return await invoke<string>("read_note_content", { notePath: note.path });
    } catch (e) {
      error = String(e);
      return null;
    }
  }

  $effect.root(() => {
    $effect(() => {
      if (ledger.isOpen) {
        load();
      } else {
        notes = [];
        error = null;
      }
    });
  });

  return {
    get notes() {
      return notes;
    },
    // Called after any create/delete mutation to keep the count reactive.
    // AppSidebar calls notes.load() after handleNewNote and delete operations.
    get noteCount() {
      return notes.length;
    },
    get isLoading() {
      return isLoading;
    },
    get error() {
      return error;
    },
    load,
    readContent,
  };
}

export const notes = createNotesStore();
