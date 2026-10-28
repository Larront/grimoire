import { render, fireEvent, waitFor, cleanup } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { FileNode, Note } from "../lib/types/ledger";

vi.mock("$lib/toast", () => ({
  toastUndo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

import { toastUndo, toastSuccess } from "$lib/toast";
import { invoke } from "@tauri-apps/api/core";
import FileTree from "../lib/components/sidebar/FileTree.svelte";

const noteNode: FileNode = {
  path: "Test Note.md",
  name: "Test Note",
  is_dir: false,
  note_id: 42,
  map_id: null,
  children: [],
};

const mapNode: FileNode = {
  path: "Test Map",
  name: "Test Map",
  is_dir: false,
  note_id: null,
  map_id: 7,
  children: [],
};

const folderNode: FileNode = {
  path: "My Folder",
  name: "My Folder",
  is_dir: true,
  note_id: null,
  map_id: null,
  children: [],
};

const noteMap = new Map<number, Note>([
  [
    42,
    {
      id: 42,
      path: "Test Note.md",
      title: "Test Note",
      icon: null,
      cover_image: null,
      parent_path: null,
      archived: false,
      modified_at: "",
    },
  ],
]);

const defaultProps = {
  noteMap,
  refresh: vi.fn().mockResolvedValue(undefined),
  handleNewNote: vi.fn().mockResolvedValue(undefined),
  handleNewFolder: vi.fn().mockResolvedValue(undefined),
  handleNewMap: vi.fn().mockResolvedValue(undefined),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openContextMenu(container: HTMLElement) {
  const trigger =
    container.querySelector('[data-slot="context-menu-trigger"]') ?? container.firstElementChild!;
  await fireEvent.contextMenu(trigger);
}

async function clickMenuItem(label: RegExp | string) {
  return waitFor(() => {
    const items = Array.from(document.body.querySelectorAll('[data-slot="context-menu-item"]'));
    const item = items.find((el) => {
      const text = el.textContent ?? "";
      return label instanceof RegExp ? label.test(text) : text.includes(label);
    }) as HTMLElement | undefined;
    if (!item) throw new Error(`Menu item "${label}" not found`);
    return item;
  });
}

// A note, folder or PDF goes to the Recycle Bin at once (jsdom's platform is
// neither Windows nor a Mac, so it says "Trash"). A map keeps an Undo toast:
// its pins live in the database, which no bin gives back.

describe("FileTree delete — note", () => {
  it("sends it to the bin at once and says where it went, with no Undo or dialog", async () => {
    const { container } = render(FileTree, {
      props: { node: noteNode, ...defaultProps },
    });
    await openContextMenu(container);
    await fireEvent.click(await clickMenuItem("Delete “Test Note”"));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("delete_note", { noteId: 42 }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("“Test Note” is in the Trash"));
    expect(toastUndo).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("claims nothing when the bin refuses it", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "delete_note") throw "ERR_RECYCLE: couldn't move it";
      return null;
    });
    const { getByRole } = render(FileTree, { props: { node: noteNode, ...defaultProps } });
    await fireEvent.keyDown(getByRole("button", { name: /^Test Note$/ }), { key: "Delete" });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("delete_note", { noteId: 42 }));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(getByRole("button", { name: /^Test Note$/ })).toBeTruthy();
    vi.mocked(invoke).mockResolvedValue(null);
  });
});

describe("FileTree delete — map", () => {
  it("takes the row away at once behind an Undo toast", async () => {
    const { container, queryByRole } = render(FileTree, {
      props: { node: mapNode, ...defaultProps },
    });
    await openContextMenu(container);
    await fireEvent.click(await clickMenuItem("Delete “Test Map”"));

    expect(toastUndo).toHaveBeenCalledWith(
      "Deleted “Test Map”",
      expect.any(Function),
      expect.any(Function),
    );
    await waitFor(() => expect(queryByRole("button", { name: /^Test Map$/ })).toBeNull());
    expect(invoke).not.toHaveBeenCalledWith("delete_map", expect.anything());

    // Undo puts it back.
    vi.mocked(toastUndo).mock.calls[0][2]!();
    await waitFor(() => expect(queryByRole("button", { name: /^Test Map$/ })).toBeTruthy());
  });
});

describe("FileTree delete — folder", () => {
  it("sends the folder to the bin at once", async () => {
    const { container } = render(FileTree, {
      props: { node: folderNode, ...defaultProps },
    });
    await openContextMenu(container);
    await fireEvent.click(await clickMenuItem("Delete “My Folder”"));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("delete_folder", { folderPath: "My Folder" }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("“My Folder” is in the Trash"));
    expect(toastUndo).not.toHaveBeenCalled();
  });

  it("says what went with it (2026-10 design review)", async () => {
    const leaf = (name: string, extra: Partial<FileNode>): FileNode => ({
      path: `My Folder/${name}`,
      name,
      is_dir: false,
      note_id: null,
      map_id: null,
      children: [],
      ...extra,
    });
    const full: FileNode = {
      ...folderNode,
      children: [
        leaf("A.md", { note_id: 1 }),
        leaf("B.md", { note_id: 2 }),
        leaf("Vale", { map_id: 3 }),
        {
          ...leaf("Deeper", { is_dir: true }),
          children: [leaf("Deeper/C.md", { note_id: 4 }), leaf("Deeper/Rules.pdf", {})],
        },
      ],
    };
    const { container } = render(FileTree, { props: { node: full, ...defaultProps } });
    await openContextMenu(container);
    await fireEvent.click(await clickMenuItem("Delete “My Folder”"));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "“My Folder” and the 3 notes, 1 map and 1 PDF in it are in the Trash",
      ),
    );
  });
});

// ── The row's menu (2026-10 design review) ──────────────────────────────────

function menuLabels() {
  return Array.from(document.body.querySelectorAll('[data-slot="context-menu-item"]')).map((el) =>
    (el.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
}

describe("FileTree row menu", () => {
  it("offers a folder its new things, a template among them, then Rename, then Delete", async () => {
    const { container } = render(FileTree, { props: { node: folderNode, ...defaultProps } });
    await openContextMenu(container);
    await clickMenuItem("New note");
    expect(menuLabels()).toEqual([
      "New note",
      "New note from template…",
      "New folder",
      "New map…",
      "Import PDF…",
      "Rename F2",
      "Delete “My Folder” Del",
    ]);
  });

  it("opens the template picker for a note in that folder", async () => {
    const { shell } = await import("$lib/utils/shell-actions");
    const { searchPalette } = await import("$lib/stores/search.svelte");
    const { container } = render(FileTree, { props: { node: folderNode, ...defaultProps } });
    await openContextMenu(container);
    await fireEvent.click(await clickMenuItem("New note from template…"));
    expect(searchPalette.templateFolder).toBe("My Folder");
    expect(searchPalette.open).toBe(true);
    shell.openTemplatePickerIn(null);
    searchPalette.open = false;
  });

  it("deletes from the row with the Delete key, as its menu says", async () => {
    const { getByRole } = render(FileTree, { props: { node: noteNode, ...defaultProps } });
    await fireEvent.keyDown(getByRole("button", { name: /^Test Note$/ }), { key: "Delete" });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("delete_note", { noteId: 42 }));
  });

  it("starts naming a folder with F2", async () => {
    const { getByRole, container } = render(FileTree, { props: { node: folderNode, ...defaultProps } });
    await fireEvent.keyDown(getByRole("button", { name: /^My Folder$/ }), { key: "F2" });
    await waitFor(() => expect(container.querySelector("input")).toBeTruthy());
  });

  it("has a visible way into the same menu", () => {
    const { getByRole } = render(FileTree, { props: { node: noteNode, ...defaultProps } });
    expect(getByRole("button", { name: "More for Test Note" })).toBeTruthy();
  });

  it("puts the current row's ⋯ in the Tab order, after the row", () => {
    const { getByRole } = render(FileTree, {
      props: { node: noteNode, first: true, ...defaultProps },
    });
    expect(getByRole("button", { name: /^Test Note$/ }).tabIndex).toBe(0);
    expect(getByRole("button", { name: "More for Test Note" }).tabIndex).toBe(0);
  });
});

// ── Moving through the tree (2026-10 design review) ──────────────────────────

describe("FileTree keys", () => {
  const nested: FileNode = {
    ...folderNode,
    children: [
      { ...noteNode, path: "My Folder/Inside.md", name: "Inside", note_id: 43 },
    ],
  };

  it("is one Tab stop, held by the first row until another is focused", async () => {
    const { treeRename } = await import("$lib/stores/tree-rename.svelte");
    treeRename.tabStop = null;
    const { getByRole } = render(FileTree, { props: { node: noteNode, first: true, ...defaultProps } });
    expect(getByRole("button", { name: /^Test Note$/ })).toHaveAttribute("tabindex", "0");
    treeRename.tabStop = "Elsewhere.md";
    await waitFor(() =>
      expect(getByRole("button", { name: /^Test Note$/ })).toHaveAttribute("tabindex", "-1"),
    );
    treeRename.tabStop = null;
  });

  it("opens a folder with →, steps into it with → again, and back out with ←", async () => {
    const { treeExpansion } = await import("$lib/stores/tree-expansion.svelte");
    treeExpansion.set("My Folder", false);
    const { getByRole, findByRole } = render(FileTree, { props: { node: nested, ...defaultProps } });
    const folder = getByRole("button", { name: /^My Folder$/ });
    folder.focus();

    await fireEvent.keyDown(folder, { key: "ArrowRight" });
    const inside = await findByRole("button", { name: /^Inside$/ });
    await fireEvent.keyDown(folder, { key: "ArrowRight" });
    expect(document.activeElement).toBe(inside);

    await fireEvent.keyDown(inside, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(folder);
    await fireEvent.keyDown(folder, { key: "ArrowLeft" });
    expect(treeExpansion.isExpanded("My Folder")).toBe(false);
  });
});
