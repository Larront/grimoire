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

describe("ledger store — density persistence", () => {
  it("calls invoke save_density_level when density changes", () => {
    const invokeSpy = vi.mocked(invoke);
    invokeSpy.mockClear();
    ledger.setDensity("dense");
    expect(invokeSpy).toHaveBeenCalledWith("save_density_level", {
      level: "dense",
    });
  });

  it("resets density to balanced on closeLedger", async () => {
    ledger.setDensity("cozy");
    expect(ledger.density).toBe("cozy");
    await ledger.closeLedger();
    expect(ledger.density).toBe("balanced");
  });

  it("restores saved density level on checkExistingLedger", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_ledger_path") return "/some/ledger";
      if (cmd === "get_density_level") return "cozy";
      return null;
    });
    await ledger.checkExistingLedger();
    expect(ledger.density).toBe("cozy");
    vi.mocked(invoke).mockResolvedValue(null);
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

describe("ThemeWatcher — dark mode (default)", () => {
  it("applies crimson --primary inline style on root", () => {
    render(ThemeWatcher);
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
      "#c2483d",
    );
  });

  it("updates --primary immediately when preset switches", () => {
    render(ThemeWatcher);
    flushSync(() => ledger.setAccent("accent-verdant"));
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
      "#5c9e6e",
    );
  });
});

describe("ThemeWatcher — light mode", () => {
  beforeEach(() => setMode("light"));
  afterEach(() => resetMode());

  it("applies accent-crimson class on root with no inline --primary", () => {
    render(ThemeWatcher);
    expect(document.documentElement.classList.contains("accent-crimson")).toBe(
      true,
    );
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
      "",
    );
  });

  it("swaps class when preset switches", () => {
    render(ThemeWatcher);
    flushSync(() => ledger.setAccent("accent-arcane"));
    expect(document.documentElement.classList.contains("accent-arcane")).toBe(
      true,
    );
    expect(document.documentElement.classList.contains("accent-crimson")).toBe(
      false,
    );
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
      "",
    );
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
