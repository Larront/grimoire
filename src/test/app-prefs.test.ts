import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { appPrefs } from "../lib/stores/app-prefs.svelte";

// ── appPrefs — Rust-side persistence ─────────────────────────────────────────

describe("appPrefs — Rust persistence", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(null);
    localStorage.clear();
  });

  it("setters persist the full snapshot via save_app_prefs", () => {
    appPrefs.setConfirmRenameLinks(true);

    const call = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === "save_app_prefs");
    expect(call).toBeDefined();
    expect(call![1]).toEqual({
      prefs: {
        reduceMotion: false,
        reduceMotionChoice: "system",
        confirmRenameLinks: true,
        density: null,
      },
    });

    appPrefs.setConfirmRenameLinks(false);
  });

  it("setters do not write to webview localStorage", () => {
    appPrefs.setReduceMotion(true);
    expect(localStorage.setItem).not.toHaveBeenCalledWith("grimoire-reduce-motion", "true");
    appPrefs.setMotionChoice("system");
  });

  it("load() applies persisted values and migrates legacy localStorage keys", async () => {
    localStorage.setItem("grimoire-confirm-rename-links", "true");
    // The example banner's key: retired with the banner, so only cleared away.
    localStorage.setItem("grimoire-sample-banner-dismissed", "true");
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_prefs")
        return {
          reduceMotion: true,
          confirmRenameLinks: false,
        };
      return null;
    });

    await appPrefs.load();

    expect(appPrefs.reduceMotion).toBe(true);
    // Migrated from the legacy webview key, which is then removed
    expect(appPrefs.confirmRenameLinks).toBe(true);
    expect(localStorage.getItem("grimoire-confirm-rename-links")).toBeNull();
    expect(localStorage.getItem("grimoire-sample-banner-dismissed")).toBeNull();

    // Migration re-persists the merged snapshot
    const saved = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "save_app_prefs");
    expect(saved.length).toBeGreaterThan(0);

    appPrefs.setMotionChoice("system");
    appPrefs.setConfirmRenameLinks(false);
  });

  it("load() is a one-shot — repeat calls do not re-fetch", async () => {
    await appPrefs.load();
    const fetches = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "get_app_prefs");
    expect(fetches.length).toBe(0);
  });
});

// ── appPrefs — Reduce Motion follows the computer unless the GM chooses ──────
/*
  `appPrefs` is a module singleton whose `load()` is a one-shot, so every case here
  resets the module registry and re-imports to get an unloaded store.

  Reduce Motion is a choice of three since the 2026-10 design review: follow the
  computer (the default, live), on, or off. It used to be a switch the computer seeded
  on the first run only, after which the two could disagree.
*/
describe("appPrefs — Reduce Motion", () => {
  function mockSystemReducedMotion(reduce: boolean) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query.includes("prefers-reduced-motion") ? reduce : false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }),
    });
  }

  async function freshStore(getPrefsResult: unknown) {
    vi.resetModules();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_prefs") return getPrefsResult;
      return null;
    });
    const mod = await import("../lib/stores/app-prefs.svelte");
    await mod.appPrefs.load();
    return mod.appPrefs;
  }

  beforeEach(() => localStorage.clear());

  it("follows the computer when nobody has chosen", async () => {
    mockSystemReducedMotion(true);
    const reduced = await freshStore(null);
    expect(reduced.motionChoice).toBe("system");
    expect(reduced.reduceMotion).toBe(true);

    mockSystemReducedMotion(false);
    const full = await freshStore(null);
    expect(full.reduceMotion).toBe(false);
  });

  it("On and Off outrank the computer", async () => {
    mockSystemReducedMotion(true);
    const off = await freshStore({ reduceMotion: false, reduceMotionChoice: "off" });
    expect(off.reduceMotion).toBe(false);

    mockSystemReducedMotion(false);
    const on = await freshStore({ reduceMotion: true, reduceMotionChoice: "on" });
    expect(on.reduceMotion).toBe(true);
  });

  it("reads a file from before the choice: on stays on, off follows the computer", async () => {
    mockSystemReducedMotion(true);
    const wasOn = await freshStore({ reduceMotion: true, confirmRenameLinks: false });
    expect(wasOn.motionChoice).toBe("on");
    const wasOff = await freshStore({ reduceMotion: false, confirmRenameLinks: false });
    expect(wasOff.motionChoice).toBe("system");
    expect(wasOff.reduceMotion).toBe(true);
  });

  it("a legacy localStorage yes becomes On", async () => {
    mockSystemReducedMotion(false);
    localStorage.setItem("grimoire-reduce-motion", "true");
    const prefs = await freshStore(null);
    expect(prefs.motionChoice).toBe("on");
  });
});
