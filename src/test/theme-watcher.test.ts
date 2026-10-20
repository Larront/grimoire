import { render, cleanup } from "@testing-library/svelte";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { setMode, resetMode } from "mode-watcher";
import { flushSync } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import ThemeWatcher from "../lib/components/ThemeWatcher.svelte";
import { ledger } from "../lib/stores/ledger.svelte";

afterEach(() => {
  cleanup();
  ledger.setAccent("accent-crimson");
  ledger.setDensity("balanced");
  document.documentElement.style.cssText = "";
  document.documentElement.className = "";
  delete document.documentElement.dataset.density;
});

// ── Ledger store — density ────────────────────────────────────────

describe("ledger store — density default", () => {
  it("density defaults to balanced", () => {
    expect(ledger.density).toBe("balanced");
  });
});

// Density is app-wide since the 2026-10 design review: it is about the GM's screen, and a
// world used to open at whatever density it had been left in.
describe("density — app-wide", () => {
  it("is saved with the app's own preferences, not the world's", () => {
    const invokeSpy = vi.mocked(invoke);
    invokeSpy.mockClear();
    ledger.setDensity("dense");
    const call = invokeSpy.mock.calls.find(([cmd]) => cmd === "save_app_prefs");
    expect(call?.[1]).toMatchObject({ prefs: { density: "dense" } });
    expect(invokeSpy).not.toHaveBeenCalledWith("save_density_level", expect.anything());
  });

  it("survives closing the world", async () => {
    ledger.setDensity("cozy");
    await ledger.closeLedger();
    expect(ledger.density).toBe("cozy");
  });

  it("keeps the GM's choice when a world opens with a density of its own", async () => {
    ledger.setDensity("dense");
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_ledger_path") return "/some/ledger";
      if (cmd === "get_density_level") return "cozy";
      return null;
    });
    await ledger.checkExistingLedger();
    expect(ledger.density).toBe("dense");
    vi.mocked(invoke).mockResolvedValue(null);
  });

  it("adopts a world's old density the first time, before any is chosen", async () => {
    // So a GM who had chosen Dense does not find the app suddenly Balanced.
    vi.resetModules();
    const { appPrefs } = await import("../lib/stores/app-prefs.svelte");
    expect(appPrefs.density).toBe("balanced");
    appPrefs.adoptDensity("cozy");
    expect(appPrefs.density).toBe("cozy");
    appPrefs.adoptDensity("dense");
    expect(appPrefs.density).toBe("cozy");
  });
});

// ── ThemeWatcher — density attribute ────────────────────────────

describe("ThemeWatcher — data-density attribute", () => {
  it("sets data-density to balanced on mount", () => {
    render(ThemeWatcher);
    expect(document.documentElement.dataset.density).toBe("balanced");
  });

  it("updates data-density immediately when density changes", () => {
    render(ThemeWatcher);
    flushSync(() => ledger.setDensity("dense"));
    expect(document.documentElement.dataset.density).toBe("dense");
  });
});

// ── ThemeWatcher — accent (dark mode default) ────────────────────

/*
  The contract these assert is "the accent is a class, in both modes, and never an inline
  style". It used to be a class in light and four inline properties in dark, which meant
  the preset values existed both in `app.css` and in a table inside ThemeWatcher with
  nothing holding the two in step.

  So the dark-mode cases below deliberately do NOT assert a hex. Asserting `#5c9e6e` here
  is what made the old duplication look tested: the test read the same table the
  component did, and would have gone on passing while the stylesheet said something else
  entirely. The class is the whole of the component's job; what the class resolves to is
  the stylesheet's, and `expect(style).toBe("")` is the assertion that keeps it there.
*/
describe("ThemeWatcher — dark mode (default)", () => {
  it("applies the accent as a class, not an inline style", () => {
    render(ThemeWatcher);
    expect(document.documentElement.classList.contains("accent-crimson")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("");
  });

  it("swaps class immediately when preset switches", () => {
    render(ThemeWatcher);
    flushSync(() => ledger.setAccent("accent-verdant"));
    expect(document.documentElement.classList.contains("accent-verdant")).toBe(true);
    expect(document.documentElement.classList.contains("accent-crimson")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("");
  });
});

describe("ThemeWatcher — light mode", () => {
  beforeEach(() => setMode("light"));
  afterEach(() => resetMode());

  it("applies accent-crimson class on root with no inline --primary", () => {
    render(ThemeWatcher);
    expect(document.documentElement.classList.contains("accent-crimson")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("");
  });

  it("swaps class when preset switches", () => {
    render(ThemeWatcher);
    flushSync(() => ledger.setAccent("accent-arcane"));
    expect(document.documentElement.classList.contains("accent-arcane")).toBe(true);
    expect(document.documentElement.classList.contains("accent-crimson")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("");
  });

  it("leaves exactly one accent class on the root", () => {
    render(ThemeWatcher);
    flushSync(() => ledger.setAccent("accent-ice"));
    const applied = [...document.documentElement.classList].filter((c) => c.startsWith("accent-"));
    expect(applied).toEqual(["accent-ice"]);
  });
});

// ── ledger store — accent persistence (migrated) ──────────────────

describe("ledger store — accent persistence", () => {
  afterEach(() => ledger.setAccent("accent-crimson"));

  it("calls invoke save_accent_preset when preset changes", () => {
    const invokeSpy = vi.mocked(invoke);
    invokeSpy.mockClear();
    ledger.setAccent("accent-amber");
    expect(invokeSpy).toHaveBeenCalledWith("save_accent_preset", {
      preset: "accent-amber",
    });
  });

  it("restores saved accent preset on checkExistingLedger", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_ledger_path") return "/some/ledger";
      if (cmd === "get_accent_preset") return "accent-arcane";
      return null;
    });
    await ledger.checkExistingLedger();
    expect(ledger.accent).toBe("accent-arcane");
    vi.mocked(invoke).mockResolvedValue(null);
  });
});
