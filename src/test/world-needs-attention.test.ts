import { render, cleanup, fireEvent, waitFor } from "@testing-library/svelte";
import { describe, it, expect, afterEach } from "vitest";
import LedgerSelector from "../lib/components/sidebar/LedgerSelector.svelte";
import { unlinkedPins } from "../lib/stores/unlinked-pins.svelte";
import { staleLinks } from "../lib/stores/stale-links.svelte";

// What a world needs from the GM is in its menu, with a quiet mark on the button
// while anything waits (2026-10 design review — they were three lasting toasts).

afterEach(() => {
  cleanup();
  unlinkedPins.replace([]);
  staleLinks.clear();
});

const pin = {
  pin_id: 1,
  pin_title: "Waterdeep",
  map_id: 7,
  map_title: "Sword Coast",
  was_note_title: "Waterdeep",
};

describe("the world menu", () => {
  it("carries no mark while nothing needs attention", () => {
    const { queryByTestId, getByRole } = render(LedgerSelector);
    expect(queryByTestId("world-needs-attention")).toBeNull();
    expect(getByRole("button", { name: /^World:/ }).getAttribute("aria-label")).not.toMatch(
      /needs attention/,
    );
  });

  it("marks itself, says so to a screen reader, and lists what is waiting", async () => {
    unlinkedPins.replace([pin]);
    staleLinks.add("People/Aldric.md", "People/Aldric the Bold.md", 2);
    const { getByTestId, getByRole } = render(LedgerSelector);

    expect(getByTestId("world-needs-attention")).toBeTruthy();
    const trigger = getByRole("button", { name: /needs attention/ });
    await fireEvent.click(trigger);

    await waitFor(() => expect(getByTestId("attention-pins")).toBeTruthy());
    expect(getByTestId("attention-pins").textContent).toContain("1 pin lost its note");
    expect(getByTestId("attention-links").textContent).toContain("“Aldric” moved outside Grimoire");

    await fireEvent.click(getByTestId("attention-pins"));
    expect(unlinkedPins.open).toBe(true);
  });
});
