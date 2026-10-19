// Writing the note a dotted link points at — from a click on the link in prose, or the
// Create button on its preview card.
import { api } from "$lib/api";
import { notes } from "$lib/stores/notes.svelte";
import { tabs } from "$lib/stores/tabs.svelte";
import { toastUndo } from "$lib/toast";
import { parseWikiTarget } from "./wiki-target";

/**
 * Creates the note a link names and opens it, with "Created … · Undo".
 *
 * One click still does it — the GM asked to see the note — but it used to happen with
 * nothing said and no way back, so a misclick mid-session left an empty file in the ledger
 * and the GM in another note. Undo takes them back and removes the note, which nothing has
 * been written into yet.
 */
export async function createNoteFromStub(path: string): Promise<void> {
  const { title } = parseWikiTarget(path);
  const pane = tabs.focusedPane;
  const created = await api.createNote(title, path, null);
  await notes.load();
  tabs.navigate({ type: "note", id: created.id, title: created.title });
  toastUndo(
    `Created ${created.title}`,
    () => {},
    async () => {
      tabs.navigateBack(pane);
      await api.deleteNote(created.id);
      await notes.load();
    },
  );
}
