import { render, fireEvent, cleanup, act } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import AppSearch from "$lib/components/AppSearch.svelte";
import { tabs } from "$lib/stores/tabs.svelte";
import { notes } from "$lib/stores/notes.svelte";

const testNote = {
  id: 1,
  path: "notes/my-note.md",
  title: "My Note",
  icon: null,
  cover_image: null,
  parent_path: null,
  archived: false,
  modified_at: "2026-01-01T00:00:00Z",
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function openPalette() {
  await fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  await flush();
}

async function setupNote() {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "get_notes") return Promise.resolve([testNote]);
    if (cmd === "read_note_tags") return Promise.resolve([]);
    if (cmd === "list_all_tags") return Promise.resolve([]);
    if (cmd === "write_note_tags") return Promise.resolve(null);
    return Promise.resolve(null);
  });
  await notes.load();
  tabs.openTab({ type: "note", id: 1, title: "My Note" });
}

afterEach(async () => {
  cleanup();
  tabs.closeAll("left");
  tabs.closeAll("right");
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "get_notes") return Promise.resolve([]);
    return Promise.resolve(null);
  });
  await notes.load();
  vi.mocked(invoke).mockResolvedValue(null);
});

// ── Visibility ────────────────────────────────────────────────────────────────

describe("command palette – Add tag visibility", () => {
  it("'Add tag' item appears in palette when active tab is a note", async () => {
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
    render(AppSearch);
    await openPalette();
    expect(
      document.body.querySelector('[data-testid="cmd-add-tag"]'),
    ).toBeTruthy();
  });

  it("'Add tag' item is absent when active tab is a map", async () => {
    tabs.openTab({ type: "map", id: 1, title: "World Map" });
    render(AppSearch);
    await openPalette();
    expect(
      document.body.querySelector('[data-testid="cmd-add-tag"]'),
    ).toBeNull();
  });

  it("'Add tag' item is absent when active tab is a scene", async () => {
    tabs.openTab({ type: "scene", id: 1, title: "Scene 1" });
    render(AppSearch);
    await openPalette();
    expect(
      document.body.querySelector('[data-testid="cmd-add-tag"]'),
    ).toBeNull();
  });

  it("'Add tag' item is absent when no tabs are open", async () => {
    render(AppSearch);
    await openPalette();
    expect(
      document.body.querySelector('[data-testid="cmd-add-tag"]'),
    ).toBeNull();
  });
});

// ── Tag picker flow ───────────────────────────────────────────────────────────

describe("command palette – Add tag flow", () => {
  it("selecting 'Add tag' opens the tag picker dialog", async () => {
    await setupNote();
    render(AppSearch);
    await openPalette();
    const item = document.body.querySelector(
      '[data-testid="cmd-add-tag"]',
    ) as HTMLElement;
    await fireEvent.click(item);
    await flush();
    expect(
      document.body.querySelector('[data-testid="add-tag-picker"]'),
    ).toBeTruthy();
  });

  it("tag picker loads the note's existing tags", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_notes") return Promise.resolve([testNote]);
      if (cmd === "read_note_tags") return Promise.resolve(["npc", "allied"]);
      if (cmd === "list_all_tags") return Promise.resolve(["npc", "allied"]);
      return Promise.resolve(null);
    });
    await notes.load();
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
    render(AppSearch);
    await openPalette();
    const item = document.body.querySelector(
      '[data-testid="cmd-add-tag"]',
    ) as HTMLElement;
    await fireEvent.click(item);
    await flush();
    const chips = document.body.querySelectorAll('[data-slot="tag-chip"]');
    expect(chips.length).toBe(2);
  });

  it("attaching a tag calls write_note_tags with the note path and new tags", async () => {
    await setupNote();
    render(AppSearch);
    await openPalette();
    const item = document.body.querySelector(
      '[data-testid="cmd-add-tag"]',
    ) as HTMLElement;
    await fireEvent.click(item);
    await flush();
    const input = document.body.querySelector(
      '[data-testid="add-tag-picker"] [data-slot="tag-chip-input"]',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = "new-tag";
    await fireEvent.input(input);
    await fireEvent.keyDown(input, { key: "Enter" });
    await flush();
    expect(invoke).toHaveBeenCalledWith("write_note_tags", {
      notePath: "notes/my-note.md",
      tags: ["new-tag"],
    });
  });

  it("tag picker closes after attaching a tag", async () => {
    await setupNote();
    render(AppSearch);
    await openPalette();
    const item = document.body.querySelector(
      '[data-testid="cmd-add-tag"]',
    ) as HTMLElement;
    await fireEvent.click(item);
    await flush();
    const input = document.body.querySelector(
      '[data-testid="add-tag-picker"] [data-slot="tag-chip-input"]',
    ) as HTMLInputElement;
    input.value = "new-tag";
    await fireEvent.input(input);
    await fireEvent.keyDown(input, { key: "Enter" });
    await flush();
    expect(
      document.body.querySelector('[data-testid="add-tag-picker"]'),
    ).toBeNull();
  });

  it("right rail open state is not changed when a tag is added via the palette", async () => {
    await setupNote();
    render(AppSearch);
    await openPalette();
    const item = document.body.querySelector(
      '[data-testid="cmd-add-tag"]',
    ) as HTMLElement;
    await fireEvent.click(item);
    await flush();
    const input = document.body.querySelector(
      '[data-testid="add-tag-picker"] [data-slot="tag-chip-input"]',
    ) as HTMLInputElement;
    input.value = "new-tag";
    await fireEvent.input(input);
    await fireEvent.keyDown(input, { key: "Enter" });
    await flush();
    // Verify the right-rail trigger invocation was NOT called
    expect(invoke).not.toHaveBeenCalledWith("open_right_rail", expect.anything());
  });
});
