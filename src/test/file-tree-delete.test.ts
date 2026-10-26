import { render, fireEvent, waitFor, cleanup } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { FileNode, Note } from "../lib/types/ledger";

vi.mock("$lib/toast", () => ({
  toastUndo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

import { toastUndo } from "$lib/toast";
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

describe("FileTree delete — note", () => {
  it("triggers undo toast instead of opening AlertDialog", async () => {
    const { container } = render(FileTree, {
      props: { node: noteNode, ...defaultProps },
    });
    await openContextMenu(container);

    const deleteItem = await clickMenuItem("Delete “Test Note”");
    await fireEvent.click(deleteItem);

    expect(toastUndo).toHaveBeenCalledWith(
      expect.stringContaining("Test Note"),
      expect.any(Function),
    );
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
  });
});

describe("FileTree delete — map", () => {
  it("triggers undo toast for map deletion", async () => {
    const { container } = render(FileTree, {
      props: { node: mapNode, ...defaultProps },
    });
    await openContextMenu(container);

    const deleteItem = await clickMenuItem("Delete “Test Map”");
    await fireEvent.click(deleteItem);

    expect(toastUndo).toHaveBeenCalledWith(
      expect.stringContaining("Test Map"),
      expect.any(Function),
    );
  });
});

describe("FileTree delete — folder", () => {
  it("triggers undo toast for folder deletion", async () => {
    const { container } = render(FileTree, {
      props: { node: folderNode, ...defaultProps },
    });
    await openContextMenu(container);

    const deleteItem = await clickMenuItem("Delete “My Folder”");
    await fireEvent.click(deleteItem);

    expect(toastUndo).toHaveBeenCalledWith(
      expect.stringContaining("My Folder"),
      expect.any(Function),
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
    expect(toastUndo).toHaveBeenCalledWith(expect.stringContaining("Test Note"), expect.any(Function));
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
});
