// The drag half of a [[Tree Move]] (#163) as the tree wires it: what a row hands
// to the DataTransfer, and which folder a drop lands in. The planning and
// committing rules are covered in tree-move.svelte.test.ts.
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { FileNode, Note } from "../lib/types/ledger";

vi.mock("$lib/toast", () => ({
  toastUndo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const dropIntoFolder = vi.fn().mockResolvedValue(true);

// The module's own behaviour is tested directly elsewhere; here the double is
// what lets the test assert *which folder* the tree aimed a drop at.
vi.mock("$lib/stores/tree-move.svelte", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/stores/tree-move.svelte")>();
  return { ...actual, dropIntoFolder: (...a: unknown[]) => dropIntoFolder(...a) };
});

import { TREE_DRAG_MIME, treeDrag } from "$lib/stores/tree-move.svelte";
import FileTree from "../lib/components/sidebar/FileTree.svelte";

const noteMap = new Map<number, Note>();

function props(node: FileNode) {
  return {
    node,
    noteMap,
    refresh: vi.fn().mockResolvedValue(undefined),
    handleNewNote: vi.fn().mockResolvedValue(undefined),
    handleNewFolder: vi.fn().mockResolvedValue(undefined),
    handleNewMap: vi.fn().mockResolvedValue(undefined),
  };
}

/** jsdom implements no DataTransfer, so drags carry a stand-in. */
function fakeDataTransfer(payload?: unknown) {
  const store = new Map<string, string>();
  if (payload !== undefined) {
    store.set(TREE_DRAG_MIME, JSON.stringify(payload));
  }
  return {
    types: [...store.keys()],
    effectAllowed: "none",
    dropEffect: "none",
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? "",
    files: [] as unknown as FileList,
    setDragImage: () => {},
  };
}

const noteNode: FileNode = {
  path: "Characters/Aldric.md",
  name: "Aldric",
  is_dir: false,
  note_id: 42,
  map_id: null,
  children: [],
};

const folderNode: FileNode = {
  path: "World",
  name: "World",
  is_dir: true,
  note_id: null,
  map_id: null,
  children: [noteNode],
};

afterEach(() => {
  cleanup();
  treeDrag.end();
  vi.clearAllMocks();
  dropIntoFolder.mockResolvedValue(true);
});

describe("dragging a row", () => {
  it("makes a note row draggable and hands over its identity", async () => {
    const { container } = render(FileTree, { props: props(noteNode) });
    const row = container.querySelector("button")!;
    expect(row.draggable).toBe(true);

    const dataTransfer = fakeDataTransfer();
    await fireEvent.dragStart(row, { dataTransfer });

    expect(JSON.parse(dataTransfer.getData(TREE_DRAG_MIME))).toEqual({
      kind: "note",
      path: "Characters/Aldric.md",
      name: "Aldric",
      noteId: 42,
      mapId: null,
    });
    expect(dataTransfer.effectAllowed).toBe("move");
    expect(treeDrag.item?.path).toBe("Characters/Aldric.md");
  });

  it("makes a folder row draggable too", async () => {
    const { container } = render(FileTree, { props: props(folderNode) });
    const row = container.querySelector("button")!;
    expect(row.draggable).toBe(true);

    await fireEvent.dragStart(row, { dataTransfer: fakeDataTransfer() });
    expect(treeDrag.item).toEqual(
      expect.objectContaining({ kind: "folder", path: "World" }),
    );
  });

  it("clears the drag once it ends, so no later dragover reads a stale item", async () => {
    const { container } = render(FileTree, { props: props(noteNode) });
    const row = container.querySelector("button")!;

    await fireEvent.dragStart(row, { dataTransfer: fakeDataTransfer() });
    await fireEvent.dragEnd(row);

    expect(treeDrag.item).toBeNull();
  });
});

describe("dropping onto a folder", () => {
  // The folder's whole region is the target — its row plus everything nested
  // under it: `li[menu-item] > div[collapsible] > div`.
  function dropRegionOf(container: HTMLElement): HTMLElement {
    const region = container.querySelector<HTMLElement>(
      "[data-sidebar='menu-item'] > [data-collapsible-root] > div",
    );
    if (!region) throw new Error("folder drop region not found");
    return region;
  }

  it("moves the dragged node into that folder", async () => {
    const p = props(folderNode);
    const { container } = render(FileTree, { props: p });

    const item = {
      kind: "note",
      path: "Aldric.md",
      name: "Aldric",
      noteId: 42,
      mapId: null,
    };
    treeDrag.start(item as never);
    const dataTransfer = fakeDataTransfer(item);
    const region = dropRegionOf(container);

    await fireEvent.dragOver(region, { dataTransfer });
    await fireEvent.drop(region, { dataTransfer });

    await waitFor(() =>
      expect(dropIntoFolder).toHaveBeenCalledWith(item, "World", noteMap),
    );
    await waitFor(() => expect(p.refresh).toHaveBeenCalled());
  });

  it("shows the row as a target while a legal drop is overhead", async () => {
    const { container } = render(FileTree, { props: props(folderNode) });
    const item = { kind: "note", path: "Aldric.md", name: "A", noteId: 1, mapId: null };
    treeDrag.start(item as never);
    const region = dropRegionOf(container);

    await fireEvent.dragOver(region, { dataTransfer: fakeDataTransfer(item) });

    expect(container.querySelector("button")?.className).toContain("ring-primary");
  });

  it("does not offer itself as a target to a folder that contains it", async () => {
    const { container } = render(FileTree, { props: props(folderNode) });
    // The folder itself, dragged onto itself.
    const item = { kind: "folder", path: "World", name: "World", noteId: null, mapId: null };
    treeDrag.start(item as never);
    const region = dropRegionOf(container);

    await fireEvent.dragOver(region, { dataTransfer: fakeDataTransfer(item) });

    expect(container.querySelector("button")?.className ?? "").not.toContain(
      "ring-primary",
    );
  });

  it("leaves the tree alone when the move reports nothing changed", async () => {
    dropIntoFolder.mockResolvedValue(false);
    const p = props(folderNode);
    const { container } = render(FileTree, { props: p });

    const item = { kind: "note", path: "Aldric.md", name: "A", noteId: 1, mapId: null };
    treeDrag.start(item as never);
    const dataTransfer = fakeDataTransfer(item);
    const region = dropRegionOf(container);

    await fireEvent.dragOver(region, { dataTransfer });
    await fireEvent.drop(region, { dataTransfer });

    await waitFor(() => expect(dropIntoFolder).toHaveBeenCalled());
    expect(p.refresh).not.toHaveBeenCalled();
  });

  it("still opens on click — the drop region wraps the trigger, it does not replace it", async () => {
    const { container } = render(FileTree, { props: props(folderNode) });
    const row = container.querySelector("button")!;
    expect(row.getAttribute("data-state")).toBe("closed");

    await fireEvent.click(row);

    expect(row.getAttribute("data-state")).toBe("open");
  });

  it("opens a closed folder that a drag rests on, so its contents can be aimed at", async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(FileTree, { props: props(folderNode) });
      const row = container.querySelector("button")!;
      const item = { kind: "note", path: "A.md", name: "A", noteId: 1, mapId: null };
      treeDrag.start(item as never);

      await fireEvent.dragOver(dropRegionOf(container), {
        dataTransfer: fakeDataTransfer(item),
      });
      expect(row.getAttribute("data-state")).toBe("closed");

      await vi.advanceTimersByTimeAsync(700);

      expect(row.getAttribute("data-state")).toBe("open");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not tear open a folder a drag merely passes across", async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(FileTree, { props: props(folderNode) });
      const row = container.querySelector("button")!;
      const item = { kind: "note", path: "A.md", name: "A", noteId: 1, mapId: null };
      treeDrag.start(item as never);
      const region = dropRegionOf(container);

      await fireEvent.dragOver(region, { dataTransfer: fakeDataTransfer(item) });
      await vi.advanceTimersByTimeAsync(200);
      await fireEvent.dragLeave(region, { relatedTarget: document.body });
      await vi.advanceTimersByTimeAsync(700);

      expect(row.getAttribute("data-state")).toBe("closed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores an OS file drag as a move — that is still a PDF import", async () => {
    const { container } = render(FileTree, { props: props(folderNode) });
    const region = dropRegionOf(container);
    const filesDrag = { ...fakeDataTransfer(), types: ["Files"] };

    await fireEvent.dragOver(region, { dataTransfer: filesDrag });
    await fireEvent.drop(region, { dataTransfer: filesDrag });

    expect(dropIntoFolder).not.toHaveBeenCalled();
  });
});
