// Tests for the note Details Source — the first test surface the Details Pane
// choreography has ever had: the fetch fan-out, the stale-response guard, the
// linksTick refresh invariant, the "alias save → re-check collisions"
// invariant, and the save-status machine (including the alias-save failure
// path that used to be silent).
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { flushSync } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import { api } from "$lib/api";
import { createNoteDetailsSource } from "$lib/details/note-details-source.svelte";
import type { NoteDetailsSource } from "$lib/details/note-details-source.svelte";
import { linksTick } from "$lib/stores/links-tick.svelte";
import type { Note } from "$lib/types/ledger";

// Capture the Ledger Watcher listeners the source registers, so a test can emit
// ledger:rebuilt the way the backend watcher would (#212).
const { listeners } = vi.hoisted(() => ({
  listeners: {} as Record<string, ((e: { payload: unknown }) => void)[]>,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    (listeners[name] ??= []).push(cb);
    return () => {
      listeners[name] = (listeners[name] ?? []).filter((f) => f !== cb);
    };
  }),
}));

function emit(name: string, payload: unknown = null) {
  (listeners[name] ?? []).forEach((cb) => cb({ payload }));
}

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

// onLedgerEvents is a deliberate no-op outside Tauri, so the marker has to be
// present for the source to subscribe at all.
beforeEach(() => {
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.useRealTimers();
  mocked.mockReset();
  mocked.mockResolvedValue(null);
  Object.keys(listeners).forEach((k) => delete listeners[k]);
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
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

describe("note Details Source — stale guards on the failure path (#202)", () => {
  it("a failed load for note A leaves note B's tags and error flags alone", async () => {
    let rejectA!: (e: Error) => void;
    mocked.mockImplementation((cmd: string, rawArgs?: unknown) => {
      const args = rawArgs as Record<string, unknown> | undefined;
      if (cmd === "read_note_tags") {
        if (args?.notePath === noteA.path) {
          return new Promise((_res, rej) => { rejectA = rej; });
        }
        return Promise.resolve(["harbor-tag"]);
      }
      return Promise.resolve(null);
    });
    let note = $state<Note | null>(noteA);
    const source = mount(() => note);
    flushSync();

    note = noteB;
    flushSync();
    await flush();
    expect(source.tags).toEqual(["harbor-tag"]);

    // A's read rejects after the switch. It used to clear B's tags and raise
    // B's "tags unavailable" state — the GM shown wrong data with an error on it.
    rejectA(new Error("read_note_tags failed"));
    await flush();
    expect(source.tags).toEqual(["harbor-tag"]);
    expect(source.tagsLoadError).toBe(false);
  });

  it("a failed alias load for note A does not raise note B's alias error", async () => {
    let rejectA!: (e: Error) => void;
    mocked.mockImplementation((cmd: string, rawArgs?: unknown) => {
      const args = rawArgs as Record<string, unknown> | undefined;
      if (cmd === "get_note_aliases") {
        if (args?.noteId === noteA.id) {
          return new Promise((_res, rej) => { rejectA = rej; });
        }
        return Promise.resolve(["Harbormaster"]);
      }
      return Promise.resolve(null);
    });
    let note = $state<Note | null>(noteA);
    const source = mount(() => note);
    flushSync();

    note = noteB;
    flushSync();
    await flush();
    expect(source.aliases).toEqual(["Harbormaster"]);

    rejectA(new Error("get_note_aliases failed"));
    await flush();
    expect(source.aliases).toEqual(["Harbormaster"]);
    expect(source.aliasesLoadError).toBe(false);
  });

  it("note A's backlinks never land on note B, resolved or rejected", async () => {
    let resolveA!: (v: unknown) => void;
    let rejectOutboundA!: (e: Error) => void;
    mocked.mockImplementation((cmd: string, rawArgs?: unknown) => {
      const args = rawArgs as Record<string, unknown> | undefined;
      if (cmd === "get_backlinks") {
        if (args?.noteId === noteA.id) return new Promise((res) => { resolveA = res; });
        return Promise.resolve([{ id: 7, path: "notes/dock.md", title: "Dock" }]);
      }
      if (cmd === "get_outbound_links") {
        if (args?.noteId === noteA.id) return new Promise((_r, rej) => { rejectOutboundA = rej; });
        return Promise.resolve([{ target_path: "Ash.md", resolved_id: null, resolved_title: null, resolved_path: null }]);
      }
      return Promise.resolve(null);
    });
    let note = $state<Note | null>(noteA);
    const source = mount(() => note);
    flushSync();

    note = noteB;
    flushSync();
    await flush();
    expect(source.backlinks).toHaveLength(1);
    expect(source.backlinks[0].title).toBe("Dock");
    expect(source.outboundLinks).toHaveLength(1);

    // loadLinks was unguarded on *both* paths — A's links could overwrite B's.
    resolveA([{ id: 99, path: "notes/aldric-only.md", title: "Aldric only" }]);
    rejectOutboundA(new Error("get_outbound_links failed"));
    await flush();
    expect(source.backlinks[0].title).toBe("Dock");
    expect(source.outboundLinks).toHaveLength(1);
  });
});

describe("note Details Source — Ledger Watcher subscription (#212)", () => {
  it("refetches its fan-out on ledger:rebuilt without a pane relaying it", async () => {
    mockCommands({ read_note_tags: ["npc"] });
    mount(() => noteA);
    await flush();
    const before = callsFor("read_note_tags").length;

    emit("ledger:rebuilt");
    await flush();
    expect(callsFor("read_note_tags").length).toBe(before + 1);
  });

  it("stops listening once torn down", async () => {
    mockCommands({ read_note_tags: ["npc"] });
    mount(() => noteA);
    await flush();
    // The listen() promise resolves a tick after registration; let it land so
    // teardown has a real unlisten to call.
    await flush();
    const before = callsFor("read_note_tags").length;

    cleanup!();
    cleanup = null;
    emit("ledger:rebuilt");
    await flush();
    expect(callsFor("read_note_tags").length).toBe(before);
  });
});

describe("note Details Source — backlinks refresh from any write path (#212)", () => {
  it("a scene rename refreshes backlinks, though nothing bumps linksTick by hand", async () => {
    mockCommands({ get_backlinks: [], get_outbound_links: [] });
    mount(() => noteA);
    await flush();
    const before = callsFor("get_backlinks").length;

    // update_scene reaches note_mutation::commit_backlink_rewrites in Rust — the
    // second write path that rewrote note bodies with no bump behind it. The
    // Command Wrapper now owns the obligation, so this needs no cooperation
    // from the caller.
    await api.updateScene(1, "The Harbour at Night");
    flushSync();
    await flush();
    expect(callsFor("get_backlinks").length).toBe(before + 1);
  });

  it("a command that cannot change links does not churn the backlinks fetch", async () => {
    mockCommands({ get_backlinks: [] });
    mount(() => noteA);
    await flush();
    const before = callsFor("get_backlinks").length;

    await api.silent.writeNoteTags(noteA.path, ["npc"]);
    flushSync();
    await flush();
    expect(callsFor("get_backlinks").length).toBe(before);
  });
});

describe("note Details Source — teardown (#210)", () => {
  it("leaves no flash timer behind when torn down mid-flash", async () => {
    vi.useFakeTimers();
    mockCommands({});
    const source = mount(() => noteA);
    await flush();

    await source.saveTags(["npc"]);
    expect(source.saveStatus).toBe("saved");
    const pending = vi.getTimerCount();
    expect(pending).toBeGreaterThan(0);

    cleanup!();
    cleanup = null;
    // The 1500ms "saved" flash used to outlive the source and write $state into
    // a module whose owner had already gone.
    expect(vi.getTimerCount()).toBe(pending - 1);
  });

  it("writes no status for a save that fails after teardown", async () => {
    let rejectWrite!: (e: Error) => void;
    mocked.mockImplementation((cmd: string) => {
      if (cmd === "write_note_tags") {
        return new Promise((_res, rej) => { rejectWrite = rej; });
      }
      return Promise.resolve(null);
    });
    const source = mount(() => noteA);
    await flush();

    const pending = source.saveTags(["npc"]);
    await flush();
    cleanup!();
    cleanup = null;
    rejectWrite(new Error("write_note_tags failed"));
    await pending;
    expect(source.saveStatus).toBe("idle");
  });
});
