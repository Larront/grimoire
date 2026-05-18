import { render, fireEvent, cleanup, act } from "@testing-library/svelte";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import AppSearch from "$lib/components/AppSearch.svelte";
import { tabs } from "$lib/stores/tabs.svelte";
import { notes } from "$lib/stores/notes.svelte";
import { searchPalette } from "$lib/stores/search.svelte";

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

async function openTagPicker() {
  await openPalette();
  const item = document.body.querySelector('[data-testid="cmd-add-tag"]') as HTMLElement;
  await fireEvent.click(item);
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
    await openTagPicker();
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
    await openTagPicker();
    const chips = document.body.querySelectorAll('[data-slot="tag-chip"]');
    expect(chips.length).toBe(2);
  });

  it("attaching a tag calls write_note_tags with the note path and new tags", async () => {
    await setupNote();
    render(AppSearch);
    await openTagPicker();
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
    await openTagPicker();
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
    await openTagPicker();
    const input = document.body.querySelector(
      '[data-testid="add-tag-picker"] [data-slot="tag-chip-input"]',
    ) as HTMLInputElement;
    input.value = "new-tag";
    await fireEvent.input(input);
    await fireEvent.keyDown(input, { key: "Enter" });
    await flush();
    expect(invoke).not.toHaveBeenCalledWith("open_right_rail", expect.anything());
  });
});

// ── Notes search ─────────────────────────────────────────────────────────────

function getSearchInput(): HTMLInputElement {
  return document.body.querySelector(
    'input[placeholder="Type a command or search..."]',
  ) as HTMLInputElement;
}

async function typeQuery(query: string) {
  const input = getSearchInput();
  input.value = query;
  await fireEvent.input(input);
  await flush();
}

describe("command palette – Notes search", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    searchPalette.open = false;
    vi.useRealTimers();
  });

  it("does not call search_notes when fewer than 2 chars are typed", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    render(AppSearch);
    await openPalette();
    await typeQuery("a");
    await vi.advanceTimersByTimeAsync(80);
    await flush();
    expect(invoke).not.toHaveBeenCalledWith("search_notes", expect.anything());
  });

  it("calls search_notes with the query after 80ms debounce", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_notes") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("Dr");
    expect(invoke).not.toHaveBeenCalledWith("search_notes", expect.anything());
    await vi.advanceTimersByTimeAsync(80);
    await flush();
    expect(invoke).toHaveBeenCalledWith("search_notes", { query: "Dr" });
  });

  it("shows Notes group with results after query fires", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_notes")
        return Promise.resolve([
          { id: 2, title: "Dragon", path: "dragon.md" },
        ]);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("Dr");
    await vi.advanceTimersByTimeAsync(80);
    await flush();
    expect(
      document.body.querySelector('[data-testid="cmd-note-result"]'),
    ).toBeTruthy();
  });

  it("no Notes group when query returns empty results", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_notes") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("zzz");
    await vi.advanceTimersByTimeAsync(80);
    await flush();
    expect(
      document.body.querySelector('[data-testid="cmd-note-result"]'),
    ).toBeNull();
  });

  it("clicking a Note result calls tabs.openTab with the matching note", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_notes")
        return Promise.resolve([
          { id: 3, title: "Aldric", path: "characters/aldric.md" },
        ]);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("Al");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    const result = document.body.querySelector(
      '[data-testid="cmd-note-result"]',
    ) as HTMLElement;
    await fireEvent.click(result);
    await flush();

    expect(tabs.activeTab?.type).toBe("note");
    expect(tabs.activeTab?.id).toBe(3);
  });

  it("if the note is already open, selecting it focuses the existing tab (no duplicate)", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_notes")
        return Promise.resolve([
          { id: 1, title: "My Note", path: "notes/my-note.md" },
        ]);
      return Promise.resolve(null);
    });
    tabs.openTab({ type: "note", id: 1, title: "My Note" });

    render(AppSearch);
    await openPalette();
    await typeQuery("My");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    const result = document.body.querySelector(
      '[data-testid="cmd-note-result"]',
    ) as HTMLElement;
    await fireEvent.click(result);
    await flush();

    const noteTabs = tabs.left.tabs.filter(
      (t) => t.type === "note" && t.id === 1,
    );
    expect(noteTabs.length).toBe(1);
  });

  it("palette closes after selecting a note result", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_notes")
        return Promise.resolve([
          { id: 3, title: "Aldric", path: "characters/aldric.md" },
        ]);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("Al");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    const result = document.body.querySelector(
      '[data-testid="cmd-note-result"]',
    ) as HTMLElement;
    await fireEvent.click(result);
    await flush();

    expect(searchPalette.open).toBe(false);
  });

  it("search results are cleared when palette closes", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_notes")
        return Promise.resolve([
          { id: 2, title: "Dragon", path: "dragon.md" },
        ]);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("Dr");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    expect(
      document.body.querySelector('[data-testid="cmd-note-result"]'),
    ).toBeTruthy();

    // Close and reopen — no stale results
    searchPalette.open = false;
    await flush();
    searchPalette.open = true;
    await flush();

    expect(
      document.body.querySelector('[data-testid="cmd-note-result"]'),
    ).toBeNull();
  });
});

// ── Body excerpt + match chip (issue #33) ─────────────────────────────────────

describe("command palette – excerpt and match chip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    searchPalette.open = false;
    searchPalette.activeQuery = "";
    vi.useRealTimers();
  });

  it("shows excerpt below title when result has a body match", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_notes")
        return Promise.resolve([
          {
            id: 2,
            title: "Harbor Tale",
            path: "harbor.md",
            excerpt: "the harbor is beautiful at dusk",
            match_count: 1,
          },
        ]);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("ha");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    expect(
      document.body.querySelector('[data-testid="note-excerpt"]'),
    ).toBeTruthy();
  });

  it("does not show excerpt when excerpt is null (title-only match)", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_notes")
        return Promise.resolve([
          {
            id: 2,
            title: "Harbor Tale",
            path: "harbor.md",
            excerpt: null,
            match_count: 0,
          },
        ]);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("ha");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    expect(
      document.body.querySelector('[data-testid="note-excerpt"]'),
    ).toBeNull();
  });

  it("shows N matches chip when match_count > 1", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_notes")
        return Promise.resolve([
          {
            id: 2,
            title: "Harbor Tale",
            path: "harbor.md",
            excerpt: "harbor here and harbor there",
            match_count: 3,
          },
        ]);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("ha");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    const chip = document.body.querySelector('[data-testid="match-count-chip"]');
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toContain("3");
  });

  it("does not show chip when match_count is 1", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_notes")
        return Promise.resolve([
          {
            id: 2,
            title: "Harbor Tale",
            path: "harbor.md",
            excerpt: "the harbor is beautiful",
            match_count: 1,
          },
        ]);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("ha");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    expect(
      document.body.querySelector('[data-testid="match-count-chip"]'),
    ).toBeNull();
  });

  it("excerpt contains a highlighted span for the matched term", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_notes")
        return Promise.resolve([
          {
            id: 2,
            title: "Harbor Tale",
            path: "harbor.md",
            excerpt: "the harbor is beautiful",
            match_count: 1,
          },
        ]);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("harbor");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    const excerpt = document.body.querySelector('[data-testid="note-excerpt"]');
    expect(excerpt).toBeTruthy();
    // The matched word should be inside a styled span
    const matchSpan = excerpt?.querySelector("span.text-primary");
    expect(matchSpan).toBeTruthy();
    expect(matchSpan?.textContent).toBe("harbor");
  });

  it("sets searchPalette.activeQuery when opening a note result", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_notes")
        return Promise.resolve([
          {
            id: 4,
            title: "The Harbor",
            path: "harbor.md",
            excerpt: "the harbor shines",
            match_count: 1,
          },
        ]);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("harbor");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    const result = document.body.querySelector(
      '[data-testid="cmd-note-result"]',
    ) as HTMLElement;
    await fireEvent.click(result);
    await flush();

    expect(searchPalette.activeQuery).toBe("harbor");
  });
});
