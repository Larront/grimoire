import { render, fireEvent, waitFor, cleanup, act } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import AppShell from "../lib/components/AppShell.svelte";
import type { TemplateEntry } from "../lib/types/vault";

let mockTemplates: TemplateEntry[] = [];

vi.mock("../lib/stores/vault.svelte", () => ({
  vault: {
    get isOpen() { return true; },
    get path() { return "/vault"; },
    closeVault: vi.fn(),
    checkExistingVault: vi.fn(),
  },
}));

vi.mock("../lib/stores/notes.svelte", () => ({
  notes: { get notes() { return []; } },
}));

vi.mock("../lib/stores/maps.svelte", () => ({
  maps: { get maps() { return []; } },
}));

vi.mock("../lib/stores/scenes.svelte", () => ({
  scenes: {
    get scenes() { return []; },
    getSlots: vi.fn(() => Promise.resolve([])),
    load: vi.fn(),
  },
}));

vi.mock("../lib/stores/templates.svelte", () => ({
  templates: {
    get templates() { return mockTemplates; },
    get isLoading() { return false; },
    load: vi.fn(),
  },
}));

vi.mock("../lib/stores/tabs.svelte", () => ({
  tabs: {
    get left() { return { tabs: [], activeIndex: 0 }; },
    get right() { return null; },
    get focusedPane() { return "left"; },
    get dragging() { return null; },
    get activeTab() { return null; },
    openTab: vi.fn(),
    navigateOpen: vi.fn(),
    closeActiveTab: vi.fn(),
    closeTab: vi.fn(),
    setActiveIndex: vi.fn(),
    splitPane: vi.fn(),
    closeSplit: vi.fn(),
    moveTab: vi.fn(),
    focusPane: vi.fn(),
    updateTabTitle: vi.fn(),
    canGoBack: vi.fn(() => false),
    canGoForward: vi.fn(() => false),
    navigateBack: vi.fn(),
    navigateForward: vi.fn(),
    closeAll: vi.fn(),
  },
}));

vi.mock("../lib/stores/audio-engine.svelte", () => ({
  audioEngine: {
    get activeSceneId() { return null; },
    get loadingSceneId() { return null; },
    get isPlaying() { return false; },
    get isCrossfading() { return false; },
    get masterVolume() { return 1; },
    get slotStates() { return new Map(); },
    get analyserNode() { return null; },
    playScene: vi.fn(),
    stopAll: vi.fn(),
    setMasterVolume: vi.fn(),
    pauseSlot: vi.fn().mockResolvedValue(undefined),
    resumeSlot: vi.fn().mockResolvedValue(undefined),
    skipNext: vi.fn(),
    skipPrev: vi.fn(),
  },
}));

vi.mock("../lib/stores/right-rail.svelte", () => ({
  RightRailState: class {
    open = false;
    isMobile = false;
    openMobile = false;
    toggle() {}
    setOpenMobile(_v: boolean) {}
  },
}));

vi.mock("$lib/toast", () => ({
  toastUndo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

import { toastUndo } from "$lib/toast";

function makeTemplate(displayName: string, path: string): TemplateEntry {
  return { display_name: displayName, path };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

describe("AppSidebar — Templates section", () => {
  beforeEach(() => {
    mockTemplates = [];
  });

  it("renders the Templates section header", async () => {
    const { container } = render(AppShell);
    await flush();
    const labels = Array.from(container.querySelectorAll("[data-slot='sidebar-group-label']"));
    const templatesLabel = labels.find(el => el.textContent?.includes("Templates"));
    expect(templatesLabel).toBeTruthy();
  });

  it("shows a '+' button in the Templates section header", async () => {
    const { container } = render(AppShell);
    await flush();
    const addBtn = container.querySelector("[data-testid='new-template-btn']");
    expect(addBtn).toBeTruthy();
  });

  it("renders template display names when templates are present", async () => {
    mockTemplates = [
      makeTemplate("NPC", ".grimoire/templates/NPC.md"),
      makeTemplate("Location", ".grimoire/templates/Location.md"),
    ];
    const { container } = render(AppShell);
    await flush();
    expect(container.textContent).toContain("NPC");
    expect(container.textContent).toContain("Location");
  });

  it("renders an empty state when no templates exist", async () => {
    mockTemplates = [];
    const { container } = render(AppShell);
    await flush();
    expect(container.textContent).toContain("No templates yet");
  });

  it("triggers toastUndo when Delete Template is selected from context menu", async () => {
    mockTemplates = [makeTemplate("NPC", ".grimoire/templates/NPC.md")];
    const { container } = render(AppShell);
    await flush();

    const trigger = container.querySelector("[data-testid='template-row-NPC']");
    expect(trigger).toBeTruthy();
    await fireEvent.contextMenu(trigger!);

    const deleteItem = await waitFor(() => {
      const items = Array.from(
        document.body.querySelectorAll('[data-slot="context-menu-item"]'),
      );
      const item = items.find(el => el.textContent?.includes("Delete Template")) as HTMLElement | undefined;
      if (!item) throw new Error("Delete Template menu item not found");
      return item;
    });

    await fireEvent.click(deleteItem);
    expect(toastUndo).toHaveBeenCalledWith(
      expect.stringContaining("NPC"),
      expect.any(Function),
    );
  });
});
