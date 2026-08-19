import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FileNode, Note } from "../lib/types/ledger";

vi.mock("$lib/toast", () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastUndo: vi.fn(),
}));

vi.mock("$lib/log", () => ({ logError: vi.fn() }));

const renameNote = vi.fn();
const moveFolder = vi.fn();
const moveMap = vi.fn();
const movePdf = vi.fn();

vi.mock("$lib/api", () => ({
  api: {
    get renameNote() {
      return renameNote;
    },
    get moveFolder() {
      return moveFolder;
    },
    get moveMap() {
      return moveMap;
    },
    get movePdf() {
      return movePdf;
    },
  },
}));

const notesLoad = vi.fn();
const mapsLoad = vi.fn();
const updatePdfTab = vi.fn();

vi.mock("$lib/stores/notes.svelte", () => ({
  notes: { load: () => notesLoad() },
}));
vi.mock("$lib/stores/maps.svelte", () => ({
  maps: { load: () => mapsLoad() },
}));
vi.mock("$lib/stores/tabs.svelte", () => ({
  tabs: { updatePdfTab: (...a: unknown[]) => updatePdfTab(...a) },
}));

import { toastError, toastSuccess } from "$lib/toast";
import {
  canDrop,
  dragItemFor,
  dropIntoFolder,
  kindOf,
  parentFolderOf,
  planMove,
  treeDrag,
  type TreeDragItem,
} from "../lib/stores/tree-move.svelte";

function node(over: Partial<FileNode>): FileNode {
  return {
    name: "x",
    path: "x",
    is_dir: false,
    note_id: null,
    map_id: null,
    children: [],
    ...over,
  };
}

function item(over: Partial<TreeDragItem> = {}): TreeDragItem {
  return {
    kind: "note",
    path: "Characters/Aldric.md",
    name: "Aldric",
    noteId: 1,
    mapId: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  renameNote.mockResolvedValue({ note: {}, updated_count: 0 });
  moveFolder.mockResolvedValue(0);
  moveMap.mockResolvedValue({});
  movePdf.mockResolvedValue("");
});

describe("kindOf", () => {
  it("tells the four row kinds apart", () => {
    expect(kindOf(node({ is_dir: true, path: "Characters" }))).toBe("folder");
    expect(kindOf(node({ map_id: 7, path: "World.jpg" }))).toBe("map");
    expect(kindOf(node({ path: "rulebooks/DMG.pdf" }))).toBe("pdf");
    expect(kindOf(node({ note_id: 1, path: "Aldric.md" }))).toBe("note");
  });

  it("reads a PDF's extension case-insensitively, as the tree builder does", () => {
    expect(kindOf(node({ path: "Manual.PDF" }))).toBe("pdf");
  });

  it("calls a map a map even though its file is an image", () => {
    // The map row *is* the image file, so extension alone would misread it.
    expect(kindOf(node({ map_id: 3, path: "maps/Coast.png" }))).toBe("map");
  });
});

describe("parentFolderOf", () => {
  it("returns the empty string at the ledger root", () => {
    expect(parentFolderOf("Aldric.md")).toBe("");
    expect(parentFolderOf("Characters/Aldric.md")).toBe("Characters");
    expect(parentFolderOf("A/B/C/note.md")).toBe("A/B/C");
  });
});

describe("planMove", () => {
  it("lands a note in the destination folder, keeping its filename", () => {
    const plan = planMove(item(), "People");
    expect(plan).toEqual({
      ok: true,
      item: item(),
      destFolder: "People",
      destPath: "People/Aldric.md",
    });
  });

  it("composes a root destination without a leading slash", () => {
    const plan = planMove(item(), "");
    expect(plan.ok && plan.destPath).toBe("Aldric.md");
  });

  it("refuses a drop onto the folder the node already sits in", () => {
    expect(planMove(item(), "Characters")).toEqual({
      ok: false,
      reason: "same-parent",
    });
  });

  it("refuses a root-level node dropped back on the root", () => {
    expect(planMove(item({ path: "Aldric.md" }), "")).toEqual({
      ok: false,
      reason: "same-parent",
    });
  });

  it("refuses a folder dropped onto itself", () => {
    const folder = item({ kind: "folder", path: "Characters", noteId: null });
    expect(planMove(folder, "Characters")).toEqual({
      ok: false,
      reason: "into-self",
    });
  });

  it("refuses a folder dropped into its own descendant", () => {
    const folder = item({ kind: "folder", path: "Characters", noteId: null });
    expect(planMove(folder, "Characters/Nobles")).toEqual({
      ok: false,
      reason: "into-self",
    });
    expect(planMove(folder, "Characters/Nobles/Houses")).toEqual({
      ok: false,
      reason: "into-self",
    });
  });

  it("does not mistake a sibling with a shared prefix for a descendant", () => {
    // "Characters Old" starts with "Characters" but is not inside it.
    const folder = item({ kind: "folder", path: "Characters", noteId: null });
    const plan = planMove(folder, "Characters Old");
    expect(plan.ok).toBe(true);
    expect(plan.ok && plan.destPath).toBe("Characters Old/Characters");
  });

  it("lets a folder move up to the ledger root", () => {
    const folder = item({
      kind: "folder",
      path: "Characters/Nobles",
      noteId: null,
    });
    const plan = planMove(folder, "");
    expect(plan.ok && plan.destPath).toBe("Nobles");
  });

  it("keeps a PDF's full filename, extension and all", () => {
    const pdf = item({ kind: "pdf", path: "Vol.2 Errata.pdf", noteId: null });
    const plan = planMove(pdf, "rulebooks");
    expect(plan.ok && plan.destPath).toBe("rulebooks/Vol.2 Errata.pdf");
  });
});

describe("canDrop", () => {
  it("is false with nothing in flight", () => {
    expect(canDrop(null, "People")).toBe(false);
  });

  it("agrees with planMove", () => {
    expect(canDrop(item(), "People")).toBe(true);
    expect(canDrop(item(), "Characters")).toBe(false);
  });
});

describe("dragItemFor", () => {
  it("carries the ids the move verbs need", () => {
    const map = dragItemFor(node({ map_id: 7, path: "World.jpg", name: "The World" }));
    expect(map).toEqual({
      kind: "map",
      path: "World.jpg",
      name: "The World",
      noteId: null,
      mapId: 7,
    });
  });
});

describe("dropIntoFolder", () => {
  const noteRow: Note = {
    id: 1,
    path: "Characters/Aldric.md",
    title: "Aldric",
    icon: null,
    cover_image: null,
    parent_path: "Characters",
    archived: false,
    modified_at: "",
  };
  const noteMap = new Map<number, Note>([[1, noteRow]]);

  it("moves a note by re-pathing its row, parent_path included", async () => {
    const moved = await dropIntoFolder(item(), "People", noteMap);

    expect(moved).toBe(true);
    expect(renameNote).toHaveBeenCalledWith(
      { ...noteRow, path: "People/Aldric.md", parent_path: "People" },
      true,
    );
  });

  it("nulls parent_path for a note moved to the ledger root", async () => {
    await dropIntoFolder(item(), "", noteMap);
    expect(renameNote).toHaveBeenCalledWith(
      expect.objectContaining({ path: "Aldric.md", parent_path: null }),
      true,
    );
  });

  it("rewrites wikilinks without asking, and says how many notes changed", async () => {
    renameNote.mockResolvedValue({ note: {}, updated_count: 3 });

    await dropIntoFolder(item(), "People", noteMap);

    expect(renameNote).toHaveBeenCalledWith(expect.anything(), true);
    expect(toastSuccess).toHaveBeenCalledWith("3 notes updated");
  });

  it("says nothing when a move broke no links", async () => {
    await dropIntoFolder(item(), "People", noteMap);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("moves a folder with one verb", async () => {
    moveFolder.mockResolvedValue(1);
    const folder = item({ kind: "folder", path: "Characters", noteId: null });

    expect(await dropIntoFolder(folder, "World", noteMap)).toBe(true);
    expect(moveFolder).toHaveBeenCalledWith("Characters", "World");
    expect(toastSuccess).toHaveBeenCalledWith("1 note updated");
  });

  it("moves a map and reloads the maps store", async () => {
    const map = item({
      kind: "map",
      path: "World.jpg",
      noteId: null,
      mapId: 7,
    });

    expect(await dropIntoFolder(map, "territories", noteMap)).toBe(true);
    expect(moveMap).toHaveBeenCalledWith(7, "territories");
    expect(mapsLoad).toHaveBeenCalled();
  });

  it("re-keys an open PDF tab to where the file landed", async () => {
    movePdf.mockResolvedValue("rulebooks/DMG.pdf");
    const pdf = item({
      kind: "pdf",
      path: "DMG.pdf",
      name: "DMG",
      noteId: null,
    });

    expect(await dropIntoFolder(pdf, "rulebooks", noteMap)).toBe(true);
    expect(movePdf).toHaveBeenCalledWith("DMG.pdf", "rulebooks");
    expect(updatePdfTab).toHaveBeenCalledWith("DMG.pdf", "DMG", "rulebooks/DMG.pdf");
  });

  it("does nothing, and says nothing, for a drop onto the current parent", async () => {
    expect(await dropIntoFolder(item(), "Characters", noteMap)).toBe(false);
    expect(renameNote).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("tells the GM when a folder cannot go inside itself", async () => {
    const folder = item({ kind: "folder", path: "Characters", noteId: null });

    expect(await dropIntoFolder(folder, "Characters/Nobles", noteMap)).toBe(false);
    expect(moveFolder).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("inside itself"));
  });

  it("reports no change when the command fails, and does not toast twice", async () => {
    // The api seam already showed the GM a message (ADR-0010).
    renameNote.mockRejectedValue(new Error("ERR_NAME_TAKEN: taken"));

    expect(await dropIntoFolder(item(), "People", noteMap)).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("refuses to guess when a note's row is missing rather than moving the wrong thing", async () => {
    expect(await dropIntoFolder(item(), "People", new Map())).toBe(false);
    expect(renameNote).not.toHaveBeenCalled();
  });
});

describe("treeDrag", () => {
  it("holds the dragged item for the length of the drag", () => {
    expect(treeDrag.item).toBeNull();
    treeDrag.start(item());
    expect(treeDrag.item).toEqual(item());
    treeDrag.end();
    expect(treeDrag.item).toBeNull();
  });
});
