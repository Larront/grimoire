import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ledger } from "../lib/stores/ledger.svelte";

// ── ledger store — exploreSample ─────────────────────────────────────────────

describe("ledger store — exploreSample", () => {
  beforeEach(async () => {
    // Start each test from a clean closed state
    await ledger.closeLedger();
    vi.mocked(invoke).mockReset();
  });

  it("sets isSample to true after exploreSample", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "explore_sample_ledger") return "/app-data/sample-world";
      if (cmd === "open_ledger")
        return {
          path: "/app-data/sample-world",
          note_count: 3,
          scene_count: 0,
          map_count: 0,
          failed_imports: [],
        };
      return null;
    });

    const ok = await ledger.exploreSample();

    expect(ok).toBe(true);
    expect(ledger.isSample).toBe(true);
  });

  it("does not call add_recent_ledger during exploreSample", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "explore_sample_ledger") return "/app-data/sample-world";
      if (cmd === "open_ledger")
        return {
          path: "/app-data/sample-world",
          note_count: 3,
          scene_count: 0,
          map_count: 0,
          failed_imports: [],
        };
      return null;
    });

    await ledger.exploreSample();

    const calls = vi.mocked(invoke).mock.calls.map(([cmd]) => cmd);
    expect(calls).not.toContain("add_recent_ledger");
  });

  it("opens the ledger path returned by explore_sample_ledger", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "explore_sample_ledger") return "/app-data/sample-world";
      if (cmd === "open_ledger")
        return {
          path: "/app-data/sample-world",
          note_count: 3,
          scene_count: 0,
          map_count: 0,
          failed_imports: [],
        };
      return null;
    });

    await ledger.exploreSample();

    const openCall = vi.mocked(invoke).mock.calls.find(
      ([cmd]) => cmd === "open_ledger",
    );
    expect(openCall).toBeDefined();
    expect(openCall![1]).toEqual({ path: "/app-data/sample-world" });
  });

  it("clears isSample when closeLedger is called", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "explore_sample_ledger") return "/app-data/sample-world";
      if (cmd === "open_ledger")
        return {
          path: "/app-data/sample-world",
          note_count: 3,
          scene_count: 0,
          map_count: 0,
          failed_imports: [],
        };
      return null;
    });

    await ledger.exploreSample();
    expect(ledger.isSample).toBe(true);

    await ledger.closeLedger();
    expect(ledger.isSample).toBe(false);
  });

  it("isSample is false by default", async () => {
    expect(ledger.isSample).toBe(false);
  });
});
