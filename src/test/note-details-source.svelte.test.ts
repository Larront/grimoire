// Tests for the note Details Source — the first test surface the Details Pane
// choreography has ever had: the fetch fan-out, the stale-response guard, the
// linksTick refresh invariant, the "alias save → re-check collisions"
// invariant, and the save-status machine (including the alias-save failure
// path that used to be silent).
import { describe, it, expect, afterEach, vi } from "vitest";
import { flushSync } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import { createNoteDetailsSource } from "$lib/details/note-details-source.svelte";
import type { NoteDetailsSource } from "$lib/details/note-details-source.svelte";
import { linksTick } from "$lib/stores/links-tick.svelte";
import type { Note } from "$lib/types/ledger";

const mocked = vi.mocked(invoke);

const noteA: Note = {
  id: 1,
  path: "notes/aldric.md",
  title: "Aldric",
  icon: null,
  cover_image: null,
  parent_path: "notes",
  archived: false,
  modified_at: "2026-01-01T00:00:00Z",
} as unknown as Note;

const noteB: Note = { ...noteA, id: 2, path: "notes/harbor.md", title: "Harbor" } as Note;

type Responses = Record<string, unknown>;

function mockCommands(responses: Responses, failures: string[] = []) {
  mocked.mockImplementation((cmd: string) => {
    if (failures.includes(cmd)) return Promise.reject(new Error(`${cmd} failed`));
    if (cmd in responses) return Promise.resolve(responses[cmd]);
    return Promise.resolve(null);
  });
}

function callsFor(cmd: string) {
  return mocked.mock.calls.filter(([c]) => c === cmd);
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

let cleanup: (() => void) | null = null;

function mount(getNote: () => Note | null): NoteDetailsSource {
  let source!: NoteDetailsSource;
  cleanup = $effect.root(() => {
    source = createNoteDetailsSource(getNote);
  });
  flushSync();
  return source;
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.useRealTimers();
  mocked.mockReset();
  mocked.mockResolvedValue(null);
});

describe("note Details Source — fetch fan-out", () => {
  it("loads tags, aliases, collisions, backlinks and outbound links for the note", async () => {
    mockCommands({
      read_note_tags: ["npc", "allied"],
      get_note_aliases: ["The Captain"],
      get_alias_collisions: [{ alias: "The Captain", other_note_id: 9, other_note_title: "Ash" }],
      get_backlinks: [{ id: 3, path: "notes/log.md", title: "Log" }],
      get_outbound_links: [{ target_path: "Harbor.md", resolved_id: 2, resolved_title: "Harbor", resolved_path: "notes/harbor.md" }],
      list_all_tags: ["npc", "allied", "place"],
    });
    const source = mount(() => noteA);
    await flush();

    expect(source.tags).toEqual(["npc", "allied"]);
    expect(source.aliases).toEqual(["The Captain"]);
    expect(source.aliasCollisions).toHaveLength(1);
    expect(source.backlinks).toHaveLength(1);
    expect(source.outboundLinks).toHaveLength(1);
    expect(source.allTags).toEqual(["npc", "allied", "place"]);
    expect(callsFor("read_note_tags")[0][1]).toEqual({ notePath: "notes/aldric.md" });
  });

  it("clears all state when the note becomes null", async () => {
    mockCommands({ read_note_tags: ["npc"], get_backlinks: [{ id: 3, path: "x", title: "X" }] });
    let note = $state<Note | null>(noteA);
    const source = mount(() => note);
    await flush();
    expect(source.tags).toEqual(["npc"]);

    note = null;
    flushSync();
    expect(source.tags).toEqual([]);
    expect(source.backlinks).toEqual([]);
    expect(source.aliasCollisions).toEqual([]);
  });

  it("does not refetch when the same note re-fires the effect", async () => {
    mockCommands({ read_note_tags: ["npc"] });
    let note = $state<Note | null>(noteA);
    const source = mount(() => note);
    await flush();
    const before = callsFor("read_note_tags").length;

    // Same path, new object identity — e.g. notes.load() returning fresh rows.
    note = { ...noteA } as Note;
    flushSync();
    await flush();
    expect(callsFor("read_note_tags").length).toBe(before);
    expect(source.tags).toEqual(["npc"]);
  });

  it("ignores stale responses when switching notes quickly", async () => {
    let resolveA!: (v: string[]) => void;
    mocked.mockImplementation((cmd: string, rawArgs?: unknown) => {
      const args = rawArgs as Record<string, unknown> | undefined;
      if (cmd === "read_note_tags") {
        if (args?.notePath === noteA.path) {
          return new Promise((res) => { resolveA = res; });
        }
        return Promise.resolve(["harbor-tag"]);
      }
      return Promise.resolve(null);
    });
    let note = $state<Note | null>(noteA);
    const source = mount(() => note);
    flushSync();

    // Switch to note B before A's tags arrive.
    note = noteB;
    flushSync();
    await flush();
    expect(source.tags).toEqual(["harbor-tag"]);

    // A's slow response lands late — must not clobber B's tags.
    resolveA(["aldric-tag"]);
    await flush();
    expect(source.tags).toEqual(["harbor-tag"]);
  });

  it("sets load-error flags when tag/alias fetches fail", async () => {
    mockCommands({}, ["read_note_tags", "get_note_aliases"]);
    const source = mount(() => noteA);
    await flush();
    expect(source.tagsLoadError).toBe(true);
    expect(source.aliasesLoadError).toBe(true);
    expect(source.tags).toEqual([]);
  });
});

describe("note Details Source — linksTick invariant", () => {
  it("reloads backlinks and outbound links when linksTick bumps", async () => {
    mockCommands({ get_backlinks: [], get_outbound_links: [] });
    mount(() => noteA);
    await flush();
    const before = callsFor("get_backlinks").length;

    linksTick.bump();
    flushSync();
    await flush();
    expect(callsFor("get_backlinks").length).toBe(before + 1);
    expect(callsFor("get_outbound_links").length).toBeGreaterThan(0);
  });
});

describe("note Details Source — save-status machine", () => {
  it("saveTags writes, refreshes allTags, and flashes 'saved' then returns to idle", async () => {
    vi.useFakeTimers();
    mockCommands({ list_all_tags: ["npc"] });
    const source = mount(() => noteA);
    await flush();
    const allTagsBefore = callsFor("list_all_tags").length;

    await source.saveTags(["npc"]);
    expect(callsFor("write_note_tags")[0][1]).toEqual({ notePath: noteA.path, tags: ["npc"] });
    expect(callsFor("list_all_tags").length).toBe(allTagsBefore + 1);
    expect(source.saveStatus).toBe("saved");

    vi.advanceTimersByTime(1500);
    expect(source.saveStatus).toBe("idle");
  });

  it("saveTags failure sets 'error' and retrySave re-attempts", async () => {
    mockCommands({}, ["write_note_tags"]);
    const source = mount(() => noteA);
    await flush();

    await source.saveTags(["npc"]);
    expect(source.saveStatus).toBe("error");

    mockCommands({}); // backend recovers
    await source.retrySave();
    expect(source.saveStatus).toBe("saved");
    expect(callsFor("write_note_tags").length).toBe(2); // failed attempt + retry
  });

  it("saveAliases re-checks collisions on success (the invariant)", async () => {
    mockCommands({ get_alias_collisions: [] });
    const source = mount(() => noteA);
    await flush();
    const collisionCallsBefore = callsFor("get_alias_collisions").length;

    mockCommands({
      get_alias_collisions: [{ alias: "Cap", other_note_id: 7, other_note_title: "Other" }],
    });
    await source.saveAliases(["Cap"]);
    expect(callsFor("get_alias_collisions").length).toBe(collisionCallsBefore + 1);
    expect(source.aliasCollisions).toHaveLength(1);
    expect(source.saveStatus).toBe("saved");
  });

  it("saveAliases failure is no longer silent — it reports 'error' with retry", async () => {
    mockCommands({}, ["set_note_aliases"]);
    const source = mount(() => noteA);
    await flush();

    await source.saveAliases(["Cap"]);
    expect(source.saveStatus).toBe("error");

    mockCommands({ get_alias_collisions: [] });
    await source.retrySave();
    expect(source.saveStatus).toBe("saved");
  });
});
