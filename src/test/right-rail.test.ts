import { render, fireEvent, cleanup, act } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import AppShell from "../lib/components/AppShell.svelte";
import { overlay } from "../lib/stores/overlay.svelte";
import { tabs } from "../lib/stores/tabs.svelte";
import { notes } from "../lib/stores/notes.svelte";
import type { Note } from "../lib/types/vault";

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
  overlay.active = null;
  tabs.closeAll("right");
  tabs.closeAll("left");
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: desktopMatchMedia,
  });
  vi.mocked(invoke).mockResolvedValue(null);
});

// ── Right rail responsive behaviour ──────────────────────────────────────────

describe("right rail responsive behaviour", () => {
  it("right rail is docked at ≥1024px (not a Sheet)", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: desktopMatchMedia,
    });
    const { container } = render(AppShell);

    const dockedRail = container.querySelector(
      '[data-slot="right-rail"][data-mobile="false"]',
    );
    expect(dockedRail).toBeTruthy();
  });

  it("right rail trigger renders in the header when active tab is a note", () => {
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
    const { getByTestId } = render(AppShell);
    expect(getByTestId("right-rail-trigger")).toBeTruthy();
  });

  it("trigger toggles the docked rail closed and open on desktop", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: desktopMatchMedia,
    });
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
    const { container, getByTestId } = render(AppShell);

    const rail = container.querySelector(
      '[data-slot="right-rail"][data-mobile="false"]',
    )!;
    expect(rail.getAttribute("data-state")).toBe("closed");

    await fireEvent.click(getByTestId("right-rail-trigger"));
    expect(rail.getAttribute("data-state")).toBe("open");

    await fireEvent.click(getByTestId("right-rail-trigger"));
    expect(rail.getAttribute("data-state")).toBe("closed");
  });

  it("right rail opens as overlay at ≤1023px after trigger click", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: mobileMatchMedia,
    });
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
    const { getByTestId } = render(AppShell);

    await fireEvent.click(getByTestId("right-rail-trigger"));

    const overlayRail = document.body.querySelector(
      '[data-slot="right-rail"][data-mobile="true"]',
    );
    expect(overlayRail).toBeTruthy();
  });
});

// ── Overlay mutual exclusion on tablet (≤1023px) ─────────────────────────────

describe("overlay mutual exclusion on tablet (≤1023px)", () => {
  it("opening right rail overlay closes sidebar overlay", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: mobileMatchMedia,
    });
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
    const { getByTestId } = render(AppShell);

    // Open sidebar overlay first (Ctrl+\)
    await fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    expect(
      document.body.querySelector(
        '[data-mobile="true"][data-sidebar="sidebar"]',
      ),
    ).toBeTruthy();

    // Open right rail overlay
    await fireEvent.click(getByTestId("right-rail-trigger"));

    // Sidebar overlay should now be closed, right rail overlay open
    expect(
      document.body.querySelector(
        '[data-mobile="true"][data-sidebar="sidebar"]',
      ),
    ).toBeFalsy();
    expect(
      document.body.querySelector(
        '[data-slot="right-rail"][data-mobile="true"]',
      ),
    ).toBeTruthy();
  });

  it("opening sidebar overlay closes right rail overlay", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: mobileMatchMedia,
    });
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
    const { getByTestId } = render(AppShell);

    // Open right rail overlay first
    await fireEvent.click(getByTestId("right-rail-trigger"));
    expect(
      document.body.querySelector(
        '[data-slot="right-rail"][data-mobile="true"]',
      ),
    ).toBeTruthy();

    // Open sidebar overlay (Ctrl+\)
    await fireEvent.keyDown(window, { key: "\\", ctrlKey: true });

    // Right rail should now be closed, sidebar overlay open
    expect(
      document.body.querySelector(
        '[data-slot="right-rail"][data-mobile="true"]',
      ),
    ).toBeFalsy();
    expect(
      document.body.querySelector(
        '[data-mobile="true"][data-sidebar="sidebar"]',
      ),
    ).toBeTruthy();
  });

  it("on desktop (≥1024px) both panels are simultaneously docked", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: desktopMatchMedia,
    });
    const { container } = render(AppShell);

    const sidebar = container.querySelector(
      '[data-slot="sidebar"][data-state]',
    );
    const rail = container.querySelector('[data-slot="right-rail"]');

    expect(sidebar).toBeTruthy();
    expect(rail).toBeTruthy();
  });
});

// ── Rail visibility rule on non-note panes ────────────────────────────────────

describe("rail visibility on non-note panes", () => {
  it("toggle is hidden when active tab is a map pane", () => {
    tabs.openTab({ type: "map", id: 1, title: "World Map" });
    const { queryByTestId } = render(AppShell);
    expect(queryByTestId("right-rail-trigger")).toBeNull();
  });

  it("toggle is hidden when active tab is a scene pane", () => {
    tabs.openTab({ type: "scene", id: 1, title: "Chapter 1" });
    const { queryByTestId } = render(AppShell);
    expect(queryByTestId("right-rail-trigger")).toBeNull();
  });

  it("toggle is hidden when active tab is a scenes dashboard", () => {
    tabs.openTab({ type: "scenes", id: 0, title: "Scenes" });
    const { queryByTestId } = render(AppShell);
    expect(queryByTestId("right-rail-trigger")).toBeNull();
  });

  it("toggle is hidden when there are no tabs", () => {
    const { queryByTestId } = render(AppShell);
    expect(queryByTestId("right-rail-trigger")).toBeNull();
  });

  it("toggle is visible when active tab is a note", () => {
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
    const { queryByTestId } = render(AppShell);
    expect(queryByTestId("right-rail-trigger")).not.toBeNull();
  });

  it("desktop rail has data-state=closed on a map pane", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: desktopMatchMedia,
    });
    tabs.openTab({ type: "map", id: 1, title: "World Map" });
    const { container } = render(AppShell);
    const rail = container.querySelector(
      '[data-slot="right-rail"][data-mobile="false"]',
    )!;
    expect(rail.getAttribute("data-state")).toBe("closed");
  });

  it("desktop rail collapses when switching from note to map pane", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: desktopMatchMedia,
    });
    tabs.openTab({ type: "note", id: 1, title: "Note" });
    const { container, getByTestId } = render(AppShell);

    await fireEvent.click(getByTestId("right-rail-trigger"));
    const rail = container.querySelector(
      '[data-slot="right-rail"][data-mobile="false"]',
    )!;
    expect(rail.getAttribute("data-state")).toBe("open");

    await act(() => {
      tabs.openTab({ type: "map", id: 2, title: "Map" });
    });
    expect(rail.getAttribute("data-state")).toBe("closed");
  });

  it("desktop rail re-opens when switching back to note pane", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: desktopMatchMedia,
    });
    tabs.openTab({ type: "note", id: 1, title: "Note" });
    const { container, getByTestId } = render(AppShell);

    await fireEvent.click(getByTestId("right-rail-trigger"));

    await act(() => {
      tabs.openTab({ type: "map", id: 2, title: "Map" });
    });
    await act(() => {
      tabs.openTab({ type: "note", id: 1, title: "Note" });
    });

    const rail = container.querySelector(
      '[data-slot="right-rail"][data-mobile="false"]',
    )!;
    expect(rail.getAttribute("data-state")).toBe("open");
  });

  it("in split view, toggle is hidden when focused pane is map", () => {
    tabs.openTab({ type: "note", id: 1, title: "Note" });
    tabs.openTab({ type: "map", id: 1, title: "Map" }, "right");
    // After opening right pane with map, focusedPane = "right"
    const { queryByTestId } = render(AppShell);
    expect(queryByTestId("right-rail-trigger")).toBeNull();
  });

  it("in split view, toggle is shown when focused pane is note", () => {
    tabs.openTab({ type: "note", id: 1, title: "Note" });
    tabs.openTab({ type: "map", id: 1, title: "Map" }, "right");
    tabs.setFocusedPane("left"); // focus the note pane
    const { queryByTestId } = render(AppShell);
    expect(queryByTestId("right-rail-trigger")).not.toBeNull();
  });

  it("mobile toggle is absent on a non-note pane (rail cannot be opened)", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: mobileMatchMedia,
    });
    tabs.openTab({ type: "map", id: 1, title: "World Map" });
    const { queryByTestId } = render(AppShell);
    expect(queryByTestId("right-rail-trigger")).toBeNull();
  });
});

// ── Right rail — Aliases section ──────────────────────────────────────────────

const testNote: Note = {
  id: 1,
  path: "Characters/Aldric.md",
  title: "Aldric",
  icon: null,
  cover_image: null,
  parent_path: "Characters",
  archived: false,
  modified_at: "2026-01-01T00:00:00Z",
};

async function openRailWithNote(
  invokeImpl: (cmd: string, args?: unknown) => unknown,
) {
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "read_note_content") return "";
    return invokeImpl(cmd, args);
  });
  tabs.openTab({ type: "note", id: 1, title: "Aldric" });
  await act(() => notes.load());
  const result = render(AppShell);
  // Open the rail on desktop
  await fireEvent.click(result.getByTestId("right-rail-trigger"));
  return result;
}

describe("right rail — aliases section", () => {
  it("aliases section appears in the details pane when a note is active", async () => {
    const { container } = await openRailWithNote(async (cmd: string) => {
      if (cmd === "get_notes") return [testNote];
      if (cmd === "get_note_aliases") return ["Captain Ash"];
      if (cmd === "read_note_tags") return [];
      if (cmd === "list_all_tags") return [];
      if (cmd === "get_alias_collisions") return [];
      return null;
    });
    await act(() => {});
    expect(container.querySelector('[data-section="aliases"]')).toBeTruthy();
  });

  it("aliases section renders chips from get_note_aliases", async () => {
    const { container } = await openRailWithNote(async (cmd: string) => {
      if (cmd === "get_notes") return [testNote];
      if (cmd === "get_note_aliases") return ["Captain Ash", "The Hero"];
      if (cmd === "read_note_tags") return [];
      if (cmd === "list_all_tags") return [];
      if (cmd === "get_alias_collisions") return [];
      return null;
    });
    await act(() => {});
    const chips = container.querySelectorAll('[data-slot="alias-chip"]');
    expect(chips.length).toBe(2);
  });

  it("collision warning appears when get_alias_collisions returns a collision", async () => {
    const { container } = await openRailWithNote(async (cmd: string) => {
      if (cmd === "get_notes") return [testNote];
      if (cmd === "get_note_aliases") return ["Captain Ash"];
      if (cmd === "read_note_tags") return [];
      if (cmd === "list_all_tags") return [];
      if (cmd === "get_alias_collisions")
        return [{ alias: "Captain Ash", other_note_id: 2, other_note_title: "Ash Note" }];
      return null;
    });
    await act(() => {});
    const warning = container.querySelector('[data-slot="alias-collision-warning"]');
    expect(warning).toBeTruthy();
    expect(warning!.textContent).toContain("Captain Ash");
    expect(warning!.textContent).toContain("Ash Note");
  });

  it("no collision warning when get_alias_collisions returns empty", async () => {
    const { container } = await openRailWithNote(async (cmd: string) => {
      if (cmd === "get_notes") return [testNote];
      if (cmd === "get_note_aliases") return ["Captain Ash"];
      if (cmd === "read_note_tags") return [];
      if (cmd === "list_all_tags") return [];
      if (cmd === "get_alias_collisions") return [];
      return null;
    });
    await act(() => {});
    expect(
      container.querySelector('[data-slot="alias-collision-warning"]'),
    ).toBeNull();
  });

  it("aliases section is positioned between tags and folder sections", async () => {
    const { container } = await openRailWithNote(async (cmd: string) => {
      if (cmd === "get_notes") return [testNote];
      if (cmd === "get_note_aliases") return [];
      if (cmd === "read_note_tags") return [];
      if (cmd === "list_all_tags") return [];
      if (cmd === "get_alias_collisions") return [];
      return null;
    });
    await act(() => {});
    const sections = container.querySelectorAll("[data-section]");
    const sectionNames = Array.from(sections).map((s) =>
      s.getAttribute("data-section"),
    );
    const tagsIdx = sectionNames.indexOf("tags");
    const aliasesIdx = sectionNames.indexOf("aliases");
    const folderIdx = sectionNames.indexOf("folder");
    expect(tagsIdx).toBeGreaterThanOrEqual(0);
    expect(aliasesIdx).toBeGreaterThan(tagsIdx);
    expect(folderIdx).toBeGreaterThan(aliasesIdx);
  });
});
