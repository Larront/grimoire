import { render, fireEvent, cleanup, within } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import AppShell from "../lib/components/AppShell.svelte";
import VaultSelector from "../lib/components/sidebar/VaultSelector.svelte";
import { vault } from "../lib/stores/vault.svelte";

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

const mobileMatchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: true,
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
  await vault.closeVault();
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: desktopMatchMedia,
  });
  vi.mocked(invoke).mockResolvedValue(null);
});

// ── Sidebar responsive behaviour ─────────────────────────────────────────────

describe("sidebar responsive behaviour", () => {
  it("sidebar renders in docked mode at ≥1024px (desktop div, not Sheet)", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: desktopMatchMedia,
    });
    const { container } = render(AppShell);

    // Desktop: renders a plain div with data-slot="sidebar" that has data-state (not a Sheet)
    const desktopSidebar = container.querySelector(
      '[data-slot="sidebar"][data-state]',
    );
    expect(desktopSidebar).toBeTruthy();
  });

  it("sidebar renders as overlay sheet at ≤1023px (Sheet content present after toggle)", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: mobileMatchMedia,
    });
    render(AppShell);

    // Ctrl+\ opens the mobile sheet overlay
    await fireEvent.keyDown(window, { key: "\\", ctrlKey: true });

    // Sheet.Content renders with data-mobile="true" when open
    const mobileSidebar = document.body.querySelector('[data-mobile="true"]');
    expect(mobileSidebar).toBeTruthy();
  });
});

// ── Vault selector ────────────────────────────────────────────────────────────

describe("vault selector", () => {
  beforeEach(async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_vault_path") return "/Users/test/MyVault";
      if (cmd === "get_accent_preset") return null;
      if (cmd === "get_density_level") return null;
      if (cmd === "get_recent_vaults")
        return [
          {
            name: "MyVault",
            path: "/Users/test/MyVault",
            note_count: 5,
            scene_count: 2,
            map_count: 1,
            last_opened: "2025-01-01T00:00:00Z",
          },
          {
            name: "OtherVault",
            path: "/Users/test/OtherVault",
            note_count: 0,
            scene_count: 0,
            map_count: 0,
            last_opened: "2025-01-02T00:00:00Z",
          },
        ];
      return null;
    });
    await vault.checkExistingVault();
  });

  it("shows the current vault name", () => {
    const { getByText } = render(VaultSelector);
    expect(getByText("MyVault")).toBeTruthy();
  });

  it("popover opens on click and lists available vaults", async () => {
    const { getByRole, findByText } = render(VaultSelector);
    const trigger = getByRole("button", { name: /vault selector/i });
    await fireEvent.click(trigger);

    expect(await findByText("OtherVault")).toBeTruthy();
    expect(await findByText("Open new vault")).toBeTruthy();
  });
});

// ── Icon rail ─────────────────────────────────────────────────────────────────

describe("icon rail", () => {
  it("renders a Files button in the icon rail", () => {
    const { getByTestId } = render(AppShell);
    const rail = getByTestId("icon-rail");
    // The rail button is scoped within the rail to avoid collision
    // with the sidebar's "Files" collapsible trigger
    const filesBtn = within(rail).getByRole("button", { name: /^files$/i });
    expect(filesBtn).toBeTruthy();
  });

});
