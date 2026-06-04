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

    const call = vi
      .mocked(invoke)
      .mock.calls.find(([cmd]) => cmd === "save_app_prefs");
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
    expect(localStorage.setItem).not.toHaveBeenCalledWith(
      "grimoire-reduce-motion",
      "true",
    );
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
    const saved = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "save_app_prefs");
    expect(saved.length).toBeGreaterThan(0);

    appPrefs.setReduceMotion(false);
    appPrefs.setSampleBannerDismissed(false);
  });

  it("load() is a one-shot — repeat calls do not re-fetch", async () => {
    await appPrefs.load();
    const fetches = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "get_app_prefs");
    expect(fetches.length).toBe(0);
  });
});
