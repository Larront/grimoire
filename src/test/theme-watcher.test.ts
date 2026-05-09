import { render, cleanup } from "@testing-library/svelte";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { setMode, resetMode } from "mode-watcher";
import { flushSync } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import ThemeWatcher from "../lib/components/ThemeWatcher.svelte";
import { vault } from "../lib/stores/vault.svelte";

afterEach(() => {
  cleanup();
  vault.setAccent("accent-crimson");
  vault.setDensity("balanced");
  document.documentElement.style.cssText = "";
  document.documentElement.className = "";
  delete document.documentElement.dataset.density;
});

// ── Vault store — density ────────────────────────────────────────

describe("vault store — density default", () => {
  it("density defaults to balanced", () => {
    expect(vault.density).toBe("balanced");
  });
});

describe("vault store — density persistence", () => {
  it("calls invoke save_density_level when density changes", () => {
    const invokeSpy = vi.mocked(invoke);
    invokeSpy.mockClear();
    vault.setDensity("dense");
    expect(invokeSpy).toHaveBeenCalledWith("save_density_level", {
      level: "dense",
    });
  });

  it("resets density to balanced on closeVault", async () => {
    vault.setDensity("cozy");
    expect(vault.density).toBe("cozy");
    await vault.closeVault();
    expect(vault.density).toBe("balanced");
  });

  it("restores saved density level on checkExistingVault", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_vault_path") return "/some/vault";
      if (cmd === "get_density_level") return "cozy";
      return null;
    });
    await vault.checkExistingVault();
    expect(vault.density).toBe("cozy");
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
    flushSync(() => vault.setDensity("dense"));
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
    flushSync(() => vault.setAccent("accent-verdant"));
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
    flushSync(() => vault.setAccent("accent-arcane"));
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

// ── vault store — accent persistence (migrated) ──────────────────

describe("vault store — accent persistence", () => {
  afterEach(() => vault.setAccent("accent-crimson"));

  it("calls invoke save_accent_preset when preset changes", () => {
    const invokeSpy = vi.mocked(invoke);
    invokeSpy.mockClear();
    vault.setAccent("accent-amber");
    expect(invokeSpy).toHaveBeenCalledWith("save_accent_preset", {
      preset: "accent-amber",
    });
  });

  it("restores saved accent preset on checkExistingVault", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_vault_path") return "/some/vault";
      if (cmd === "get_accent_preset") return "accent-arcane";
      return null;
    });
    await vault.checkExistingVault();
    expect(vault.accent).toBe("accent-arcane");
    vi.mocked(invoke).mockResolvedValue(null);
  });
});
