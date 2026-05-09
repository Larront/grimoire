import { render, fireEvent, waitFor, cleanup } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { FileNode, Note } from "../lib/types/vault";

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
    container.querySelector('[data-slot="context-menu-trigger"]') ??
    container.firstElementChild!;
  await fireEvent.contextMenu(trigger);
}

async function clickMenuItem(label: RegExp | string) {
  return waitFor(() => {
    const items = Array.from(
      document.body.querySelectorAll('[data-slot="context-menu-item"]'),
    );
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

    const deleteItem = await clickMenuItem("Delete Note");
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

    const deleteItem = await clickMenuItem("Delete Map");
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

    const deleteItem = await clickMenuItem("Delete Folder");
    await fireEvent.click(deleteItem);

    expect(toastUndo).toHaveBeenCalledWith(
      expect.stringContaining("My Folder"),
      expect.any(Function),
    );
  });
});
