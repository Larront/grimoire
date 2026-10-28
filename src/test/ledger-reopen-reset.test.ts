import { describe, it, expect, beforeEach, vi } from "vitest";
import { flushSync } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import { ledger } from "$lib/stores/ledger.svelte";
import { tabs } from "$lib/stores/tabs.svelte";
import { paneDetailState } from "$lib/stores/pane-detail-state.svelte";
import { pdfSceneLinks } from "$lib/stores/pdf-scene-links.svelte";
import { statblockPresets } from "$lib/stores/statblock-presets.svelte";
import type { PdfSceneLink } from "$lib/bindings.gen";

// Re-exploring the Example World from inside itself reopens the *same* path over a
// sandbox the backend has just wiped and copied fresh. Every store below holds state
// for one ledger's database; keyed on the path alone, each kept serving the copy that
// was thrown away. These run the real ledger store against a mocked backend, so the
// reopen is the one the palette's "Explore example world" actually performs.

const SAMPLE_PATH = "/app-data/sample-world";
const PDF = "handouts/letter.pdf";

const madeWhileExploring: PdfSceneLink = {
  id: 1,
  pdf_path: PDF,
  page: 1,
  start_offset: 0,
  end_offset: 12,
  quote: "Dear brother",
  scene_id: 4,
  created_at: "2026-10-22T09:00:00Z",
};

// What the sandbox holds right now. A fresh explore resets it.
let sandbox: { links: PdfSceneLink[]; statblockDefault: string | null };

function freshSandbox() {
  sandbox = { links: [], statblockDefault: null };
}

function mockBackend() {
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    switch (cmd) {
      case "explore_sample_ledger":
        freshSandbox();
        return SAMPLE_PATH;
      case "open_ledger":
        return {
          path: SAMPLE_PATH,
          note_count: 3,
          scene_count: 0,
          map_count: 0,
          failed_imports: [],
          unlinked_pins: [],
          recovered_from_backup: null,
        };
      case "get_pdf_scene_links":
        return sandbox.links;
      case "get_statblock_preset_default":
        return sandbox.statblockDefault;
      case "save_statblock_preset_default":
        sandbox.statblockDefault = (args as { preset: string | null }).preset;
        return null;
      case "list_statblock_presets":
        return [];
      default:
        return null;
    }
  });
}

// Fetches are awaited inside effects; let them settle.
async function settle() {
  flushSync();
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

async function explore() {
  await ledger.exploreSample();
  await settle();
}

beforeEach(async () => {
  await ledger.closeLedger();
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  freshSandbox();
  mockBackend();
  await settle();
});

describe("re-exploring the Example World from inside itself", () => {
  it("closes the tabs of the copy it replaced", async () => {
    await explore();
    tabs.openTab({ type: "note", id: 42, title: "Made while exploring" });
    expect(tabs.left.tabs.map((t) => t.id)).toContain(42);

    await explore();

    expect(ledger.path).toBe(SAMPLE_PATH);
    expect(tabs.left.tabs).toEqual([]);
  });

  it("closes them too when the explore starts from outside the sandbox", async () => {
    await explore();
    tabs.openTab({ type: "note", id: 42, title: "Made while exploring" });
    await ledger.closeLedger();
    await settle();

    await explore();

    expect(tabs.left.tabs).toEqual([]);
  });

  it("drops map selections, whose pin ids restart with the database", async () => {
    await explore();
    paneDetailState.setMapSelection("left", 3, { pinId: 11, annotationId: null });

    await explore();

    expect(paneDetailState.getMapSelection("left", 3).pinId).toBeNull();
  });

  it("drops the cached Scene-links of a PDF", async () => {
    await explore();
    sandbox.links = [madeWhileExploring];
    await pdfSceneLinks.load(PDF);
    expect(pdfSceneLinks.linksForPath(PDF)).toHaveLength(1);

    await explore();

    expect(pdfSceneLinks.linksForPath(PDF)).toEqual([]);
  });

  it("re-reads the statblock default the reset took back", async () => {
    await explore();
    await statblockPresets.setDefault("Large Orc");
    expect(statblockPresets.defaultName).toBe("Large Orc");

    await explore();
    await statblockPresets.load();

    expect(statblockPresets.defaultName).toBeNull();
  });
});
