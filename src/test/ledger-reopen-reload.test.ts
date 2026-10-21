import { describe, it, expect, beforeEach, vi } from "vitest";
import { flushSync } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import { ledger } from "$lib/stores/ledger.svelte";
import { quickNotes } from "$lib/stores/quick-notes.svelte";
import type { QuickNote } from "$lib/bindings.gen";

// Re-exploring the Example World from inside itself reopens the *same* path: the
// backend wipes the sandbox and copies it fresh, so the ledger holds none of what
// the GM did there. A list keyed on the path alone never notices — the captured
// Quick Note stays drawn until the app reloads. These run the real ledger and
// Quick Notes stores against a mocked backend, so the reopen is the one the
// palette's "Explore example world" actually performs.

const SAMPLE_PATH = "/app-data/sample-world";

const captured: QuickNote = {
  id: 1,
  body: "The innkeeper lied about the cellar",
  captured_at: "2026-10-22T09:00:00Z",
};

// What the sandbox's database holds right now. A fresh explore resets it.
let rows: QuickNote[] = [];

function mockBackend() {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "explore_sample_ledger") {
      rows = [];
      return SAMPLE_PATH;
    }
    if (cmd === "open_ledger")
      return {
        path: SAMPLE_PATH,
        note_count: 3,
        scene_count: 0,
        map_count: 0,
        failed_imports: [],
        unlinked_pins: [],
        recovered_from_backup: null,
      };
    if (cmd === "list_quick_notes") return rows;
    return null;
  });
}

// The collection's fetch is awaited inside an effect; let it settle.
async function settle() {
  flushSync();
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("re-exploring the Example World from inside itself", () => {
  beforeEach(async () => {
    await ledger.closeLedger();
    vi.mocked(invoke).mockReset();
    mockBackend();
    await settle();
  });

  it("drops a Quick Note the reset took out of the ledger", async () => {
    await ledger.exploreSample();
    await settle();
    expect(quickNotes.notes).toEqual([]);

    // Captured while exploring: the ledger has it, and so does the list.
    rows = [captured];
    await quickNotes.load();
    expect(quickNotes.count).toBe(1);

    // Same path, fresh database.
    await ledger.exploreSample();
    await settle();

    expect(ledger.path).toBe(SAMPLE_PATH);
    expect(quickNotes.notes).toEqual([]);
    expect(quickNotes.count).toBe(0);
  });
});
