// A [[Tree Move]] — dragging a row in the Files tree onto a folder to re-parent
// it (#163). Reorganising means changing *where* something lives, never its
// order: the tree is built by walking disk and sorted alphabetically, so there is
// no order to persist and disk stays the whole story.
//
// This module owns the two halves the tree itself should not have to know:
// **planning** (is this drop legal, and where would the thing land?) — pure, and
// the same answer whether it is asked during a dragover for highlighting or at
// drop time to act — and **committing** (which of the four backend verbs a node
// kind needs, and what has to be reloaded or re-keyed afterwards).
import { api } from "$lib/api";
import type { FileNode, Note } from "$lib/types/ledger";
import { notes } from "$lib/stores/notes.svelte";
import { maps } from "$lib/stores/maps.svelte";
import { tabs } from "$lib/stores/tabs.svelte";
import { toastSuccess, toastError } from "$lib/toast";
import { logError } from "$lib/log";

/// The drag payload's MIME type. A type of our own is what lets a folder row tell
/// an internal reorganise from an external PDF file drop (#102), which arrives as
/// "Files" and must keep importing rather than moving.
export const TREE_DRAG_MIME = "application/x-grimoire-tree-node";

/** The four kinds of row the Files tree shows, each with its own move verb. */
export type TreeNodeKind = "note" | "folder" | "map" | "pdf";

export interface TreeDragItem {
  kind: TreeNodeKind;
  /** Ledger-relative path of the dragged node. */
  path: string;
  /** What the tree shows for it — a note/PDF stem, a folder name, a map title. */
  name: string;
  noteId: number | null;
  mapId: number | null;
}

/**
 * Why a drop was refused. `same-parent` is not a failure — it is a drop onto the
 * folder the node already sits in, which asks for nothing — so it is refused
 * silently rather than reported. `into-self` is a genuine impossibility (a folder
 * cannot contain itself) and is worth saying out loud.
 */
export type MoveRefusal = "same-parent" | "into-self";

export type MovePlan =
  | { ok: true; item: TreeDragItem; destFolder: string; destPath: string }
  | { ok: false; reason: MoveRefusal };

/** The folder holding `path`; `""` for something sitting at the ledger root. */
export function parentFolderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** The last segment of `path` — the file or folder's own name, extension included. */
function nameOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

function joinInFolder(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

/** Which move verb a tree row needs. PDFs are detected by extension: they are
 *  path-addressed and carry no id (ADR-0011). */
export function kindOf(node: FileNode): TreeNodeKind {
  if (node.is_dir) return "folder";
  if (node.map_id !== null) return "map";
  if (node.path.toLowerCase().endsWith(".pdf")) return "pdf";
  return "note";
}

export function dragItemFor(node: FileNode): TreeDragItem {
  return {
    kind: kindOf(node),
    path: node.path,
    name: node.name,
    noteId: node.note_id,
    mapId: node.map_id,
  };
}

/**
 * Where `item` would land if dropped on `destFolder` (`""` = the ledger root),
 * or why it cannot be. Pure, so a dragover can ask it to decide whether to show
 * a drop affordance and get exactly the answer the drop will act on.
 *
 * The backend refuses all of this too — it has to, since a ledger is also edited
 * by other tools — but asking here first is what keeps an illegal drop from
 * looking droppable.
 */
export function planMove(item: TreeDragItem, destFolder: string): MovePlan {
  // Checked before same-parent: a folder dropped on *itself* is into-self, while
  // a folder dropped on the folder that holds it is merely nothing.
  if (
    item.kind === "folder" &&
    (destFolder === item.path || destFolder.startsWith(`${item.path}/`))
  ) {
    return { ok: false, reason: "into-self" };
  }
  if (parentFolderOf(item.path) === destFolder) {
    return { ok: false, reason: "same-parent" };
  }
  return {
    ok: true,
    item,
    destFolder,
    destPath: joinInFolder(destFolder, nameOf(item.path)),
  };
}

/** True when dropping `item` on `destFolder` would do something. */
export function canDrop(item: TreeDragItem | null, destFolder: string): boolean {
  return item !== null && planMove(item, destFolder).ok;
}

/**
 * Carry out a planned move. Each kind has its own verb, and each leaves something
 * different to put right afterwards:
 *
 * - **note** — `renameNote` with a new `path` *and* `parent_path`; it moves the
 *   file and rewrites the full-path wikilinks aiming at it. Rewriting is silent
 *   and unconditional here (unlike a title rename, which asks): a move leaves the
 *   note's name alone, so its bare-stem links still resolve and nobody moves a
 *   note *in order to* break the links pointing at it.
 * - **folder** — one backend verb re-keys every descendant note, map image, and
 *   PDF Scene-link under it.
 * - **map** — the image file moves and the row follows it.
 * - **pdf** — path-addressed (ADR-0011), so an open tab is keyed by the old path
 *   and has to be re-keyed or it points at a file that is no longer there.
 *
 * `note` is required for a note move — the backend takes the whole row, so the
 * caller supplies it from the tree's noteMap. The caller refreshes the tree
 * afterwards: a PDF move touches neither the notes nor the maps store, so no
 * store reload can stand in for it.
 */
export async function commitMove(
  plan: Extract<MovePlan, { ok: true }>,
  note?: Note | null,
): Promise<void> {
  const { item, destFolder, destPath } = plan;

  switch (item.kind) {
    case "note": {
      if (!note) throw new Error(`no note row for "${item.path}"`);
      const result = await api.renameNote(
        { ...note, path: destPath, parent_path: destFolder || null },
        true,
      );
      toastNotesUpdated(result.updated_count);
      await notes.load();
      break;
    }
    case "folder": {
      const updatedCount = await api.moveFolder(item.path, destFolder);
      toastNotesUpdated(updatedCount);
      await notes.load();
      break;
    }
    case "map": {
      if (item.mapId === null) throw new Error(`no map id for "${item.path}"`);
      await api.moveMap(item.mapId, destFolder);
      await maps.load();
      break;
    }
    case "pdf": {
      const newPath = await api.movePdf(item.path, destFolder);
      tabs.updatePdfTab(item.path, item.name, newPath);
      break;
    }
  }
}

/**
 * Plan a drop and carry it out — the whole response to one drop, so the tree and
 * the root zone share it rather than each assembling the same three steps.
 * Resolves to whether anything changed, which is what tells a caller to refresh.
 *
 * A refusal is reported only when it is one: `into-self` is a mistake worth a
 * word, `same-parent` is the GM putting something back where it was and deserves
 * silence. A failed command has already shown its own message at the api seam
 * (ADR-0010), so it is swallowed here rather than reported twice.
 */
export async function dropIntoFolder(
  item: TreeDragItem,
  destFolder: string,
  noteMap?: Map<number, Note>,
): Promise<boolean> {
  const plan = planMove(item, destFolder);
  if (!plan.ok) {
    if (plan.reason === "into-self") {
      toastError(`"${item.name}" can't be moved inside itself.`);
    }
    return false;
  }

  const note = item.noteId === null ? null : noteMap?.get(item.noteId) ?? null;
  try {
    await commitMove(plan, note);
    return true;
  } catch (e) {
    logError("[tree-move] move failed:", e);
    return false;
  }
}

function toastNotesUpdated(count: number) {
  if (count > 0) {
    toastSuccess(`${count} ${count === 1 ? "note" : "notes"} updated`);
  }
}

// ── The drag in flight ───────────────────────────────────────────────────────
// What is being dragged, held for the length of one drag. This exists because
// `dataTransfer.getData` returns "" during dragover (browsers withhold the
// payload until drop, so a page cannot read what is passing over it), and a
// folder row has to know *what* is overhead to decide whether it is a legal drop
// target — a folder cannot accept its own parent. The payload is still written to
// the DataTransfer as well, so the drop reads it from the event rather than
// trusting state to have survived.
let dragged = $state<TreeDragItem | null>(null);

export const treeDrag = {
  get item() {
    return dragged;
  },
  start(item: TreeDragItem) {
    dragged = item;
  },
  end() {
    dragged = null;
  },
};

/** Read a drag payload back off a drop event; `null` if it isn't one of ours. */
export function readDragItem(e: DragEvent): TreeDragItem | null {
  const raw = e.dataTransfer?.getData(TREE_DRAG_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TreeDragItem;
  } catch {
    return null;
  }
}

/** True when this drag is an internal tree reorganise rather than an OS file drop. */
export function isTreeDrag(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes(TREE_DRAG_MIME) ?? false;
}
