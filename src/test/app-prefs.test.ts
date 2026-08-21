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
    appPrefs.setSampleBannerDismissed(true);

    const call = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === "save_app_prefs");
    expect(call).toBeDefined();
    expect(call![1]).toEqual({
      prefs: {
        reduceMotion: false,
        confirmRenameLinks: false,
        sampleBannerDismissed: true,
      },
    });

    appPrefs.setSampleBannerDismissed(false);
  });

  it("setters do not write to webview localStorage", () => {
    appPrefs.setReduceMotion(true);
    expect(localStorage.setItem).not.toHaveBeenCalledWith("grimoire-reduce-motion", "true");
    appPrefs.setReduceMotion(false);
  });

  it("load() applies persisted values and migrates legacy localStorage keys", async () => {
    localStorage.setItem("grimoire-sample-banner-dismissed", "true");
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_prefs")
        return {
          reduceMotion: true,
          confirmRenameLinks: false,
          sampleBannerDismissed: false,
        };
      return null;
    });

    await appPrefs.load();

    expect(appPrefs.reduceMotion).toBe(true);
    // Migrated from the legacy webview key, which is then removed
    expect(appPrefs.sampleBannerDismissed).toBe(true);
    expect(localStorage.getItem("grimoire-sample-banner-dismissed")).toBeNull();

    // Migration re-persists the merged snapshot
    const saved = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "save_app_prefs");
    expect(saved.length).toBeGreaterThan(0);

    appPrefs.setReduceMotion(false);
    appPrefs.setSampleBannerDismissed(false);
  });

  it("load() is a one-shot — repeat calls do not re-fetch", async () => {
    await appPrefs.load();
    const fetches = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "get_app_prefs");
    expect(fetches.length).toBe(0);
  });
});

// ── appPrefs — first run seeds reduced motion from the OS ────────────────────
/*
  `appPrefs` is a module singleton whose `load()` is a one-shot, so every case here has
  to reset the module registry and re-import to get an unloaded store. That is also why
  these live in their own describe: the block above has already consumed the one load.

  What is being pinned down is the boundary. The platform's setting decides ONLY when
  nobody has decided — no prefs file and no pre-migration localStorage — and never again
  after that, because a stored `false` is a GM saying "no, I want the motion" and
  following the system on each launch would quietly overrule them every time.
*/
describe("appPrefs — reduced motion seeding", () => {
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

  it("takes reduced motion from the OS when no prefs file exists", async () => {
    mockSystemReducedMotion(true);
    const prefs = await freshStore(null);
    expect(prefs.reduceMotion).toBe(true);
  });

  it("stays off when the OS has no preference and no prefs file exists", async () => {
    mockSystemReducedMotion(false);
    const prefs = await freshStore(null);
    expect(prefs.reduceMotion).toBe(false);
  });

  it("a stored false outranks the OS — an explicit no is not overruled", async () => {
    mockSystemReducedMotion(true);
    const prefs = await freshStore({
      reduceMotion: false,
      confirmRenameLinks: false,
      sampleBannerDismissed: false,
    });
    expect(prefs.reduceMotion).toBe(false);
  });

  it("a legacy localStorage answer also outranks the OS", async () => {
    mockSystemReducedMotion(true);
    localStorage.setItem("grimoire-reduce-motion", "false");
    const prefs = await freshStore(null);
    expect(prefs.reduceMotion).toBe(false);
  });
});
