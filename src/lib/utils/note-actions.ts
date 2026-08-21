import { api } from "$lib/api";
import { notes } from "$lib/stores/notes.svelte";
import { tabs } from "$lib/stores/tabs.svelte";

/**
 * Create `Untitled` at the ledger root and open it, named, in the focused pane.
 *
 * The one path behind every "new note" that is not pointed at a folder — the
 * [[Command Palette]]'s _Create note_, `Ctrl/Cmd+N` (#227), and the empty
 * ledger's first-note button. They were three copies of the same six lines, and
 * a shortcut whose behaviour is "identical to the palette's" is only honestly
 * identical if it is the same code.
 *
 * **Root, always.** No parent inferred from the Files tree's selection or the
 * active tab's folder: guessing is wrong often enough to be unexplainable when
 * it is, and a GM who wanted it elsewhere can move it in one drag. The Files
 * tree's own _New note_ is the affordance that does take a parent, because
 * there the GM has pointed at one.
 *
 * Throws if the write fails, so each caller keeps its own way of saying so.
 */
export async function createUntitledNoteAtRoot(): Promise<void> {
  const newNote = await api.createNote("Untitled", "Untitled.md", null);
  await notes.load();
  tabs.openTab({ type: "note", id: newNote.id, title: "Untitled", rename: true });
}
