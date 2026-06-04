import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ledger } from "../lib/stores/ledger.svelte";

// ── ledger store — exploreSample ─────────────────────────────────────────────

const SAMPLE_PATH = "/app-data/sample-world";

function mockSampleInvoke() {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "explore_sample_ledger") return SAMPLE_PATH;
    if (cmd === "open_ledger")
      return {
        path: SAMPLE_PATH,
        note_count: 3,
        scene_count: 0,
        map_count: 0,
        failed_imports: [],
      };
    return null;
  });
}

describe("ledger store — exploreSample", () => {
  beforeEach(async () => {
    // Start each test from a clean closed state
    await ledger.closeLedger();
    vi.mocked(invoke).mockReset();
  });

  it("sets isSample to true after exploreSample", async () => {
    mockSampleInvoke();

    const ok = await ledger.exploreSample();

    expect(ok).toBe(true);
    expect(ledger.isSample).toBe(true);
  });

  it("does not call add_recent_ledger during exploreSample", async () => {
    mockSampleInvoke();

    await ledger.exploreSample();

    const calls = vi.mocked(invoke).mock.calls.map(([cmd]) => cmd);
    expect(calls).not.toContain("add_recent_ledger");
  });

  it("opens the ledger path returned by explore_sample_ledger", async () => {
    mockSampleInvoke();

    await ledger.exploreSample();

    const openCall = vi
      .mocked(invoke)
      .mock.calls.find(([cmd]) => cmd === "open_ledger");
    expect(openCall).toBeDefined();
    expect(openCall![1]).toEqual({ path: SAMPLE_PATH });
  });

  it("clears isSample when closeLedger is called", async () => {
    mockSampleInvoke();

    await ledger.exploreSample();
    expect(ledger.isSample).toBe(true);

    await ledger.closeLedger();
    expect(ledger.isSample).toBe(false);
  });

  it("isSample is false by default", async () => {
    expect(ledger.isSample).toBe(false);
  });

  it("sets pendingStartHere to true after exploreSample", async () => {
    mockSampleInvoke();
    await ledger.exploreSample();
    expect(ledger.pendingStartHere).toBe(true);
  });

  it("clears pendingStartHere when closeLedger is called", async () => {
    mockSampleInvoke();
    await ledger.exploreSample();
    await ledger.closeLedger();
    expect(ledger.pendingStartHere).toBe(false);
  });

  it("throws and sets error when exploring fails", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "explore_sample_ledger") throw "Failed to resolve resource dir";
      return null;
    });

    await expect(ledger.exploreSample()).rejects.toBeTruthy();
    expect(ledger.error).toContain("Failed to resolve resource dir");
    expect(ledger.isSample).toBe(false);
  });
});
