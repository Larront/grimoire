import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import type { FileNode } from "../lib/types/vault";

const mockSetOpenMobile = vi.hoisted(() => vi.fn());

vi.mock("$lib/components/ui/sidebar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/components/ui/sidebar")>();
  return {
    ...actual,
    useSidebar: () => ({ setOpenMobile: mockSetOpenMobile }),
  };
});

vi.mock("$lib/stores/tabs.svelte", () => ({
  tabs: {
    get activeTab() { return null; },
    openTab: vi.fn(),
    navigateOpen: vi.fn(),
    closeTabByTypeAndId: vi.fn(),
    openTabWithRename: vi.fn(),
  },
}));

vi.mock("$lib/toast", () => ({
  toastUndo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

import FileTree from "../lib/components/sidebar/FileTree.svelte";

beforeAll(() => {
  Element.prototype.animate = vi.fn().mockReturnValue({
    finished: Promise.resolve(),
    cancel: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    onfinish: null,
  });
});

const noteNode: FileNode = {
  path: "Note.md",
  name: "Note",
  is_dir: false,
  note_id: 1,
  map_id: null,
  children: [],
};

const mapNode: FileNode = {
  path: "Map",
  name: "Map",
  is_dir: false,
  note_id: null,
  map_id: 2,
  children: [],
};

const folderNode: FileNode = {
  path: "Folder",
  name: "Folder",
  is_dir: true,
  note_id: null,
  map_id: null,
  children: [],
};

const defaultProps = {
  noteMap: new Map(),
  refresh: vi.fn().mockResolvedValue(undefined),
  handleNewNote: vi.fn().mockResolvedValue(undefined),
  handleNewFolder: vi.fn().mockResolvedValue(undefined),
  handleNewMap: vi.fn().mockResolvedValue(undefined),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FileTree mobile — note row", () => {
  it("calls setOpenMobile(false) when clicking a note row", async () => {
    const { container } = render(FileTree, { props: { node: noteNode, ...defaultProps } });
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    await fireEvent.click(button!);
    expect(mockSetOpenMobile).toHaveBeenCalledWith(false);
  });
});

describe("FileTree mobile — map row", () => {
  it("calls setOpenMobile(false) when clicking a map row", async () => {
    const { container } = render(FileTree, { props: { node: mapNode, ...defaultProps } });
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    await fireEvent.click(button!);
    expect(mockSetOpenMobile).toHaveBeenCalledWith(false);
  });
});

describe("FileTree mobile — folder row", () => {
  it("does not call setOpenMobile when clicking a folder row", async () => {
    const { container } = render(FileTree, { props: { node: folderNode, ...defaultProps } });
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    await fireEvent.click(button!);
    expect(mockSetOpenMobile).not.toHaveBeenCalled();
  });
});
