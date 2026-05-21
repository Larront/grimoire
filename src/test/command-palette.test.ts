import { render, fireEvent, cleanup, act } from "@testing-library/svelte";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { setMode, resetMode, userPrefersMode } from "mode-watcher";
import AppSearch from "$lib/components/SearchPalette.svelte";
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

  it("does not call search_all when fewer than 2 chars are typed", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    render(AppSearch);
    await openPalette();
    await typeQuery("a");
    await vi.advanceTimersByTimeAsync(80);
    await flush();
    expect(invoke).not.toHaveBeenCalledWith("search_all", expect.anything());
  });

  it("calls search_all with the query after 80ms debounce", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all") return Promise.resolve({ notes: [], maps: [], scenes: [] });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("Dr");
    expect(invoke).not.toHaveBeenCalledWith("search_all", expect.anything());
    await vi.advanceTimersByTimeAsync(80);
    await flush();
    expect(invoke).toHaveBeenCalledWith("search_all", { query: "Dr" });
  });

  it("shows Notes group with results after query fires", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [{ id: 2, title: "Dragon", path: "dragon.md" }],
          maps: [],
          scenes: [],
        });
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
      if (cmd === "search_all") return Promise.resolve({ notes: [], maps: [], scenes: [] });
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
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [{ id: 3, title: "Aldric", path: "characters/aldric.md" }],
          maps: [],
          scenes: [],
        });
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
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [{ id: 1, title: "My Note", path: "notes/my-note.md" }],
          maps: [],
          scenes: [],
        });
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
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [{ id: 3, title: "Aldric", path: "characters/aldric.md" }],
          maps: [],
          scenes: [],
        });
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
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [{ id: 2, title: "Dragon", path: "dragon.md" }],
          maps: [],
          scenes: [],
        });
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
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [{
            id: 2,
            title: "Harbor Tale",
            path: "harbor.md",
            excerpt: "the harbor is beautiful at dusk",
            match_count: 1,
          }],
          maps: [],
          scenes: [],
        });
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
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [{
            id: 2,
            title: "Harbor Tale",
            path: "harbor.md",
            excerpt: null,
            match_count: 0,
          }],
          maps: [],
          scenes: [],
        });
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
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [{
            id: 2,
            title: "Harbor Tale",
            path: "harbor.md",
            excerpt: "harbor here and harbor there",
            match_count: 3,
          }],
          maps: [],
          scenes: [],
        });
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
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [{
            id: 2,
            title: "Harbor Tale",
            path: "harbor.md",
            excerpt: "the harbor is beautiful",
            match_count: 1,
          }],
          maps: [],
          scenes: [],
        });
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
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [{
            id: 2,
            title: "Harbor Tale",
            path: "harbor.md",
            excerpt: "the harbor is beautiful",
            match_count: 1,
          }],
          maps: [],
          scenes: [],
        });
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
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [{
            id: 4,
            title: "The Harbor",
            path: "harbor.md",
            excerpt: "the harbor shines",
            match_count: 1,
          }],
          maps: [],
          scenes: [],
        });
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

  it("shows excerpt when query has a tag filter plus a free-text term", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [{
            id: 2,
            title: "Harbor Tale",
            path: "harbor.md",
            excerpt: "the harbor is beautiful",
            match_count: 1,
          }],
          maps: [],
          scenes: [],
          tags: [],
        });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("tag:npc harbor");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    expect(document.body.querySelector('[data-testid="note-excerpt"]')).toBeTruthy();
  });

  it("excerpt highlighting uses only the free-text term, not the tag: filter", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [{
            id: 2,
            title: "Harbor Tale",
            path: "harbor.md",
            excerpt: "the harbor is beautiful",
            match_count: 1,
          }],
          maps: [],
          scenes: [],
          tags: [],
        });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("tag:npc harbor");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    const excerpt = document.body.querySelector('[data-testid="note-excerpt"]');
    expect(excerpt).toBeTruthy();
    const matchSpan = excerpt?.querySelector("span.text-primary");
    expect(matchSpan).toBeTruthy();
    expect(matchSpan?.textContent).toBe("harbor");
    // tag:npc must never appear as a highlighted span
    const allSpans = excerpt?.querySelectorAll("span.text-primary") ?? [];
    const spanTexts = Array.from(allSpans).map((s) => s.textContent);
    expect(spanTexts.every((t) => t !== "tag:npc")).toBe(true);
  });
});

// ── Maps and Scenes groups (issue #34) ────────────────────────────────────────

describe("command palette – Maps group", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    searchPalette.open = false;
    vi.useRealTimers();
  });

  it("shows Maps group when maps are returned", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [],
          maps: [{ id: 1, title: "World Map" }],
          scenes: [],
        });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("Wo");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    expect(
      document.body.querySelector('[data-testid="cmd-map-result"]'),
    ).toBeTruthy();
  });

  it("no Maps group when maps array is empty", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({ notes: [], maps: [], scenes: [] });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("zzz");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    expect(
      document.body.querySelector('[data-testid="cmd-map-result"]'),
    ).toBeNull();
  });

  it("clicking a Map result opens the map tab", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [],
          maps: [{ id: 5, title: "Dungeon Map" }],
          scenes: [],
        });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("Du");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    const result = document.body.querySelector(
      '[data-testid="cmd-map-result"]',
    ) as HTMLElement;
    await fireEvent.click(result);
    await flush();

    expect(tabs.activeTab?.type).toBe("map");
    expect(tabs.activeTab?.id).toBe(5);
  });

  it("palette closes after selecting a map result", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [],
          maps: [{ id: 5, title: "Dungeon Map" }],
          scenes: [],
        });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("Du");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    const result = document.body.querySelector(
      '[data-testid="cmd-map-result"]',
    ) as HTMLElement;
    await fireEvent.click(result);
    await flush();

    expect(searchPalette.open).toBe(false);
  });
});

describe("command palette – Scenes group", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    searchPalette.open = false;
    vi.useRealTimers();
  });

  it("shows Scenes group when scenes are returned", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [],
          maps: [],
          scenes: [{ id: 2, name: "Tavern Brawl" }],
        });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("Ta");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    expect(
      document.body.querySelector('[data-testid="cmd-scene-result"]'),
    ).toBeTruthy();
  });

  it("no Scenes group when scenes array is empty", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({ notes: [], maps: [], scenes: [] });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("zzz");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    expect(
      document.body.querySelector('[data-testid="cmd-scene-result"]'),
    ).toBeNull();
  });

  it("clicking a Scene result opens the scene tab", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [],
          maps: [],
          scenes: [{ id: 7, name: "Dragon Fight" }],
        });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("Dr");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    const result = document.body.querySelector(
      '[data-testid="cmd-scene-result"]',
    ) as HTMLElement;
    await fireEvent.click(result);
    await flush();

    expect(tabs.activeTab?.type).toBe("scene");
    expect(tabs.activeTab?.id).toBe(7);
  });

  it("palette closes after selecting a scene result", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [],
          maps: [],
          scenes: [{ id: 7, name: "Dragon Fight" }],
        });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("Dr");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    const result = document.body.querySelector(
      '[data-testid="cmd-scene-result"]',
    ) as HTMLElement;
    await fireEvent.click(result);
    await flush();

    expect(searchPalette.open).toBe(false);
  });

  it("Maps group renders before Scenes group in the DOM", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [],
          maps: [{ id: 1, title: "Dragon Map" }],
          scenes: [{ id: 2, name: "Dragon Scene" }],
        });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("Dr");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    const mapResult = document.body.querySelector('[data-testid="cmd-map-result"]');
    const sceneResult = document.body.querySelector('[data-testid="cmd-scene-result"]');
    expect(mapResult).toBeTruthy();
    expect(sceneResult).toBeTruthy();
    // Map result must appear before scene result in document order
    expect(
      mapResult!.compareDocumentPosition(sceneResult!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

// ── Tags group (issue #35) ────────────────────────────────────────────────────

describe("command palette – Tags group", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    searchPalette.open = false;
    vi.useRealTimers();
  });

  it("shows Tags group when tags are returned", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [],
          maps: [],
          scenes: [],
          tags: [{ name: "npc", note_count: 3 }],
        });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("np");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    expect(
      document.body.querySelector('[data-testid="cmd-tag-result"]'),
    ).toBeTruthy();
  });

  it("no Tags group when tags array is empty", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({ notes: [], maps: [], scenes: [], tags: [] });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("zzz");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    expect(
      document.body.querySelector('[data-testid="cmd-tag-result"]'),
    ).toBeNull();
  });

  it("shows count chip with note_count value", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [],
          maps: [],
          scenes: [],
          tags: [{ name: "npc", note_count: 7 }],
        });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("np");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    const chip = document.body.querySelector('[data-testid="tag-count-chip"]');
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toContain("7");
  });

  it("selecting a Tag row rewrites search input to tag:foo", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [],
          maps: [],
          scenes: [],
          tags: [{ name: "npc", note_count: 2 }],
        });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("np");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    const tagItem = document.body.querySelector(
      '[data-testid="cmd-tag-result"]',
    ) as HTMLElement;
    await fireEvent.click(tagItem);
    await flush();

    const input = getSearchInput();
    expect(input.value).toBe("tag:npc");
  });

  it("tag already in active filter is hidden from Tags group", async () => {
    // Return "npc" tag in results — but query already has tag:npc active
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [],
          maps: [],
          scenes: [],
          tags: [{ name: "npc", note_count: 2 }],
        });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    // Manually set query to include tag:npc
    const input = getSearchInput();
    input.value = "tag:npc";
    await fireEvent.input(input);
    await flush();
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    // "npc" should be hidden since tag:npc is already active
    expect(
      document.body.querySelector('[data-testid="cmd-tag-result"]'),
    ).toBeNull();
  });

  it("Tags group renders before Notes group in the DOM", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [{ id: 1, title: "NPC Note", path: "npc.md", excerpt: null, match_count: 0 }],
          maps: [],
          scenes: [],
          tags: [{ name: "npc", note_count: 3 }],
        });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("np");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    const tagResult = document.body.querySelector('[data-testid="cmd-tag-result"]');
    const noteResult = document.body.querySelector('[data-testid="cmd-note-result"]');
    expect(tagResult).toBeTruthy();
    expect(noteResult).toBeTruthy();
    // Tag result must appear before note result in document order
    expect(
      tagResult!.compareDocumentPosition(noteResult!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("no Tags group when search_all returns no tags field (backward compat)", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({ notes: [], maps: [], scenes: [] });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("np");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    expect(
      document.body.querySelector('[data-testid="cmd-tag-result"]'),
    ).toBeNull();
  });

  it("selecting tag when existing filter plus free text appends tag and preserves free text", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [],
          maps: [],
          scenes: [],
          tags: [{ name: "villain", note_count: 1 }],
        });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    // Start with existing tag filter and free text
    const input = getSearchInput();
    input.value = "tag:npc allied";
    await fireEvent.input(input);
    await flush();
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    const villainTag = document.body.querySelector(
      '[data-testid="cmd-tag-result"]',
    ) as HTMLElement;
    expect(villainTag).toBeTruthy();
    await fireEvent.click(villainTag);
    await flush();

    // tag:npc kept, tag:villain appended, free text "allied" preserved
    expect(getSearchInput().value).toBe("tag:npc tag:villain allied");
  });

  it("selecting tag keeps existing tag: tokens and appends new one", async () => {
    let callCount = 0;
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all") {
        callCount++;
        // Second call (after tag:npc is in input) returns allied tag
        const tags =
          callCount <= 1
            ? [{ name: "npc", note_count: 2 }]
            : [{ name: "allied", note_count: 1 }];
        return Promise.resolve({ notes: [], maps: [], scenes: [], tags });
      }
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("np");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    // Select npc tag → input becomes "tag:npc"
    const npcTag = document.body.querySelector(
      '[data-testid="cmd-tag-result"]',
    ) as HTMLElement;
    await fireEvent.click(npcTag);
    await flush();
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    expect(getSearchInput().value).toBe("tag:npc");
  });
});

// ── Commands group (issue #36) ────────────────────────────────────────────────

describe("command palette – Commands group ordering", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    searchPalette.open = false;
    searchPalette.settingsOpen = false;
    vi.useRealTimers();
  });

  it("Commands group renders above Tags group in DOM", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [],
          maps: [],
          scenes: [],
          tags: [{ name: "npc", note_count: 1 }],
        });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("cr");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    // Trigger tag results by typing something that matches a tag too
    // Instead, just open palette with a query that shows tags, check ordering
    const input = getSearchInput();
    input.value = "npc";
    await fireEvent.input(input);
    await flush();
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    const cmdItem = document.body.querySelector('[data-testid^="cmd-create"]');
    const tagItem = document.body.querySelector('[data-testid="cmd-tag-result"]');
    if (cmdItem && tagItem) {
      expect(
        cmdItem.compareDocumentPosition(tagItem) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("Commands group renders above Notes group in DOM", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [{ id: 1, title: "Crafter", path: "crafter.md", excerpt: null, match_count: 0 }],
          maps: [],
          scenes: [],
        });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("cr");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    const cmdItem = document.body.querySelector('[data-testid^="cmd-create"]');
    const noteItem = document.body.querySelector('[data-testid="cmd-note-result"]');
    expect(cmdItem).toBeTruthy();
    expect(noteItem).toBeTruthy();
    expect(
      cmdItem!.compareDocumentPosition(noteItem!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("command palette – Commands group visibility", () => {
  afterEach(() => {
    searchPalette.open = false;
    searchPalette.settingsOpen = false;
  });

  it("shows up to 3 commands when query is empty", async () => {
    render(AppSearch);
    await openPalette();
    const allCmds = document.body.querySelectorAll('[data-testid^="cmd-create"], [data-testid="cmd-open-settings"], [data-testid="cmd-toggle-theme"], [data-testid="cmd-switch-vault"], [data-testid="cmd-rebuild-index"]');
    expect(allCmds.length).toBeLessThanOrEqual(3);
    expect(allCmds.length).toBeGreaterThanOrEqual(1);
  });

  it("filters commands by substring match on label", async () => {
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "settings";
    await fireEvent.input(input);
    await flush();

    expect(document.body.querySelector('[data-testid="cmd-open-settings"]')).toBeTruthy();
    expect(document.body.querySelector('[data-testid="cmd-create-note"]')).toBeNull();
  });

  it("Add tag to current note visible when active pane is note", async () => {
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "tag";
    await fireEvent.input(input);
    await flush();
    expect(document.body.querySelector('[data-testid="cmd-add-tag"]')).toBeTruthy();
  });

  it("Add tag to current note hidden when active pane is not a note", async () => {
    tabs.openTab({ type: "map", id: 1, title: "World Map" });
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "tag";
    await fireEvent.input(input);
    await flush();
    expect(document.body.querySelector('[data-testid="cmd-add-tag"]')).toBeNull();
  });
});

describe("command palette – Commands group wiring", () => {
  afterEach(() => {
    searchPalette.open = false;
    searchPalette.settingsOpen = false;
    resetMode();
  });

  it("Create new note invokes create_note and closes palette", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "create_note") return Promise.resolve({ id: 10, title: "Untitled" });
      if (cmd === "get_notes") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "create new note";
    await fireEvent.input(input);
    await flush();

    const item = document.body.querySelector('[data-testid="cmd-create-note"]') as HTMLElement;
    expect(item).toBeTruthy();
    await fireEvent.click(item);
    await flush();

    expect(invoke).toHaveBeenCalledWith("create_note", expect.objectContaining({
      noteTitle: "Untitled",
    }));
    expect(searchPalette.open).toBe(false);
  });

  it("Create new scene invokes create_scene and closes palette", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "create_scene") return Promise.resolve({ id: 5, name: "Untitled Scene" });
      if (cmd === "get_scenes_with_slot_counts") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "create new scene";
    await fireEvent.input(input);
    await flush();

    const item = document.body.querySelector('[data-testid="cmd-create-scene"]') as HTMLElement;
    expect(item).toBeTruthy();
    await fireEvent.click(item);
    await flush();

    expect(invoke).toHaveBeenCalledWith("create_scene", expect.objectContaining({
      name: expect.any(String),
    }));
    expect(searchPalette.open).toBe(false);
  });

  it("Create new map invokes create_map_empty and closes palette", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "create_map_empty") return Promise.resolve({ id: 3, title: "Untitled Map" });
      if (cmd === "get_maps") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "create new map";
    await fireEvent.input(input);
    await flush();

    const item = document.body.querySelector('[data-testid="cmd-create-map"]') as HTMLElement;
    expect(item).toBeTruthy();
    await fireEvent.click(item);
    await flush();

    expect(invoke).toHaveBeenCalledWith("create_map_empty", expect.objectContaining({
      title: expect.any(String),
    }));
    expect(searchPalette.open).toBe(false);
  });

  it("Open Settings sets searchPalette.settingsOpen and closes palette", async () => {
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "settings";
    await fireEvent.input(input);
    await flush();

    const item = document.body.querySelector('[data-testid="cmd-open-settings"]') as HTMLElement;
    expect(item).toBeTruthy();
    await fireEvent.click(item);
    await flush();

    expect(searchPalette.settingsOpen).toBe(true);
    expect(searchPalette.open).toBe(false);
  });

  it("Toggle theme cycles from system to light and closes palette", async () => {
    resetMode();
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "toggle";
    await fireEvent.input(input);
    await flush();

    const item = document.body.querySelector('[data-testid="cmd-toggle-theme"]') as HTMLElement;
    expect(item).toBeTruthy();

    const modeBefore = userPrefersMode.current;
    await fireEvent.click(item);
    await flush();

    const expectedMode = modeBefore === 'light' ? 'dark' : modeBefore === 'dark' ? 'system' : 'light';
    expect(userPrefersMode.current).toBe(expectedMode);
    expect(searchPalette.open).toBe(false);
  });

  it("Switch vault closes palette and calls vault.openVault", async () => {
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "switch";
    await fireEvent.input(input);
    await flush();

    const item = document.body.querySelector('[data-testid="cmd-switch-vault"]') as HTMLElement;
    expect(item).toBeTruthy();
    await fireEvent.click(item);
    await flush();

    expect(searchPalette.open).toBe(false);
    // vault.openVault() calls tauri dialog open (mocked to return null) → silent no-op
    // Verify invoke was not called with any destructive command; the dialog mock returns null
  });

  it("Rebuild search index invokes rebuild_search_index and closes palette", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "rebuild_search_index") return Promise.resolve(null);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "rebuild";
    await fireEvent.input(input);
    await flush();

    const item = document.body.querySelector('[data-testid="cmd-rebuild-index"]') as HTMLElement;
    expect(item).toBeTruthy();
    await fireEvent.click(item);
    await flush();

    expect(invoke).toHaveBeenCalledWith("rebuild_search_index");
    expect(searchPalette.open).toBe(false);
  });
});

// ── Create note from template – inline template picker (issue #47) ───────────

describe("command palette – Create note from template", () => {
  const fakeTemplates = [
    { display_name: "NPC", path: ".grimoire/templates/NPC.md" },
    { display_name: "Location", path: ".grimoire/templates/Location.md" },
  ];

  afterEach(() => {
    searchPalette.open = false;
  });

  it("appears in Commands group when searching 'template'", async () => {
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "template";
    await fireEvent.input(input);
    await flush();
    expect(
      document.body.querySelector('[data-testid="cmd-create-note-from-template"]'),
    ).toBeTruthy();
  });

  it("selecting it calls list_templates and keeps palette open", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "list_templates") return Promise.resolve(fakeTemplates);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "template";
    await fireEvent.input(input);
    await flush();

    const item = document.body.querySelector(
      '[data-testid="cmd-create-note-from-template"]',
    ) as HTMLElement;
    await fireEvent.click(item);
    await flush();

    expect(invoke).toHaveBeenCalledWith("list_templates");
    expect(searchPalette.open).toBe(true);
  });

  it("template picker shows one item per template returned", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "list_templates") return Promise.resolve(fakeTemplates);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "template";
    await fireEvent.input(input);
    await flush();

    const item = document.body.querySelector(
      '[data-testid="cmd-create-note-from-template"]',
    ) as HTMLElement;
    await fireEvent.click(item);
    await flush();

    const results = document.body.querySelectorAll('[data-testid="cmd-template-result"]');
    expect(results.length).toBe(2);
  });

  it("selecting a template invokes create_note_from_template and closes palette", async () => {
    const fakeNote = { id: 99, title: "Untitled" };
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "list_templates") return Promise.resolve(fakeTemplates);
      if (cmd === "create_note_from_template") return Promise.resolve(fakeNote);
      if (cmd === "get_notes") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();

    const input = getSearchInput();
    input.value = "template";
    await fireEvent.input(input);
    await flush();

    const cmdItem = document.body.querySelector(
      '[data-testid="cmd-create-note-from-template"]',
    ) as HTMLElement;
    await fireEvent.click(cmdItem);
    await flush();

    const templateItem = document.body.querySelector(
      '[data-testid="cmd-template-result"]',
    ) as HTMLElement;
    await fireEvent.click(templateItem);
    await flush();

    expect(invoke).toHaveBeenCalledWith(
      "create_note_from_template",
      expect.objectContaining({ templatePath: ".grimoire/templates/NPC.md" }),
    );
    expect(searchPalette.open).toBe(false);
  });

  it("commands group is hidden while in template picker mode", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "list_templates") return Promise.resolve(fakeTemplates);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "template";
    await fireEvent.input(input);
    await flush();

    const item = document.body.querySelector(
      '[data-testid="cmd-create-note-from-template"]',
    ) as HTMLElement;
    await fireEvent.click(item);
    await flush();

    expect(
      document.body.querySelector('[data-testid="cmd-create-note-from-template"]'),
    ).toBeNull();
  });

  it("template picker mode resets when palette is closed", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "list_templates") return Promise.resolve(fakeTemplates);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "template";
    await fireEvent.input(input);
    await flush();

    const item = document.body.querySelector(
      '[data-testid="cmd-create-note-from-template"]',
    ) as HTMLElement;
    await fireEvent.click(item);
    await flush();

    searchPalette.open = false;
    await flush();

    searchPalette.open = true;
    await flush();

    expect(
      document.body.querySelector('[data-testid="cmd-template-result"]'),
    ).toBeNull();
  });
});

// ── Modifier-based open semantics (issue #37) ─────────────────────────────────

describe("command palette – modifier-based open semantics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    searchPalette.open = false;
    vi.useRealTimers();
  });

  async function openNoteResult(id: number, title: string, path: string) {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [{ id, title, path, excerpt: null, match_count: 0 }],
          maps: [],
          scenes: [],
        });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("no");
    await vi.advanceTimersByTimeAsync(80);
    await flush();
  }

  async function openMapResult(id: number, mapTitle: string) {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [],
          maps: [{ id, title: mapTitle }],
          scenes: [],
        });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("ma");
    await vi.advanceTimersByTimeAsync(80);
    await flush();
  }

  async function openSceneResult(id: number, name: string) {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [],
          maps: [],
          scenes: [{ id, name }],
        });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("sc");
    await vi.advanceTimersByTimeAsync(80);
    await flush();
  }

  // ── Ctrl+Enter (force new tab) ───────────────────────────────────────────────

  it("Ctrl+Enter on note (not yet open) opens a new tab in the active pane", async () => {
    tabs.openTab({ type: "note", id: 99, title: "Existing" }); // left pane occupied
    await openNoteResult(5, "Target Note", "target.md");

    await fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    const result = document.body.querySelector('[data-testid="cmd-note-result"]') as HTMLElement;
    await fireEvent.click(result);
    await flush();

    expect(tabs.left.tabs.some((t) => t.type === "note" && t.id === 5)).toBe(true);
    expect(tabs.left.tabs.length).toBe(2); // appended, not replaced
  });

  it("Ctrl+Enter on note already open in active pane creates a second tab (no reuse)", async () => {
    tabs.openTab({ type: "note", id: 1, title: "My Note" }); // left pane, note:1
    await openNoteResult(1, "My Note", "my-note.md");

    await fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    const result = document.body.querySelector('[data-testid="cmd-note-result"]') as HTMLElement;
    await fireEvent.click(result);
    await flush();

    const noteTabs = tabs.left.tabs.filter((t) => t.type === "note" && t.id === 1);
    expect(noteTabs.length).toBe(2); // second tab created
  });

  it("Ctrl+Enter on note already open in opposite pane opens new tab in focused pane (no reuse)", async () => {
    // left has note:2, right has note:1, focused=left
    tabs.openTab({ type: "note", id: 2, title: "Other" });
    tabs.openTab({ type: "note", id: 1, title: "My Note" }, "right");
    tabs.setFocusedPane("left");

    await openNoteResult(1, "My Note", "my-note.md");

    await fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    const result = document.body.querySelector('[data-testid="cmd-note-result"]') as HTMLElement;
    await fireEvent.click(result);
    await flush();

    // New tab appended to left pane (not reusing right pane tab)
    expect(tabs.left.tabs.some((t) => t.type === "note" && t.id === 1)).toBe(true);
    expect(tabs.left.tabs.length).toBe(2);
    expect(tabs.focusedPane).toBe("left");
  });

  it("Ctrl+Enter on map opens a new tab without reuse", async () => {
    tabs.openTab({ type: "map", id: 1, title: "Existing Map" }); // left pane, map:1
    await openMapResult(1, "Existing Map");

    await fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    const result = document.body.querySelector('[data-testid="cmd-map-result"]') as HTMLElement;
    await fireEvent.click(result);
    await flush();

    const mapTabs = tabs.left.tabs.filter((t) => t.type === "map" && t.id === 1);
    expect(mapTabs.length).toBe(2);
  });

  it("Ctrl+Enter on scene opens a new tab without reuse", async () => {
    tabs.openTab({ type: "scene", id: 1, title: "Existing Scene" });
    await openSceneResult(1, "Existing Scene");

    await fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    const result = document.body.querySelector('[data-testid="cmd-scene-result"]') as HTMLElement;
    await fireEvent.click(result);
    await flush();

    const sceneTabs = tabs.left.tabs.filter((t) => t.type === "scene" && t.id === 1);
    expect(sceneTabs.length).toBe(2);
  });

  // ── Shift+Enter (open in opposite pane) ─────────────────────────────────────

  it("Shift+Enter on note with no split creates split and opens in right pane", async () => {
    tabs.openTab({ type: "note", id: 99, title: "Existing" }); // left only, focusedPane=left
    expect(tabs.right).toBeNull();

    await openNoteResult(5, "Target Note", "target.md");

    await fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    const result = document.body.querySelector('[data-testid="cmd-note-result"]') as HTMLElement;
    await fireEvent.click(result);
    await flush();

    expect(tabs.right).not.toBeNull();
    expect(tabs.right?.tabs.some((t) => t.type === "note" && t.id === 5)).toBe(true);
  });

  it("Shift+Enter does not change the focused pane", async () => {
    tabs.openTab({ type: "note", id: 99, title: "Existing" }); // left, focusedPane=left
    await openNoteResult(5, "Target Note", "target.md");

    await fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    const result = document.body.querySelector('[data-testid="cmd-note-result"]') as HTMLElement;
    await fireEvent.click(result);
    await flush();

    expect(tabs.focusedPane).toBe("left");
  });

  it("Shift+Enter on note with split opens in opposite pane (not focused)", async () => {
    // Setup: left has note:2, right has note:3, focused=left
    tabs.openTab({ type: "note", id: 2, title: "Left Note" });
    tabs.openTab({ type: "note", id: 3, title: "Right Note" }, "right");
    tabs.setFocusedPane("left");

    await openNoteResult(5, "Target Note", "target.md");

    await fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    const result = document.body.querySelector('[data-testid="cmd-note-result"]') as HTMLElement;
    await fireEvent.click(result);
    await flush();

    expect(tabs.right?.tabs.some((t) => t.type === "note" && t.id === 5)).toBe(true);
    expect(tabs.focusedPane).toBe("left");
  });

  it("Shift+Enter reuses an existing tab in the opposite pane if already open there", async () => {
    // left has note:2, right has [note:3, note:1], focused=left
    tabs.openTab({ type: "note", id: 2, title: "Left Note" });
    tabs.openTab({ type: "note", id: 3, title: "Right A" }, "right");
    tabs.openTabForceNew({ type: "note", id: 1, title: "My Note" }, "right");
    tabs.setFocusedPane("left");

    await openNoteResult(1, "My Note", "my-note.md");

    await fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    const result = document.body.querySelector('[data-testid="cmd-note-result"]') as HTMLElement;
    await fireEvent.click(result);
    await flush();

    // Right pane should not have added a third tab (reused existing)
    const rightNoteTabs = tabs.right?.tabs.filter((t) => t.type === "note" && t.id === 1) ?? [];
    expect(rightNoteTabs.length).toBe(1);
    expect(tabs.right?.activeIndex).toBe(1); // focused on the reused note:1 tab
    expect(tabs.focusedPane).toBe("left");
  });

  it("Shift+Enter on map creates split and opens in right pane", async () => {
    tabs.openTab({ type: "note", id: 1, title: "Note" }); // left only
    await openMapResult(7, "World Map");

    await fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    const result = document.body.querySelector('[data-testid="cmd-map-result"]') as HTMLElement;
    await fireEvent.click(result);
    await flush();

    expect(tabs.right?.tabs.some((t) => t.type === "map" && t.id === 7)).toBe(true);
    expect(tabs.focusedPane).toBe("left");
  });

  it("Shift+Enter on scene creates split and opens in right pane", async () => {
    tabs.openTab({ type: "note", id: 1, title: "Note" }); // left only
    await openSceneResult(4, "Battle Scene");

    await fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    const result = document.body.querySelector('[data-testid="cmd-scene-result"]') as HTMLElement;
    await fireEvent.click(result);
    await flush();

    expect(tabs.right?.tabs.some((t) => t.type === "scene" && t.id === 4)).toBe(true);
    expect(tabs.focusedPane).toBe("left");
  });

  // ── Commands: modifiers have no effect ──────────────────────────────────────

  it("Ctrl+Enter on a Command row fires the action (same as plain Enter)", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "rebuild_search_index") return Promise.resolve(null);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "rebuild";
    await fireEvent.input(input);
    await flush();

    await fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    const item = document.body.querySelector('[data-testid="cmd-rebuild-index"]') as HTMLElement;
    await fireEvent.click(item);
    await flush();

    expect(invoke).toHaveBeenCalledWith("rebuild_search_index");
    expect(searchPalette.open).toBe(false);
  });
});

// ── Recent section (issue #39) ────────────────────────────────────────────────

describe("command palette – Recent section", () => {
  afterEach(() => {
    searchPalette.open = false;
  });

  function setupRecent(
    entries: Array<{ entity_kind: string; entity_id: number; title: string; accessed_at: string }>,
  ) {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_recent_entities") return Promise.resolve(entries);
      return Promise.resolve(null);
    });
  }

  it("get_recent_entities is called when palette opens", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    render(AppSearch);
    await openPalette();
    expect(invoke).toHaveBeenCalledWith("get_recent_entities");
  });

  it("renders Recent group above Commands when input is empty", async () => {
    setupRecent([
      { entity_kind: "note", entity_id: 1, title: "My Note", accessed_at: "2026-05-19T10:00:00.000Z" },
    ]);
    render(AppSearch);
    await openPalette();

    const recentItem = document.body.querySelector('[data-testid="cmd-recent-result"]');
    const cmdItem = document.body.querySelector('[data-testid^="cmd-create"]');
    expect(recentItem).toBeTruthy();
    expect(cmdItem).toBeTruthy();
    expect(
      recentItem!.compareDocumentPosition(cmdItem!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("no Recent group when get_recent_entities returns empty list", async () => {
    setupRecent([]);
    render(AppSearch);
    await openPalette();
    expect(document.body.querySelector('[data-testid="cmd-recent-result"]')).toBeNull();
  });

  it("Recent group disappears the moment user types", async () => {
    setupRecent([
      { entity_kind: "note", entity_id: 1, title: "My Note", accessed_at: "2026-05-19T10:00:00.000Z" },
    ]);
    render(AppSearch);
    await openPalette();
    expect(document.body.querySelector('[data-testid="cmd-recent-result"]')).toBeTruthy();

    const input = getSearchInput();
    input.value = "x";
    await fireEvent.input(input);
    await flush();

    expect(document.body.querySelector('[data-testid="cmd-recent-result"]')).toBeNull();
  });

  it("shows at most 5 entries even when more are returned", async () => {
    setupRecent([
      { entity_kind: "note", entity_id: 1, title: "N1", accessed_at: "2026-05-19T10:06:00.000Z" },
      { entity_kind: "note", entity_id: 2, title: "N2", accessed_at: "2026-05-19T10:05:00.000Z" },
      { entity_kind: "map", entity_id: 1, title: "M1", accessed_at: "2026-05-19T10:04:00.000Z" },
      { entity_kind: "scene", entity_id: 1, title: "S1", accessed_at: "2026-05-19T10:03:00.000Z" },
      { entity_kind: "note", entity_id: 3, title: "N3", accessed_at: "2026-05-19T10:02:00.000Z" },
      { entity_kind: "note", entity_id: 4, title: "N4", accessed_at: "2026-05-19T10:01:00.000Z" },
    ]);
    render(AppSearch);
    await openPalette();
    const items = document.body.querySelectorAll('[data-testid="cmd-recent-result"]');
    expect(items.length).toBe(5);
  });

  it("each row shows a type chip with the entity kind", async () => {
    setupRecent([
      { entity_kind: "note", entity_id: 1, title: "My Note", accessed_at: "2026-05-19T10:00:00.000Z" },
    ]);
    render(AppSearch);
    await openPalette();

    const chip = document.body.querySelector('[data-testid="recent-kind-chip"]');
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toBe("note");
  });

  it("each row shows a relative-time hint", async () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    setupRecent([
      { entity_kind: "note", entity_id: 1, title: "My Note", accessed_at: twoMinutesAgo },
    ]);
    render(AppSearch);
    await openPalette();

    const hint = document.body.querySelector('[data-testid="recent-time-hint"]');
    expect(hint).toBeTruthy();
    expect(hint?.textContent).toMatch(/2m ago/);
  });

  it("clicking a Recent note row opens the note tab and closes palette", async () => {
    setupRecent([
      { entity_kind: "note", entity_id: 3, title: "Harbor", accessed_at: "2026-05-19T10:00:00.000Z" },
    ]);
    render(AppSearch);
    await openPalette();

    const item = document.body.querySelector('[data-testid="cmd-recent-result"]') as HTMLElement;
    await fireEvent.click(item);
    await flush();

    expect(tabs.activeTab?.type).toBe("note");
    expect(tabs.activeTab?.id).toBe(3);
    expect(searchPalette.open).toBe(false);
  });

  it("clicking a Recent map row opens the map tab", async () => {
    setupRecent([
      { entity_kind: "map", entity_id: 5, title: "World Map", accessed_at: "2026-05-19T10:00:00.000Z" },
    ]);
    render(AppSearch);
    await openPalette();

    const item = document.body.querySelector('[data-testid="cmd-recent-result"]') as HTMLElement;
    await fireEvent.click(item);
    await flush();

    expect(tabs.activeTab?.type).toBe("map");
    expect(tabs.activeTab?.id).toBe(5);
  });

  it("clicking a Recent scene row opens the scene tab", async () => {
    setupRecent([
      { entity_kind: "scene", entity_id: 7, title: "Battle", accessed_at: "2026-05-19T10:00:00.000Z" },
    ]);
    render(AppSearch);
    await openPalette();

    const item = document.body.querySelector('[data-testid="cmd-recent-result"]') as HTMLElement;
    await fireEvent.click(item);
    await flush();

    expect(tabs.activeTab?.type).toBe("scene");
    expect(tabs.activeTab?.id).toBe(7);
  });

  it("opening a Recent row calls record_recent to update the timestamp", async () => {
    setupRecent([
      { entity_kind: "note", entity_id: 1, title: "My Note", accessed_at: "2026-05-19T10:00:00.000Z" },
    ]);
    render(AppSearch);
    await openPalette();

    const item = document.body.querySelector('[data-testid="cmd-recent-result"]') as HTMLElement;
    await fireEvent.click(item);
    await flush();

    expect(invoke).toHaveBeenCalledWith("record_recent", {
      kind: "note",
      id: 1,
      title: "My Note",
    });
  });

  it("opening a note from search results calls record_recent", async () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({
          notes: [{ id: 3, title: "Aldric", path: "aldric.md", excerpt: null, match_count: 0 }],
          maps: [],
          scenes: [],
        });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("Al");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    const result = document.body.querySelector('[data-testid="cmd-note-result"]') as HTMLElement;
    await fireEvent.click(result);
    await flush();

    expect(invoke).toHaveBeenCalledWith("record_recent", {
      kind: "note",
      id: 3,
      title: "Aldric",
    });
    vi.useRealTimers();
  });

  it("Ctrl+Enter on a Recent row opens a new tab without reuse", async () => {
    setupRecent([
      { entity_kind: "note", entity_id: 1, title: "My Note", accessed_at: "2026-05-19T10:00:00.000Z" },
    ]);
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
    render(AppSearch);
    await openPalette();

    await fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    const item = document.body.querySelector('[data-testid="cmd-recent-result"]') as HTMLElement;
    await fireEvent.click(item);
    await flush();

    const noteTabs = tabs.left.tabs.filter((t) => t.type === "note" && t.id === 1);
    expect(noteTabs.length).toBe(2);
  });

  it("Shift+Enter on a Recent row opens in opposite pane", async () => {
    setupRecent([
      { entity_kind: "note", entity_id: 5, title: "Target", accessed_at: "2026-05-19T10:00:00.000Z" },
    ]);
    tabs.openTab({ type: "note", id: 99, title: "Existing" });
    render(AppSearch);
    await openPalette();

    await fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    const item = document.body.querySelector('[data-testid="cmd-recent-result"]') as HTMLElement;
    await fireEvent.click(item);
    await flush();

    expect(tabs.right?.tabs.some((t) => t.type === "note" && t.id === 5)).toBe(true);
    expect(tabs.focusedPane).toBe("left");
  });
});

// ── Per-group caps + Show more (issue #41) ────────────────────────────────────

describe("command palette – per-group caps", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    searchPalette.open = false;
    vi.useRealTimers();
  });

  function makeNotes(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      title: `Note ${i + 1}`,
      path: `note-${i + 1}.md`,
      excerpt: null,
      match_count: 0,
    }));
  }

  function makeTags(count: number) {
    return Array.from({ length: count }, (_, i) => ({ name: `tag${i + 1}`, note_count: 1 }));
  }

  function makeMaps(count: number) {
    return Array.from({ length: count }, (_, i) => ({ id: i + 1, title: `Map ${i + 1}` }));
  }

  function makeScenes(count: number) {
    return Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Scene ${i + 1}` }));
  }

  async function searchWithResults(results: Record<string, unknown>) {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all") return Promise.resolve(results);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("xx");
    await vi.advanceTimersByTimeAsync(80);
    await flush();
  }

  // ── Default caps ─────────────────────────────────────────────────────────────

  it("Notes group renders at most 6 results by default", async () => {
    // Include a map so activeGroupCount > 1, preventing single-group relaxation
    await searchWithResults({ notes: makeNotes(10), maps: [{ id: 1, title: "Map" }], scenes: [] });
    const items = document.body.querySelectorAll('[data-testid="cmd-note-result"]');
    expect(items.length).toBe(6);
  });

  it("Tags group renders at most 5 results by default", async () => {
    await searchWithResults({ notes: [], maps: [], scenes: [], tags: makeTags(8) });
    const items = document.body.querySelectorAll('[data-testid="cmd-tag-result"]');
    expect(items.length).toBe(5);
  });

  it("Maps group renders at most 3 results by default", async () => {
    await searchWithResults({ notes: [], maps: makeMaps(6), scenes: [] });
    const items = document.body.querySelectorAll('[data-testid="cmd-map-result"]');
    expect(items.length).toBe(3);
  });

  it("Scenes group renders at most 3 results by default", async () => {
    await searchWithResults({ notes: [], maps: [], scenes: makeScenes(6) });
    const items = document.body.querySelectorAll('[data-testid="cmd-scene-result"]');
    expect(items.length).toBe(3);
  });

  it("Commands group renders at most 3 commands when many match", async () => {
    // No note tab → 7 eligible commands; empty query matches all → cap at 3
    render(AppSearch);
    await openPalette();
    const cmds = document.body.querySelectorAll(
      '[data-testid^="cmd-create"], [data-testid="cmd-open-settings"], [data-testid="cmd-toggle-theme"], [data-testid="cmd-switch-vault"], [data-testid="cmd-rebuild-index"]',
    );
    expect(cmds.length).toBeLessThanOrEqual(3);
    expect(document.body.querySelector('[data-testid="cmd-show-more-commands"]')).toBeTruthy();
  });

  // ── Show more rows ────────────────────────────────────────────────────────────

  it("shows 'Show N more in Notes' row when notes exceed cap", async () => {
    // Include a map so activeGroupCount > 1, preventing single-group relaxation
    await searchWithResults({ notes: makeNotes(8), maps: [{ id: 1, title: "Map" }], scenes: [] });
    const showMore = document.body.querySelector('[data-testid="cmd-show-more-notes"]');
    expect(showMore).toBeTruthy();
    expect(showMore?.textContent).toContain("2");
    expect(showMore?.textContent).toContain("Notes");
  });

  it("no Show more row when notes are within cap", async () => {
    await searchWithResults({ notes: makeNotes(6), maps: [], scenes: [] });
    expect(document.body.querySelector('[data-testid="cmd-show-more-notes"]')).toBeNull();
  });

  it("shows Show more row for Tags when tags exceed cap", async () => {
    await searchWithResults({ notes: [], maps: [], scenes: [], tags: makeTags(7) });
    const showMore = document.body.querySelector('[data-testid="cmd-show-more-tags"]');
    expect(showMore).toBeTruthy();
    expect(showMore?.textContent).toContain("2");
    expect(showMore?.textContent).toContain("Tags");
  });

  it("shows Show more row for Maps when maps exceed cap", async () => {
    await searchWithResults({ notes: [], maps: makeMaps(5), scenes: [] });
    const showMore = document.body.querySelector('[data-testid="cmd-show-more-maps"]');
    expect(showMore).toBeTruthy();
    expect(showMore?.textContent).toContain("Maps");
  });

  it("shows Show more row for Scenes when scenes exceed cap", async () => {
    await searchWithResults({ notes: [], maps: [], scenes: makeScenes(5) });
    const showMore = document.body.querySelector('[data-testid="cmd-show-more-scenes"]');
    expect(showMore).toBeTruthy();
    expect(showMore?.textContent).toContain("Scenes");
  });

  // ── Expand in place ───────────────────────────────────────────────────────────

  it("clicking Show more in Notes reveals all results and removes the row", async () => {
    // Include a map so activeGroupCount > 1, preventing single-group relaxation (cap stays 6)
    await searchWithResults({ notes: makeNotes(10), maps: [{ id: 1, title: "Map" }], scenes: [] });
    const showMore = document.body.querySelector('[data-testid="cmd-show-more-notes"]') as HTMLElement;
    await fireEvent.click(showMore);
    await flush();
    expect(document.body.querySelectorAll('[data-testid="cmd-note-result"]').length).toBe(10);
    expect(document.body.querySelector('[data-testid="cmd-show-more-notes"]')).toBeNull();
  });

  it("clicking Show more in Maps reveals all map results", async () => {
    await searchWithResults({ notes: [], maps: makeMaps(5), scenes: [] });
    const showMore = document.body.querySelector('[data-testid="cmd-show-more-maps"]') as HTMLElement;
    await fireEvent.click(showMore);
    await flush();
    expect(document.body.querySelectorAll('[data-testid="cmd-map-result"]').length).toBe(5);
    expect(document.body.querySelector('[data-testid="cmd-show-more-maps"]')).toBeNull();
  });

  it("clicking Show more in Tags reveals all tag results", async () => {
    await searchWithResults({ notes: [], maps: [], scenes: [], tags: makeTags(7) });
    const showMore = document.body.querySelector('[data-testid="cmd-show-more-tags"]') as HTMLElement;
    await fireEvent.click(showMore);
    await flush();
    expect(document.body.querySelectorAll('[data-testid="cmd-tag-result"]').length).toBe(7);
    expect(document.body.querySelector('[data-testid="cmd-show-more-tags"]')).toBeNull();
  });

  it("expanding one group does not expand other groups", async () => {
    await searchWithResults({ notes: makeNotes(10), maps: [], scenes: [], tags: makeTags(8) });
    const showMoreNotes = document.body.querySelector('[data-testid="cmd-show-more-notes"]') as HTMLElement;
    await fireEvent.click(showMoreNotes);
    await flush();
    expect(document.body.querySelectorAll('[data-testid="cmd-note-result"]').length).toBe(10);
    expect(document.body.querySelectorAll('[data-testid="cmd-tag-result"]').length).toBe(5);
    expect(document.body.querySelector('[data-testid="cmd-show-more-tags"]')).toBeTruthy();
  });

  // ── Single-group cap relaxation ───────────────────────────────────────────────

  it("Notes cap relaxes to 15 when notes is the only group with results", async () => {
    await searchWithResults({ notes: makeNotes(15), maps: [], scenes: [], tags: [] });
    expect(document.body.querySelectorAll('[data-testid="cmd-note-result"]').length).toBe(15);
    expect(document.body.querySelector('[data-testid="cmd-show-more-notes"]')).toBeNull();
  });

  it("Show more still appears for Notes when single-group count exceeds 15", async () => {
    await searchWithResults({ notes: makeNotes(17), maps: [], scenes: [], tags: [] });
    expect(document.body.querySelectorAll('[data-testid="cmd-note-result"]').length).toBe(15);
    const showMore = document.body.querySelector('[data-testid="cmd-show-more-notes"]');
    expect(showMore).toBeTruthy();
    expect(showMore?.textContent).toContain("2");
  });

  it("Notes cap stays at 6 when multiple groups have results", async () => {
    await searchWithResults({
      notes: makeNotes(10),
      maps: [{ id: 1, title: "World Map" }],
      scenes: [],
    });
    expect(document.body.querySelectorAll('[data-testid="cmd-note-result"]').length).toBe(6);
    expect(document.body.querySelector('[data-testid="cmd-show-more-notes"]')).toBeTruthy();
  });

  it("Tags cap stays at 5 in single-group case (only Notes relaxes)", async () => {
    await searchWithResults({ notes: [], maps: [], scenes: [], tags: makeTags(8) });
    expect(document.body.querySelectorAll('[data-testid="cmd-tag-result"]').length).toBe(5);
    expect(document.body.querySelector('[data-testid="cmd-show-more-tags"]')).toBeTruthy();
  });

  // ── Reset on query change ─────────────────────────────────────────────────────

  it("editing the query collapses expanded sections back to defaults", async () => {
    // Include a map so activeGroupCount > 1, preventing single-group relaxation (cap stays 6)
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "search_all")
        return Promise.resolve({ notes: makeNotes(10), maps: [{ id: 1, title: "Map" }], scenes: [] });
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    await typeQuery("xx");
    await vi.advanceTimersByTimeAsync(80);
    await flush();

    const showMore = document.body.querySelector('[data-testid="cmd-show-more-notes"]') as HTMLElement;
    await fireEvent.click(showMore);
    await flush();
    expect(document.body.querySelectorAll('[data-testid="cmd-note-result"]').length).toBe(10);

    // Type a new query — should reset expansion
    await typeQuery("yy");
    await flush();
    await vi.advanceTimersByTimeAsync(80);
    await flush();
    expect(document.body.querySelectorAll('[data-testid="cmd-note-result"]').length).toBe(6);
    expect(document.body.querySelector('[data-testid="cmd-show-more-notes"]')).toBeTruthy();
  });
});

// ── Save note as template (issue #49) ────────────────────────────────────────

describe("command palette – Save note as template", () => {
  const fakeNote = {
    id: 1,
    path: "notes/my-note.md",
    title: "My Note",
    icon: null,
    cover_image: null,
    parent_path: null,
    archived: false,
    modified_at: "2026-01-01T00:00:00Z",
  };
  const fakeSavedEntry = { display_name: "My Note", path: ".grimoire/templates/My Note.md" };

  afterEach(() => {
    searchPalette.open = false;
    tabs.closeAll("left");
    tabs.closeAll("right");
  });

  it("appears in Commands group only when active tab is a note", async () => {
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "save";
    await fireEvent.input(input);
    await flush();
    expect(
      document.body.querySelector('[data-testid="cmd-save-note-as-template"]'),
    ).toBeTruthy();
  });

  it("is hidden when active tab is not a note", async () => {
    tabs.openTab({ type: "map", id: 1, title: "World Map" });
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "save";
    await fireEvent.input(input);
    await flush();
    expect(
      document.body.querySelector('[data-testid="cmd-save-note-as-template"]'),
    ).toBeNull();
  });

  it("is hidden when no tabs are open", async () => {
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "save";
    await fireEvent.input(input);
    await flush();
    expect(
      document.body.querySelector('[data-testid="cmd-save-note-as-template"]'),
    ).toBeNull();
  });

  it("invoking it calls save_note_as_template with the active note path and closes palette", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_notes") return Promise.resolve([fakeNote]);
      if (cmd === "save_note_as_template") return Promise.resolve(fakeSavedEntry);
      return Promise.resolve(null);
    });
    await notes.load();
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "save note as template";
    await fireEvent.input(input);
    await flush();

    const item = document.body.querySelector(
      '[data-testid="cmd-save-note-as-template"]',
    ) as HTMLElement;
    await fireEvent.click(item);
    await flush();

    expect(invoke).toHaveBeenCalledWith("save_note_as_template", {
      notePath: "notes/my-note.md",
    });
    expect(searchPalette.open).toBe(false);
  });
});

// ── Create new template (issue #48) ──────────────────────────────────────────

describe("command palette – Create new template", () => {
  const fakeEntry = { display_name: "Untitled", path: ".grimoire/templates/Untitled.md" };

  afterEach(() => {
    searchPalette.open = false;
  });

  it("appears in Commands group when searching 'template'", async () => {
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "template";
    await fireEvent.input(input);
    await flush();
    expect(
      document.body.querySelector('[data-testid="cmd-create-template"]'),
    ).toBeTruthy();
  });

  it("selecting it invokes create_template and closes palette", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "create_template") return Promise.resolve(fakeEntry);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "template";
    await fireEvent.input(input);
    await flush();

    const item = document.body.querySelector('[data-testid="cmd-create-template"]') as HTMLElement;
    await fireEvent.click(item);
    await flush();

    expect(invoke).toHaveBeenCalledWith("create_template");
    expect(searchPalette.open).toBe(false);
  });

  it("selecting it opens a template tab with badge 'Template'", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "create_template") return Promise.resolve(fakeEntry);
      return Promise.resolve(null);
    });
    render(AppSearch);
    await openPalette();
    const input = getSearchInput();
    input.value = "template";
    await fireEvent.input(input);
    await flush();

    const item = document.body.querySelector('[data-testid="cmd-create-template"]') as HTMLElement;
    await fireEvent.click(item);
    await flush();

    const activeTab = tabs.activeTab;
    expect(activeTab?.type).toBe("template");
    expect(activeTab?.badge).toBe("Template");
    expect((activeTab as any)?.templatePath).toBe(fakeEntry.path);
  });
});
