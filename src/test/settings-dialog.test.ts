import { render, fireEvent, cleanup, within } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { userPrefersMode, resetMode } from "mode-watcher";
import { flushSync } from "svelte";
import AppShell from "../lib/components/AppShell.svelte";
import ThemeWatcher from "../lib/components/ThemeWatcher.svelte";
import { ledger } from "../lib/stores/ledger.svelte";
import { appPrefs } from "../lib/stores/app-prefs.svelte";

const desktopMatchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

afterEach(async () => {
  cleanup();
  ledger.setAccent("accent-crimson");
  ledger.setDensity("balanced");
  appPrefs.setReduceMotion(false);
  delete document.documentElement.dataset.reduceMotion;
  document.documentElement.style.cssText = "";
  document.documentElement.className = "";
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: desktopMatchMedia,
  });
  vi.mocked(invoke).mockResolvedValue(null);
  resetMode();
});

async function openSettingsDialog() {
  const result = render(AppShell);
  const rail = result.getByTestId("icon-rail");
  await fireEvent.click(
    within(rail).getByRole("button", { name: /^settings$/i }),
  );
  const dialog = await result.findByRole("dialog");
  return { ...result, dialog };
}

// ── Opening the dialog ────────────────────────────────────────────

describe("settings dialog — open", () => {
  it("clicking the settings icon in the icon rail opens the dialog", async () => {
    const { dialog } = await openSettingsDialog();
    expect(dialog).toBeTruthy();
  });
});

// ── Theme control ─────────────────────────────────────────────────

describe("settings dialog — theme", () => {
  it("shows Dark, Light, and System theme buttons", async () => {
    const { dialog } = await openSettingsDialog();
    expect(
      within(dialog).getByRole("button", { name: /^dark$/i }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: /^light$/i }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: /^system$/i }),
    ).toBeTruthy();
  });

  it("clicking Light updates userPrefersMode to light", async () => {
    const { dialog } = await openSettingsDialog();
    await fireEvent.click(
      within(dialog).getByRole("button", { name: /^light$/i }),
    );
    expect(userPrefersMode.current).toBe("light");
  });

  it("clicking Dark updates userPrefersMode to dark", async () => {
    const { dialog } = await openSettingsDialog();
    await fireEvent.click(
      within(dialog).getByRole("button", { name: /^dark$/i }),
    );
    expect(userPrefersMode.current).toBe("dark");
  });
});

// ── Accent control ────────────────────────────────────────────────

describe("settings dialog — accent", () => {
  it("renders all five accent preset swatches", async () => {
    const { dialog } = await openSettingsDialog();
    expect(within(dialog).getByTestId("accent-accent-crimson")).toBeTruthy();
    expect(within(dialog).getByTestId("accent-accent-arcane")).toBeTruthy();
    expect(within(dialog).getByTestId("accent-accent-verdant")).toBeTruthy();
    expect(within(dialog).getByTestId("accent-accent-ice")).toBeTruthy();
    expect(within(dialog).getByTestId("accent-accent-amber")).toBeTruthy();
  });

  it("clicking an accent swatch updates ledger.accent", async () => {
    const { dialog } = await openSettingsDialog();
    await fireEvent.click(within(dialog).getByTestId("accent-accent-arcane"));
    expect(ledger.accent).toBe("accent-arcane");
  });

  it("clicking an accent swatch calls invoke save_accent_preset", async () => {
    const invokeSpy = vi.mocked(invoke);
    invokeSpy.mockClear();
    const { dialog } = await openSettingsDialog();
    await fireEvent.click(within(dialog).getByTestId("accent-accent-verdant"));
    expect(invokeSpy).toHaveBeenCalledWith("save_accent_preset", {
      preset: "accent-verdant",
    });
  });
});

// ── Density control ───────────────────────────────────────────────

describe("settings dialog — density", () => {
  it("clicking Cozy updates ledger.density", async () => {
    const { dialog } = await openSettingsDialog();
    await fireEvent.click(
      within(dialog).getByRole("button", { name: /^cozy$/i }),
    );
    expect(ledger.density).toBe("cozy");
  });

  it("clicking Dense calls invoke save_density_level", async () => {
    const invokeSpy = vi.mocked(invoke);
    invokeSpy.mockClear();
    const { dialog } = await openSettingsDialog();
    await fireEvent.click(
      within(dialog).getByRole("button", { name: /^dense$/i }),
    );
    expect(invokeSpy).toHaveBeenCalledWith("save_density_level", {
      level: "dense",
    });
  });
});

// ── Reduce motion ─────────────────────────────────────────────────

describe("settings dialog — reduce motion", () => {
  it("renders the reduce motion toggle", async () => {
    const { dialog } = await openSettingsDialog();
    expect(within(dialog).getByTestId("reduce-motion-toggle")).toBeTruthy();
  });

  it("toggling reduce motion on updates appPrefs.reduceMotion", async () => {
    const { dialog } = await openSettingsDialog();
    await fireEvent.click(within(dialog).getByTestId("reduce-motion-toggle"));
    expect(appPrefs.reduceMotion).toBe(true);
  });

  it("toggling reduce motion off updates appPrefs.reduceMotion", async () => {
    appPrefs.setReduceMotion(true);
    const { dialog } = await openSettingsDialog();
    await fireEvent.click(within(dialog).getByTestId("reduce-motion-toggle"));
    expect(appPrefs.reduceMotion).toBe(false);
  });
});

// ── Graph section ─────────────────────────────────────────────────

describe("settings dialog — graph section", () => {
  function mockGraphInvoke(tags: string[], styles: Record<string, { color: string | null; hidden: boolean }>) {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_all_tags") return tags;
      if (cmd === "get_tag_graph_styles") return styles;
      return null;
    });
  }

  it("shows a 'Graph' section heading", async () => {
    mockGraphInvoke([], {});
    const { dialog } = await openSettingsDialog();
    expect(within(dialog).getByText(/^graph$/i)).toBeTruthy();
  });

  it("lists ledger tags in the graph section after loading", async () => {
    mockGraphInvoke(["npc", "creature"], {});
    const { dialog } = await openSettingsDialog();
    expect(await within(dialog).findByText("npc")).toBeTruthy();
    expect(within(dialog).getByText("creature")).toBeTruthy();
  });

  it("renders a visibility toggle per tag", async () => {
    mockGraphInvoke(["fire"], {});
    const { dialog } = await openSettingsDialog();
    await within(dialog).findByText("fire");
    expect(within(dialog).getByTestId("tag-visibility-fire")).toBeTruthy();
  });

  it("toggling visibility calls set_tag_graph_style with hidden=true", async () => {
    mockGraphInvoke(["npc"], {});
    const invokeSpy = vi.mocked(invoke);
    const { dialog } = await openSettingsDialog();
    await within(dialog).findByText("npc");
    invokeSpy.mockClear();
    await fireEvent.click(within(dialog).getByTestId("tag-visibility-npc"));
    expect(invokeSpy).toHaveBeenCalledWith("set_tag_graph_style", {
      tag: "npc",
      color: null,
      hidden: true,
    });
  });

  it("toggling visibility again calls set_tag_graph_style with hidden=false", async () => {
    mockGraphInvoke(["npc"], { npc: { color: null, hidden: true } });
    const invokeSpy = vi.mocked(invoke);
    const { dialog } = await openSettingsDialog();
    await within(dialog).findByText("npc");
    invokeSpy.mockClear();
    await fireEvent.click(within(dialog).getByTestId("tag-visibility-npc"));
    expect(invokeSpy).toHaveBeenCalledWith("set_tag_graph_style", {
      tag: "npc",
      color: null,
      hidden: false,
    });
  });

  it("renders a color input per tag", async () => {
    mockGraphInvoke(["fire"], {});
    const { dialog } = await openSettingsDialog();
    await within(dialog).findByText("fire");
    expect(within(dialog).getByTestId("tag-color-fire")).toBeTruthy();
  });

  it("changing color calls set_tag_graph_style with the new hex color", async () => {
    mockGraphInvoke(["fire"], {});
    const invokeSpy = vi.mocked(invoke);
    const { dialog } = await openSettingsDialog();
    await within(dialog).findByText("fire");
    invokeSpy.mockClear();
    await fireEvent.change(within(dialog).getByTestId("tag-color-fire"), {
      target: { value: "#cc3300" },
    });
    expect(invokeSpy).toHaveBeenCalledWith("set_tag_graph_style", {
      tag: "fire",
      color: "#cc3300",
      hidden: false,
    });
  });

  it("clear color button appears when a tag has a color set", async () => {
    mockGraphInvoke(["fire"], { fire: { color: "#cc3300", hidden: false } });
    const { dialog } = await openSettingsDialog();
    await within(dialog).findByText("fire");
    expect(within(dialog).getByTestId("tag-color-clear-fire")).toBeTruthy();
  });

  it("clear color button calls set_tag_graph_style with color=null", async () => {
    mockGraphInvoke(["fire"], { fire: { color: "#cc3300", hidden: false } });
    const invokeSpy = vi.mocked(invoke);
    const { dialog } = await openSettingsDialog();
    await within(dialog).findByText("fire");
    invokeSpy.mockClear();
    await fireEvent.click(within(dialog).getByTestId("tag-color-clear-fire"));
    expect(invokeSpy).toHaveBeenCalledWith("set_tag_graph_style", {
      tag: "fire",
      color: null,
      hidden: false,
    });
  });
});

// ── ThemeWatcher — reduce motion attribute ────────────────────────

describe("ThemeWatcher — reduce motion", () => {
  it('sets data-reduce-motion="true" when appPrefs.reduceMotion is true', () => {
    render(ThemeWatcher);
    flushSync(() => appPrefs.setReduceMotion(true));
    expect(document.documentElement.dataset.reduceMotion).toBe("true");
  });

  it("removes data-reduce-motion when appPrefs.reduceMotion is false", () => {
    document.documentElement.dataset.reduceMotion = "true";
    render(ThemeWatcher);
    flushSync(() => appPrefs.setReduceMotion(false));
    expect(document.documentElement.dataset.reduceMotion).toBeUndefined();
  });
});
