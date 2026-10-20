import { render, fireEvent, cleanup, within } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { userPrefersMode, resetMode } from "mode-watcher";
import { flushSync } from "svelte";
import AppShell from "../lib/components/AppShell.svelte";
import ThemeWatcher from "../lib/components/ThemeWatcher.svelte";
import { ledger } from "../lib/stores/ledger.svelte";
import { appPrefs } from "../lib/stores/app-prefs.svelte";
import { templates } from "../lib/stores/templates.svelte";
import { waitFor } from "@testing-library/svelte";

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
  // The rail is gone (#226) — Settings is a row in the sidebar footer, at every width.
  await fireEvent.click(result.getByTestId("sidebar-settings"));
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
  it("offers Dark, Light and System as one radio group", async () => {
    const { dialog } = await openSettingsDialog();
    expect(within(dialog).getByRole("radio", { name: /^dark$/i })).toBeTruthy();
    expect(within(dialog).getByRole("radio", { name: /^light$/i })).toBeTruthy();
    expect(within(dialog).getByRole("radio", { name: /^system$/i })).toBeTruthy();
  });

  it("clicking Light updates userPrefersMode to light", async () => {
    const { dialog } = await openSettingsDialog();
    await fireEvent.click(within(dialog).getByRole("radio", { name: /^light$/i }));
    expect(userPrefersMode.current).toBe("light");
  });

  it("clicking Dark updates userPrefersMode to dark", async () => {
    const { dialog } = await openSettingsDialog();
    await fireEvent.click(within(dialog).getByRole("radio", { name: /^dark$/i }));
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
    await fireEvent.click(within(dialog).getByRole("radio", { name: /^cozy$/i }));
    expect(ledger.density).toBe("cozy");
  });

  it("saves Dense with the app's own preferences, for every world", async () => {
    const invokeSpy = vi.mocked(invoke);
    invokeSpy.mockClear();
    const { dialog } = await openSettingsDialog();
    await fireEvent.click(within(dialog).getByRole("radio", { name: /^dense$/i }));
    const call = invokeSpy.mock.calls.find(([cmd]) => cmd === "save_app_prefs");
    expect(call?.[1]).toMatchObject({ prefs: { density: "dense" } });
  });

  it("moves the choice with the arrow keys, one Tab stop for the group", async () => {
    const { dialog } = await openSettingsDialog();
    const group = within(dialog).getByRole("radiogroup", { name: "Density" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1);

    const checked = radios.find((r) => r.getAttribute("aria-checked") === "true")!;
    await fireEvent.keyDown(checked, { key: "ArrowRight" });
    const next = radios[(radios.indexOf(checked) + 1) % radios.length];
    expect(next).toHaveAttribute("aria-checked", "true");
  });
});

// ── Scope, names and the panels ───────────────────────────────────

describe("settings dialog — what it says", () => {
  it("says the accent is this world's and the rest are every world's", async () => {
    const { dialog } = await openSettingsDialog();
    expect(within(dialog).getByText(/This world's colour/)).toBeTruthy();
    expect(within(dialog).getAllByText(/Every world\./).length).toBeGreaterThanOrEqual(3);
  });

  it("names the chosen accent, and groups the swatches under Accent", async () => {
    const { dialog } = await openSettingsDialog();
    expect(within(dialog).getByRole("radiogroup", { name: "Accent" })).toBeTruthy();
    expect(within(dialog).getByRole("radio", { name: "Crimson" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("shows focus on a section's panel, which was a Tab stop that drew nothing", async () => {
    const { dialog } = await openSettingsDialog();
    for (const panel of within(dialog).getAllByRole("tabpanel")) {
      expect(panel.className).toContain("focus-visible:outline-ring");
      expect(panel.className).not.toContain("outline-none");
    }
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

// ── Templates section ─────────────────────────────────────────────

describe("settings dialog — templates section", () => {
  // Templates now live under the "Content" section tab, so navigate there first.
  async function openContentTab() {
    const opened = await openSettingsDialog();
    await fireEvent.click(within(opened.dialog).getByTestId("settings-tab-content"));
    return opened;
  }

  it("exposes built-in templates controls under the Content tab", async () => {
    const { dialog } = await openContentTab();
    expect(within(dialog).getByText("Built-in templates")).toBeTruthy();
  });

  it("shows a 'Restore defaults' button", async () => {
    const { dialog } = await openContentTab();
    expect(within(dialog).getByTestId("restore-templates-btn")).toBeTruthy();
  });

  it("clicking restore shows a confirmation dialog before acting", async () => {
    const invokeSpy = vi.mocked(invoke);
    const { dialog } = await openContentTab();
    invokeSpy.mockClear();
    await fireEvent.click(within(dialog).getByTestId("restore-templates-btn"));
    // No command fired yet — confirmation is required first.
    expect(invokeSpy).not.toHaveBeenCalledWith("restore_builtin_templates");
    const confirm = await waitFor(() => {
      const btn = document.body.querySelector("[data-testid='restore-templates-confirm']");
      if (!btn) throw new Error("confirm button not found");
      return btn as HTMLElement;
    });
    expect(confirm).toBeTruthy();
  });

  it("confirming invokes restore_builtin_templates and reloads templates", async () => {
    const invokeSpy = vi.mocked(invoke);
    const loadSpy = vi.spyOn(templates, "load").mockResolvedValue(undefined);
    const { dialog } = await openContentTab();
    invokeSpy.mockClear();
    await fireEvent.click(within(dialog).getByTestId("restore-templates-btn"));
    const confirm = await waitFor(() => {
      const btn = document.body.querySelector("[data-testid='restore-templates-confirm']");
      if (!btn) throw new Error("confirm button not found");
      return btn as HTMLElement;
    });
    await fireEvent.click(confirm);
    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith("restore_builtin_templates");
    });
    await waitFor(() => {
      expect(loadSpy).toHaveBeenCalled();
    });
    loadSpy.mockRestore();
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
