import { render, fireEvent, cleanup, act } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import AppShell from "../lib/components/AppShell.svelte";
import { overlay } from "../lib/stores/overlay.svelte";
import { tabs } from "../lib/stores/tabs.svelte";
import { notes } from "../lib/stores/notes.svelte";
import { linksTick } from "../lib/stores/links-tick.svelte";
import type { Note } from "../lib/types/ledger";

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
    // Rail only renders when a note pane is active
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
    const { container } = render(AppShell);

    const dockedRail = container.querySelector(
      '[data-slot="right-rail"][data-mobile="false"]',
    );
    expect(dockedRail).toBeTruthy();
  });

  it("right rail trigger renders in the header when active tab is a note", () => {
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
    const { getByTestId } = render(AppShell);
    expect(getByTestId("left-rail-trigger")).toBeTruthy();
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

    await fireEvent.click(getByTestId("left-rail-trigger"));
    expect(rail.getAttribute("data-state")).toBe("open");

    await fireEvent.click(getByTestId("left-rail-trigger"));
    expect(rail.getAttribute("data-state")).toBe("closed");
  });

  it("right rail opens as overlay at ≤1023px after trigger click", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: mobileMatchMedia,
    });
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
    const { getByTestId } = render(AppShell);

    await fireEvent.click(getByTestId("left-rail-trigger"));

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
    await fireEvent.click(getByTestId("left-rail-trigger"));

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
    await fireEvent.click(getByTestId("left-rail-trigger"));
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
    // Rail only renders inside NotePane, so we need an active note tab
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
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
    expect(queryByTestId("left-rail-trigger")).toBeNull();
    expect(queryByTestId("right-rail-trigger")).toBeNull();
  });

  it("toggle is hidden when active tab is a scene pane", () => {
    tabs.openTab({ type: "scene", id: 1, title: "Chapter 1" });
    const { queryByTestId } = render(AppShell);
    expect(queryByTestId("left-rail-trigger")).toBeNull();
    expect(queryByTestId("right-rail-trigger")).toBeNull();
  });

  it("toggle is hidden when active tab is a scenes dashboard", () => {
    tabs.openTab({ type: "scenes", id: 0, title: "Scenes" });
    const { queryByTestId } = render(AppShell);
    expect(queryByTestId("left-rail-trigger")).toBeNull();
    expect(queryByTestId("right-rail-trigger")).toBeNull();
  });

  it("toggle is hidden when there are no tabs", () => {
    const { queryByTestId } = render(AppShell);
    expect(queryByTestId("left-rail-trigger")).toBeNull();
    expect(queryByTestId("right-rail-trigger")).toBeNull();
  });

  it("left-pane toggle is visible when active tab is a note", () => {
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
    const { queryByTestId } = render(AppShell);
    expect(queryByTestId("left-rail-trigger")).not.toBeNull();
  });

  it("desktop rail has data-state=closed on a map pane", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: desktopMatchMedia,
    });
    // With the new architecture, the rail lives inside NotePane, so when the
    // active tab is a map pane (no NotePane rendered), the rail is not in the DOM.
    tabs.openTab({ type: "map", id: 1, title: "World Map" });
    const { container } = render(AppShell);
    const rail = container.querySelector(
      '[data-slot="right-rail"][data-mobile="false"]',
    );
    expect(rail).toBeNull();
  });

  it("desktop rail collapses when switching from note to map pane", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: desktopMatchMedia,
    });
    tabs.openTab({ type: "note", id: 1, title: "Note" });
    const { container, getByTestId } = render(AppShell);

    // Open the rail while on the note pane
    await fireEvent.click(getByTestId("left-rail-trigger"));
    const railWhileNote = container.querySelector(
      '[data-slot="right-rail"][data-mobile="false"]',
    )!;
    expect(railWhileNote.getAttribute("data-state")).toBe("open");

    // Switch to a map pane — NotePane is unmounted, so the rail element leaves the DOM
    await act(() => {
      tabs.openTab({ type: "map", id: 2, title: "Map" });
    });
    const railAfterSwitch = container.querySelector(
      '[data-slot="right-rail"][data-mobile="false"]',
    );
    expect(railAfterSwitch).toBeNull();
  });

  it("desktop rail re-opens when switching back to note pane", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: desktopMatchMedia,
    });
    tabs.openTab({ type: "note", id: 1, title: "Note" });
    const { container, getByTestId } = render(AppShell);

    // Open the rail on the note pane — the RightRailState in AppShell records open=true
    await fireEvent.click(getByTestId("left-rail-trigger"));

    // Switch to map (NotePane unmounts, rail leaves DOM, but leftRail.open stays true)
    await act(() => {
      tabs.openTab({ type: "map", id: 2, title: "Map" });
    });

    // Switch back to note — NotePane re-mounts and renders the rail using leftRail.open
    await act(() => {
      tabs.openTab({ type: "note", id: 1, title: "Note" });
    });

    // leftRail.open is still true, so the re-mounted rail should be open
    const rail = container.querySelector(
      '[data-slot="right-rail"][data-mobile="false"]',
    )!;
    expect(rail.getAttribute("data-state")).toBe("open");
  });

  it("in split view with note left + map right, only left-rail-trigger is shown regardless of focus", () => {
    tabs.openTab({ type: "note", id: 1, title: "Note" });
    tabs.openTab({ type: "map", id: 1, title: "Map" }, "right");
    // Right pane (map) is now focused — left-pane trigger still appears independently
    const { queryByTestId } = render(AppShell);
    expect(queryByTestId("left-rail-trigger")).not.toBeNull();
    expect(queryByTestId("right-rail-trigger")).toBeNull();
  });

  it("in split view with note in both panes, both rail triggers are visible", () => {
    tabs.openTab({ type: "note", id: 1, title: "Note" });
    tabs.openTabOpposite({ type: "note", id: 2, title: "Other Note" });
    const { queryByTestId } = render(AppShell);
    expect(queryByTestId("left-rail-trigger")).not.toBeNull();
    expect(queryByTestId("right-rail-trigger")).not.toBeNull();
  });

  it("in split view, left-rail-trigger shows even when right pane is focused", () => {
    tabs.openTab({ type: "note", id: 1, title: "Note" });
    tabs.openTabOpposite({ type: "note", id: 2, title: "Other Note" });
    tabs.setFocusedPane("right");
    const { queryByTestId } = render(AppShell);
    expect(queryByTestId("left-rail-trigger")).not.toBeNull();
  });

  it("mobile toggle is absent on a non-note pane (rail cannot be opened)", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: mobileMatchMedia,
    });
    tabs.openTab({ type: "map", id: 1, title: "World Map" });
    const { queryByTestId } = render(AppShell);
    expect(queryByTestId("left-rail-trigger")).toBeNull();
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
  // Open the rail on desktop (note is in left pane)
  await fireEvent.click(result.getByTestId("left-rail-trigger"));
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
      if (cmd === "get_backlinks") return [];
      if (cmd === "get_outbound_links") return [];
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

// ── Right rail — Backlinks section ───────────────────────────────────────────

const defaultInvokeImpl = async (cmd: string) => {
  if (cmd === "get_notes") return [testNote];
  if (cmd === "read_note_tags") return [];
  if (cmd === "list_all_tags") return [];
  if (cmd === "get_note_aliases") return [];
  if (cmd === "get_alias_collisions") return [];
  if (cmd === "get_backlinks") return [];
  if (cmd === "get_outbound_links") return [];
  return null;
};

describe("right rail — backlinks section", () => {
  it("backlinks section appears in the details pane when a note is active", async () => {
    const { container } = await openRailWithNote(defaultInvokeImpl);
    await act(() => {});
    expect(container.querySelector('[data-section="backlinks"]')).toBeTruthy();
  });

  it("backlinks empty state shows 'No backlinks yet'", async () => {
    const { container } = await openRailWithNote(defaultInvokeImpl);
    await act(() => {});
    const section = container.querySelector('[data-section="backlinks"]')!;
    expect(section.textContent).toContain("No backlinks yet");
  });

  it("backlinks renders rows from get_backlinks", async () => {
    const backlinksData = [
      { id: 2, path: "Characters/Bard.md", title: "Bard" },
      { id: 3, path: "Places/Inn.md", title: "Inn" },
    ];
    const { container } = await openRailWithNote(async (cmd: string) => {
      if (cmd === "get_backlinks") return backlinksData;
      return defaultInvokeImpl(cmd);
    });
    await act(() => {});
    const rows = container.querySelectorAll('[data-slot="backlink-row"]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain("Bard");
    expect(rows[1].textContent).toContain("Inn");
  });

  it("backlinks row shows folder path below title", async () => {
    const { container } = await openRailWithNote(async (cmd: string) => {
      if (cmd === "get_backlinks") return [{ id: 2, path: "Characters/Bard.md", title: "Bard" }];
      return defaultInvokeImpl(cmd);
    });
    await act(() => {});
    const folderEl = container.querySelector('[data-slot="backlink-row"] [data-slot="link-folder"]');
    expect(folderEl).toBeTruthy();
    expect(folderEl!.textContent).toContain("Characters");
  });

  it("backlinks caps at 5 rows when there are more than 5", async () => {
    const backlinksData = Array.from({ length: 8 }, (_, i) => ({
      id: i + 2,
      path: `Notes/Note${i}.md`,
      title: `Note ${i}`,
    }));
    const { container } = await openRailWithNote(async (cmd: string) => {
      if (cmd === "get_backlinks") return backlinksData;
      return defaultInvokeImpl(cmd);
    });
    await act(() => {});
    const rows = container.querySelectorAll('[data-slot="backlink-row"]');
    expect(rows.length).toBe(5);
  });

  it("backlinks shows 'Show N more' expand button when capped", async () => {
    const backlinksData = Array.from({ length: 8 }, (_, i) => ({
      id: i + 2,
      path: `Notes/Note${i}.md`,
      title: `Note ${i}`,
    }));
    const { container } = await openRailWithNote(async (cmd: string) => {
      if (cmd === "get_backlinks") return backlinksData;
      return defaultInvokeImpl(cmd);
    });
    await act(() => {});
    const expandBtn = container.querySelector('[data-slot="backlinks-expand"]');
    expect(expandBtn).toBeTruthy();
    expect(expandBtn!.textContent).toContain("3 more");
  });

  it("backlinks expand button shows all rows when clicked", async () => {
    const backlinksData = Array.from({ length: 7 }, (_, i) => ({
      id: i + 2,
      path: `Notes/Note${i}.md`,
      title: `Note ${i}`,
    }));
    const { container } = await openRailWithNote(async (cmd: string) => {
      if (cmd === "get_backlinks") return backlinksData;
      return defaultInvokeImpl(cmd);
    });
    await act(() => {});
    const expandBtn = container.querySelector('[data-slot="backlinks-expand"]')!;
    await fireEvent.click(expandBtn);
    const rows = container.querySelectorAll('[data-slot="backlink-row"]');
    expect(rows.length).toBe(7);
  });

  it("clicking a backlink row navigates to that note", async () => {
    const { container } = await openRailWithNote(async (cmd: string) => {
      if (cmd === "get_backlinks") return [{ id: 2, path: "Characters/Bard.md", title: "Bard" }];
      return defaultInvokeImpl(cmd);
    });
    await act(() => {});
    const row = container.querySelector('[data-slot="backlink-row"]') as HTMLElement;
    await fireEvent.click(row);
    expect(tabs.activeTab).toMatchObject({ type: "note", id: 2 });
  });
});

// ── Right rail — Outbound Links section ──────────────────────────────────────

describe("right rail — outbound links section", () => {
  it("outbound section appears in the details pane when a note is active", async () => {
    const { container } = await openRailWithNote(defaultInvokeImpl);
    await act(() => {});
    expect(container.querySelector('[data-section="outbound"]')).toBeTruthy();
  });

  it("outbound empty state shows 'No outbound links'", async () => {
    const { container } = await openRailWithNote(defaultInvokeImpl);
    await act(() => {});
    const section = container.querySelector('[data-section="outbound"]')!;
    expect(section.textContent).toContain("No outbound links");
  });

  it("outbound renders resolved link rows", async () => {
    const outboundData = [
      {
        target_path: "Characters/Bard.md",
        resolved_id: 2,
        resolved_title: "Bard",
        resolved_path: "Characters/Bard.md",
      },
    ];
    const { container } = await openRailWithNote(async (cmd: string) => {
      if (cmd === "get_outbound_links") return outboundData;
      return defaultInvokeImpl(cmd);
    });
    await act(() => {});
    const rows = container.querySelectorAll('[data-slot="outbound-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("Bard");
  });

  it("outbound broken links shown dimmed with 'Not yet created'", async () => {
    const outboundData = [
      {
        target_path: "Missing/Ghost.md",
        resolved_id: null,
        resolved_title: null,
        resolved_path: null,
      },
    ];
    const { container } = await openRailWithNote(async (cmd: string) => {
      if (cmd === "get_outbound_links") return outboundData;
      return defaultInvokeImpl(cmd);
    });
    await act(() => {});
    const broken = container.querySelector('[data-slot="outbound-broken"]');
    expect(broken).toBeTruthy();
    expect(broken!.textContent).toContain("Not yet created");
  });

  it("outbound broken links are clickable buttons (click-to-create)", async () => {
    const outboundData = [
      {
        target_path: "Missing/Ghost.md",
        resolved_id: null,
        resolved_title: null,
        resolved_path: null,
      },
    ];
    const { container } = await openRailWithNote(async (cmd: string) => {
      if (cmd === "get_outbound_links") return outboundData;
      return defaultInvokeImpl(cmd);
    });
    await act(() => {});
    const broken = container.querySelector('[data-slot="outbound-broken"]')!;
    expect(broken.tagName.toLowerCase()).toBe("button");
  });

  it("outbound caps at 5 rows when there are more than 5", async () => {
    const outboundData = Array.from({ length: 8 }, (_, i) => ({
      target_path: `Notes/Note${i}.md`,
      resolved_id: i + 2,
      resolved_title: `Note ${i}`,
      resolved_path: `Notes/Note${i}.md`,
    }));
    const { container } = await openRailWithNote(async (cmd: string) => {
      if (cmd === "get_outbound_links") return outboundData;
      return defaultInvokeImpl(cmd);
    });
    await act(() => {});
    const rows = container.querySelectorAll('[data-slot="outbound-row"]');
    expect(rows.length).toBe(5);
    const expandBtn = container.querySelector('[data-slot="outbound-expand"]');
    expect(expandBtn).toBeTruthy();
    expect(expandBtn!.textContent).toContain("3 more");
  });

  it("outbound expand button shows all rows when clicked", async () => {
    const outboundData = Array.from({ length: 7 }, (_, i) => ({
      target_path: `Notes/Note${i}.md`,
      resolved_id: i + 2,
      resolved_title: `Note ${i}`,
      resolved_path: `Notes/Note${i}.md`,
    }));
    const { container } = await openRailWithNote(async (cmd: string) => {
      if (cmd === "get_outbound_links") return outboundData;
      return defaultInvokeImpl(cmd);
    });
    await act(() => {});
    const expandBtn = container.querySelector('[data-slot="outbound-expand"]')!;
    await fireEvent.click(expandBtn);
    const rows = container.querySelectorAll('[data-slot="outbound-row"]');
    expect(rows.length).toBe(7);
  });
});

// ── Section ordering: Tags → Aliases → Backlinks → Outbound → Folder → Modified

describe("right rail — full section ordering", () => {
  it("section order is tags → aliases → backlinks → outbound → folder → modified", async () => {
    const { container } = await openRailWithNote(defaultInvokeImpl);
    await act(() => {});
    const sections = container.querySelectorAll("[data-section]");
    const names = Array.from(sections).map((s) => s.getAttribute("data-section"));
    const idx = (name: string) => names.indexOf(name);
    expect(idx("tags")).toBeGreaterThanOrEqual(0);
    expect(idx("aliases")).toBeGreaterThan(idx("tags"));
    expect(idx("backlinks")).toBeGreaterThan(idx("aliases"));
    expect(idx("outbound")).toBeGreaterThan(idx("backlinks"));
    expect(idx("folder")).toBeGreaterThan(idx("outbound"));
    expect(idx("modified")).toBeGreaterThan(idx("folder"));
  });
});

// ── Refresh after save ────────────────────────────────────────────────────────

describe("right rail — refresh after save", () => {
  it("backlinks and outbound reload when linksTick is bumped", async () => {
    let backlinkCallCount = 0;
    let outboundCallCount = 0;
    const { container } = await openRailWithNote(async (cmd: string) => {
      if (cmd === "get_backlinks") { backlinkCallCount++; return []; }
      if (cmd === "get_outbound_links") { outboundCallCount++; return []; }
      return defaultInvokeImpl(cmd);
    });
    await act(() => {});
    const beforeBacklink = backlinkCallCount;
    const beforeOutbound = outboundCallCount;

    await act(() => { linksTick.bump(); });

    expect(backlinkCallCount).toBeGreaterThan(beforeBacklink);
    expect(outboundCallCount).toBeGreaterThan(beforeOutbound);
  });
});
