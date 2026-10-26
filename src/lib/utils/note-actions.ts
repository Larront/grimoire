import { api } from "$lib/api";
import { notes } from "$lib/stores/notes.svelte";
import { tabs } from "$lib/stores/tabs.svelte";
import { treeExpansion } from "$lib/stores/tree-expansion.svelte";
import type { Note } from "$lib/types/ledger";

/**
 * The folder a new note goes in: the one holding the note the GM is in, or the
 * world's top level when the focused pane shows anything else.
 *
 * Revised in the 2026-10 design review. This used to be **root, always** (#227),
 * on the grounds that a guessed parent is wrong often enough to be unexplainable.
 * The guess here is the narrowest one there is — the folder of the page in front
 * of the GM, never the Files tree's selection — and the folder opens to show the
 * note, so where it went is never a mystery. A GM writing up Characters makes the
 * next character in Characters instead of dragging it there from the top.
 */
export function newNoteFolder(): string | null {
  const tab = tabs.activeTab;
  if (tab?.type !== "note") return null;
  const path = notes.notes.find((n) => n.id === tab.id)?.path;
  const slash = path?.lastIndexOf("/") ?? -1;
  return path && slash > 0 ? path.slice(0, slash) : null;
}

/** Open a just-made note, named, with its folder shown. */
async function openNew(note: Note, folder: string | null) {
  // Before the reload, so the rebuilt tree comes back already open (#164).
  if (folder) treeExpansion.reveal(folder);
  await notes.load();
  tabs.openTab({ type: "note", id: note.id, title: note.title, rename: true });
}

/**
 * Create `Untitled` beside the open note (see `newNoteFolder`) and open it, named,
 * in the focused pane.
 *
 * The one path behind every "new note" that is not pointed at a folder — the
 * [[Command Palette]]'s _Create note_, `Ctrl/Cmd+N` (#227), the sidebar's New menu
 * and the empty ledger's first-note button. They were copies of the same six
 * lines, and a shortcut whose behaviour is "identical to the palette's" is only
 * honestly identical if it is the same code. The Files tree's own _New note_
 * takes the folder the GM pointed at instead.
 *
 * Throws if the write fails, so each caller keeps its own way of saying so.
 */
export async function createUntitledNote(): Promise<void> {
  const folder = newNoteFolder();
  const newNote = await api.createNote(
    "Untitled",
    folder ? `${folder}/Untitled.md` : "Untitled.md",
    folder,
  );
  await openNew(newNote, folder);
}

/**
 * The same, starting from a template's text and tags — into `folder` when the GM
 * chose one (a folder's menu), else beside the open note.
 */
export async function createNoteFromTemplate(
  templatePath: string,
  folder: string | null = newNoteFolder(),
): Promise<void> {
  const newNote = await api.createNoteFromTemplate(templatePath, folder);
  await openNew(newNote, folder);
}
