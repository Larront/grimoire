import { render, cleanup, fireEvent, waitFor } from "@testing-library/svelte";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import TabBar from "../lib/components/TabBar.svelte";
import { tabs } from "../lib/stores/tabs.svelte";

// The tab's menu, and the tab strip's keys (2026-10 design review).

beforeEach(() => {
  tabs.closeAll("left");
  // `openTab` fills the open tab, so each after the first goes into a new one.
  tabs.openTab({ type: "note", id: 1, title: "Mira Vell" });
  tabs.addEmptyTab("left");
  tabs.openTab({ type: "note", id: 2, title: "Iron Hand" });
  tabs.addEmptyTab("left");
  tabs.openTab({ type: "graph", id: 0, title: "Graph" });
  tabs.activateTab("left", 0);
});

afterEach(() => {
  cleanup();
  tabs.closeAll("left");
});

function menuItems() {
  return [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((e) =>
    e.textContent!.replace(/\s+/g, " ").trim(),
  );
}

describe("the tab bar", () => {
  it("is a tab list whose tabs say which one is open", () => {
    const { getByRole, getAllByRole } = render(TabBar, { props: { pane: "left" } });
    expect(getByRole("tablist")).toBeTruthy();
    const [first, second] = getAllByRole("tab");
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(second).toHaveAttribute("aria-selected", "false");
  });

  // Shift+F10 and the menu key raise `contextmenu` on whatever has focus — the tab.
  // The menu used to listen on an element inside it, so the keyboard's menu reached
  // nothing and only a right-click opened it.
  it("opens its menu from the focused tab itself", async () => {
    const { getAllByRole } = render(TabBar, { props: { pane: "left" } });
    await fireEvent.contextMenu(getAllByRole("tab")[0]);
    await waitFor(() => expect(menuItems().length).toBeGreaterThan(0));
    expect(menuItems()).toEqual([
      expect.stringMatching(/^Close Ctrl\+W$/),
      "Close others",
      "Close all",
      "Move to right pane",
    ]);
  });

  it("shows the close key only on the tab it closes", async () => {
    const { getAllByRole } = render(TabBar, { props: { pane: "left" } });
    await fireEvent.contextMenu(getAllByRole("tab")[1]);
    await waitFor(() => expect(menuItems().length).toBeGreaterThan(0));
    expect(menuItems()[0]).toBe("Close");
  });

  it("moves along the tabs with the arrow keys, taking focus with it", async () => {
    const { getAllByRole } = render(TabBar, { props: { pane: "left" } });
    const first = getAllByRole("tab")[0];
    first.focus();

    await fireEvent.keyDown(first, { key: "ArrowRight" });
    await waitFor(() => expect(tabs.left.activeIndex).toBe(1));
    expect(document.activeElement).toBe(getAllByRole("tab")[1]);

    // The ends are the ends.
    await fireEvent.keyDown(getAllByRole("tab")[1], { key: "ArrowLeft" });
    await fireEvent.keyDown(getAllByRole("tab")[0], { key: "ArrowLeft" });
    expect(tabs.left.activeIndex).toBe(0);
  });
});

// Keys to change tab, which there were none of (2026-10 design review). Bound by the
// shell, which owns the window's keys.
describe("changing tab from the keyboard", () => {
  it("steps with Ctrl+Tab and Ctrl+Shift+Tab, round from the end, and jumps with Ctrl+digit", async () => {
    const { default: AppShell } = await import("../lib/components/AppShell.svelte");
    render(AppShell);
    expect(tabs.left.activeIndex).toBe(0);

    await fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
    expect(tabs.left.activeIndex).toBe(1);
    await fireEvent.keyDown(window, { key: "Tab", ctrlKey: true, shiftKey: true });
    await fireEvent.keyDown(window, { key: "Tab", ctrlKey: true, shiftKey: true });
    expect(tabs.left.activeIndex).toBe(2);

    await fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    expect(tabs.left.activeIndex).toBe(0);
    await fireEvent.keyDown(window, { key: "9", ctrlKey: true });
    expect(tabs.left.activeIndex).toBe(2);
    // No fifth tab: Ctrl+5 does nothing.
    await fireEvent.keyDown(window, { key: "5", ctrlKey: true });
    expect(tabs.left.activeIndex).toBe(2);
  });
});
