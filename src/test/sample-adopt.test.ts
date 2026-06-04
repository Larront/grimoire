import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ledger } from "../lib/stores/ledger.svelte";

// ── ledger store — adopt ──────────────────────────────────────────────────────

const SAMPLE_PATH = "/app-data/sample-world";
const ADOPT_PARENT = "/Users/gm/Documents";
const ADOPT_NAME = "Ashfen Chronicles";
const ADOPT_PATH = `${ADOPT_PARENT}/${ADOPT_NAME}`;

function mockSampleInvoke() {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "explore_sample_ledger") return SAMPLE_PATH;
    if (cmd === "open_ledger")
      return {
        path: SAMPLE_PATH,
        note_count: 10,
        scene_count: 0,
        map_count: 1,
        failed_imports: [],
      };
    return null;
  });
}

function mockAdoptInvoke() {
  vi.mocked(invoke).mockImplementation(async (cmd: string, rawArgs?: unknown) => {
    const args = rawArgs as Record<string, unknown> | undefined;
    if (cmd === "explore_sample_ledger") return SAMPLE_PATH;
    if (cmd === "adopt_sample_ledger") return ADOPT_PATH;
    if (cmd === "open_ledger")
      return {
        path: (args as { path: string }).path,
        note_count: 10,
        scene_count: 0,
        map_count: 1,
        failed_imports: [],
      };
    if (cmd === "add_recent_ledger") return null;
    return null;
  });
}

describe("ledger store — adopt", () => {
  beforeEach(async () => {
    await ledger.closeLedger();
    vi.mocked(invoke).mockReset();
    // Start in sample mode
    mockSampleInvoke();
    await ledger.exploreSample();
    vi.mocked(invoke).mockReset();
  });

  it("invokes adopt_sample_ledger with parent and name", async () => {
    mockAdoptInvoke();

    await ledger.adopt(ADOPT_PARENT, ADOPT_NAME);

    const adoptCall = vi
      .mocked(invoke)
      .mock.calls.find(([cmd]) => cmd === "adopt_sample_ledger");
    expect(adoptCall).toBeDefined();
    expect(adoptCall![1]).toEqual({ parent: ADOPT_PARENT, name: ADOPT_NAME });
  });

  it("calls add_recent_ledger after adopt (vanilla openLedger path)", async () => {
    mockAdoptInvoke();

    await ledger.adopt(ADOPT_PARENT, ADOPT_NAME);

    const calls = vi.mocked(invoke).mock.calls.map(([cmd]) => cmd);
    expect(calls).toContain("add_recent_ledger");
  });

  it("clears isSample after adopt", async () => {
    mockAdoptInvoke();

    expect(ledger.isSample).toBe(true);
    await ledger.adopt(ADOPT_PARENT, ADOPT_NAME);
    expect(ledger.isSample).toBe(false);
  });

  it("opens the adopted ledger path", async () => {
    mockAdoptInvoke();

    await ledger.adopt(ADOPT_PARENT, ADOPT_NAME);

    const openCall = vi
      .mocked(invoke)
      .mock.calls.find(([cmd]) => cmd === "open_ledger");
    expect(openCall).toBeDefined();
    expect(openCall![1]).toEqual({ path: ADOPT_PATH });
  });

  it("returns true on success", async () => {
    mockAdoptInvoke();

    const result = await ledger.adopt(ADOPT_PARENT, ADOPT_NAME);
    expect(result).toBe(true);
  });

  it("throws and keeps isSample when the adopt command fails", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "adopt_sample_ledger") throw "No sample sandbox found to adopt";
      return null;
    });

    await expect(ledger.adopt(ADOPT_PARENT, ADOPT_NAME)).rejects.toBeTruthy();
    expect(ledger.isSample).toBe(true);
    expect(ledger.error).toContain("No sample sandbox found");
  });

  it("throws and keeps isSample when opening the adopted ledger fails", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "adopt_sample_ledger") return ADOPT_PATH;
      if (cmd === "open_ledger") throw "Failed to open ledger";
      return null;
    });

    await expect(ledger.adopt(ADOPT_PARENT, ADOPT_NAME)).rejects.toBeTruthy();
    // The GM is still in the sandbox — the sample treatment must not vanish
    expect(ledger.isSample).toBe(true);
  });
});
