// The slash menu as it is drawn: which row looks selected, how it is grouped, and what a
// screen reader can reach. The rows themselves come from `filterCommands`, so these
// tests draw the real lists.
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi } from "vitest";
import SlashCommandMenu from "$lib/components/editor/SlashCommandMenu.svelte";
import {
  filterCommands,
  SLASH_MENU_ID,
  slashOptionId,
  type SlashCommandSuggestionState,
} from "$lib/editor/slash-command";
import { SHIPPED_PRESETS } from "$lib/editor/statblock-presets";

afterEach(cleanup);

function menu(query: string, selectedIndex = 0) {
  const state: SlashCommandSuggestionState = {
    items: filterCommands(query, { presets: [...SHIPPED_PRESETS], defaultName: null }),
    grouped: !query.trim(),
    query,
    selectedIndex,
    x: 0,
    y: 0,
    anchorTop: 0,
    command: vi.fn(),
    select: vi.fn(),
    reposition: vi.fn(),
  };
  return { ...render(SlashCommandMenu, { props: { state } }), state };
}

describe("the slash menu's rows", () => {
  it("lights the selected row with the selection tint, and only that row", () => {
    // It was drawn in the menu's own colour — `bg-muted` and `bg-popover` are one token —
    // so the row Enter would run looked like every other.
    const { getAllByRole } = menu("", 2);
    const options = getAllByRole("option");

    expect(options[2]).toHaveAttribute("aria-selected", "true");
    expect(options[2].className).toContain("bg-surface-selected");
    expect(options.filter((o) => o.className.includes("bg-surface-selected"))).toHaveLength(1);
  });

  it("selects the row the pointer moves over, rather than lighting a second", async () => {
    const { getAllByRole, state } = menu("");
    await fireEvent.mouseMove(getAllByRole("option")[4]);
    expect(state.select).toHaveBeenCalledWith(4);
  });

  it("gives every row the id the editor points at, and keeps rows out of the Tab order", () => {
    const { getAllByRole, getByRole } = menu("");
    const options = getAllByRole("option");

    expect(getByRole("listbox")).toHaveAttribute("id", SLASH_MENU_ID);
    options.forEach((option, i) => {
      expect(option).toHaveAttribute("id", slashOptionId(i));
      expect(option).toHaveAttribute("tabindex", "-1");
      expect(option).toHaveAttribute("type", "button");
    });
  });

  it("runs a row on click", async () => {
    const { getAllByRole, state } = menu("");
    await fireEvent.click(getAllByRole("option")[0]);
    expect(state.command).toHaveBeenCalledWith(state.items[0]);
  });
});

describe("the slash menu's layout", () => {
  it("groups a bare / under named headings a screen reader can hear", () => {
    const { getAllByRole } = menu("");
    const groups = getAllByRole("group");

    expect(groups.map((g) => g.textContent?.trim().split(/\s/)[0])).toEqual(["Note", "Text", "List"]);
    expect(getAllByRole("group", { name: "Note blocks" })).toHaveLength(1);
  });

  it("draws one ranked list, without headings, once anything is typed", () => {
    const { queryAllByRole } = menu("st");
    expect(queryAllByRole("group")).toHaveLength(0);
  });

  it("says what a statblock row will stamp", () => {
    const { getByRole } = menu("stat");
    expect(getByRole("option", { name: /Large Orc/ })).toHaveTextContent("Preset");
    expect(getByRole("option", { name: /^Statblock/ })).toHaveTextContent("Blank");
  });

  it("says nothing matches, rather than vanishing", () => {
    const { getByText, queryAllByRole } = menu("zzz");
    expect(getByText("No blocks match “zzz”")).toBeTruthy();
    expect(queryAllByRole("option")).toHaveLength(0);
  });
});
