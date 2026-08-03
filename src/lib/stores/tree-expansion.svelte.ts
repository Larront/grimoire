// Which folders in the Files tree are open (#164).
//
// This lives outside the tree because of two things the tree cannot do on its
// own. First, the tree is **rebuilt** on every change — creating, renaming, or
// moving anything refetches it from disk and replaces every row — so expansion
// held in a row dies with that row, and folders you had open snap shut for no
// reason a GM can see. Second, creating a note *inside* a folder has to open
// that folder, and the thing doing the creating is the sidebar, which has no
// handle on the row it would need to ask.
//
// Keying on path rather than on the row solves both: a rebuilt tree looks itself
// up and comes back open, and anything holding a path can reveal it.
//
// Open folders are remembered for as long as a ledger is open, not across
// restarts. A fresh session starting collapsed is a reasonable place to begin;
// having it silently restore a tree you last touched a week ago is not clearly
// better, and persisting would have to be per-ledger to mean anything.
import { SvelteSet } from "svelte/reactivity";

/** Ledger-relative paths of the folders currently open. */
const openFolders = new SvelteSet<string>();

/** Every ancestor folder of `path`, outermost first: "a/b/c" → ["a", "a/b"]. */
function ancestorsOf(path: string): string[] {
  const parts = path.split("/");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

export const treeExpansion = {
  isExpanded(path: string): boolean {
    return openFolders.has(path);
  },

  set(path: string, open: boolean) {
    if (open) openFolders.add(path);
    else openFolders.delete(path);
  },

  /**
   * Open `folderPath` and everything containing it, so whatever sits inside is
   * on screen. `""` is the ledger root, which is always visible and has nothing
   * to open.
   *
   * This is what a creator calls: put something in a folder and the folder shows
   * it, the way it does when you make a file in any file manager. It reveals the
   * *containing* folder rather than the new thing's own path, so it reads the
   * same whether the new thing is a note, a folder, or an imported PDF — and it
   * does not depend on the name the backend settled on after deduping.
   */
  reveal(folderPath: string) {
    if (!folderPath) return;
    for (const a of ancestorsOf(folderPath)) openFolders.add(a);
    openFolders.add(folderPath);
  },

  /** Closing a ledger forgets its tree; another one's paths mean nothing here. */
  clear() {
    openFolders.clear();
  },
};
