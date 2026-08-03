// Which folders the Files tree shows open (#164) — the rule being that making
// something inside a folder shows it, and that a tree rebuilt underneath the GM
// comes back the way they left it.
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { FileNode, Note } from "../lib/types/ledger";

vi.mock("$lib/toast", () => ({
  toastUndo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

import { treeExpansion } from "$lib/stores/tree-expansion.svelte";
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

const folderNode: FileNode = {
  path: "World",
  name: "World",
  is_dir: true,
  note_id: null,
  map_id: null,
  children: [
    {
      path: "World/Aldric.md",
      name: "Aldric",
      is_dir: false,
      note_id: 42,
      map_id: null,
      children: [],
    },
  ],
};

afterEach(() => {
  cleanup();
  treeExpansion.clear();
  vi.clearAllMocks();
});

describe("treeExpansion", () => {
  it("reveals a nested folder by opening it and everything above it", () => {
    treeExpansion.reveal("World/Cities/Vault");

    expect(treeExpansion.isExpanded("World")).toBe(true);
    expect(treeExpansion.isExpanded("World/Cities")).toBe(true);
    expect(treeExpansion.isExpanded("World/Cities/Vault")).toBe(true);
  });

  it("leaves unrelated folders alone", () => {
    treeExpansion.reveal("World/Cities");

    expect(treeExpansion.isExpanded("Characters")).toBe(false);
    expect(treeExpansion.isExpanded("World/Cities/Vault")).toBe(false);
  });

  it("has nothing to open at the ledger root", () => {
    treeExpansion.reveal("");

    expect(treeExpansion.isExpanded("")).toBe(false);
  });

  it("forgets everything when a ledger closes — another one's paths mean nothing", () => {
    treeExpansion.reveal("World/Cities");
    treeExpansion.clear();

    expect(treeExpansion.isExpanded("World")).toBe(false);
  });
});

describe("a folder row", () => {
  it("renders open when its path was revealed before the tree was built", () => {
    treeExpansion.reveal("World");

    const { container } = render(FileTree, { props: props(folderNode) });

    expect(container.querySelector("button")!.getAttribute("data-state")).toBe(
      "open",
    );
  });

  it("stays open across a rebuild — a refresh must not close what the GM opened", async () => {
    const first = render(FileTree, { props: props(folderNode) });
    await fireEvent.click(first.container.querySelector("button")!);
    expect(
      first.container.querySelector("button")!.getAttribute("data-state"),
    ).toBe("open");

    // What a refresh does: the old rows go, new ones are built from disk.
    cleanup();
    const rebuilt = render(FileTree, { props: props(folderNode) });

    expect(
      rebuilt.container.querySelector("button")!.getAttribute("data-state"),
    ).toBe("open");
  });

  it("closes on click, and stays closed", async () => {
    treeExpansion.reveal("World");
    const { container } = render(FileTree, { props: props(folderNode) });

    await fireEvent.click(container.querySelector("button")!);

    expect(container.querySelector("button")!.getAttribute("data-state")).toBe(
      "closed",
    );
    expect(treeExpansion.isExpanded("World")).toBe(false);
  });
});
