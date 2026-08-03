// Timeline on the Row List (#173) — the block's row behaviour after the controls
// and the order arithmetic moved out of it. This is the "nothing changed for the
// GM" test: events still reorder, delete and insert between exactly as they did,
// and an expanded description still travels with the event the GM moved.
//
// The Row List's own seams are tested in row-list.test.ts; here the block is the
// subject, because a consumer noticing nothing is the whole claim of the
// extraction.
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi } from "vitest";
import TimelineBlockView from "$lib/components/editor/TimelineBlockView.svelte";

afterEach(cleanup);

/** Titles as the block last handed them to the document, per commit. */
function committedTitles(onCommit: ReturnType<typeof vi.fn>, call: number): string[] {
  return (onCommit.mock.calls[call][0] as { title: string }[]).map((e) => e.title);
}

describe("Timeline rows", () => {
  it("moving an event up reorders it and commits", async () => {
    const onCommit = vi.fn();
    const { getAllByLabelText } = render(TimelineBlockView, {
      props: {
        events: [
          { date: "Day 1", title: "Alpha", description: "" },
          { date: "Day 2", title: "Beta", description: "" },
        ],
        onCommit,
      },
    });
    await fireEvent.click(getAllByLabelText("Move event up")[1]);
    expect(committedTitles(onCommit, 0)).toEqual(["Beta", "Alpha"]);
  });

  it("moving an event down reorders it and commits", async () => {
    const onCommit = vi.fn();
    const { getAllByLabelText } = render(TimelineBlockView, {
      props: {
        events: [
          { date: "", title: "Alpha", description: "" },
          { date: "", title: "Beta", description: "" },
        ],
        onCommit,
      },
    });
    await fireEvent.click(getAllByLabelText("Move event down")[0]);
    expect(committedTitles(onCommit, 0)).toEqual(["Beta", "Alpha"]);
  });

  it("deleting an event removes it and commits", async () => {
    const onCommit = vi.fn();
    const { getAllByLabelText } = render(TimelineBlockView, {
      props: {
        events: [
          { date: "", title: "Alpha", description: "" },
          { date: "", title: "Beta", description: "" },
        ],
        onCommit,
      },
    });
    await fireEvent.click(getAllByLabelText("Delete event")[0]);
    expect(committedTitles(onCommit, 0)).toEqual(["Beta"]);
  });

  it("inserting between two events opens the new one for editing without committing", async () => {
    const onCommit = vi.fn();
    const { getByLabelText, getAllByLabelText, getByPlaceholderText } = render(
      TimelineBlockView,
      {
        props: {
          events: [
            { date: "", title: "Alpha", description: "" },
            { date: "", title: "Beta", description: "" },
          ],
          onCommit,
        },
      },
    );
    await fireEvent.click(getByLabelText("Insert event after position 1"));
    expect(getAllByLabelText("Delete event")).toHaveLength(3);
    // A blank event is not worth writing to the note until the GM types in it.
    expect(onCommit).not.toHaveBeenCalled();
    expect(getByPlaceholderText("Title")).toBeTruthy();
  });

  it("the insertion points between events stay hidden until an event is hovered", async () => {
    const { getByLabelText, getAllByRole } = render(TimelineBlockView, {
      props: {
        events: [
          { date: "", title: "Alpha", description: "" },
          { date: "", title: "Beta", description: "" },
        ],
        onCommit: vi.fn(),
      },
    });
    const gap = getByLabelText("Insert event after position 1");
    expect(gap.classList.contains("opacity-0")).toBe(true);
    await fireEvent.mouseEnter(getAllByRole("group", { name: /^Event \d+$/ })[1]);
    expect(gap.classList.contains("opacity-0")).toBe(false);
  });

  it("an expanded description travels with the event that moved", async () => {
    const { getByLabelText, getAllByLabelText } = render(TimelineBlockView, {
      props: {
        events: [
          { date: "", title: "Alpha", description: "one" },
          { date: "", title: "Beta", description: "two" },
        ],
        onCommit: vi.fn(),
      },
    });
    await fireEvent.click(getByLabelText("Expand event 1"));
    await fireEvent.click(getAllByLabelText("Move event down")[0]);
    // Alpha is row 2 now, and it is the row that must still read as expanded.
    expect(getByLabelText("Collapse event 2")).toBeTruthy();
    expect(getByLabelText("Expand event 1")).toBeTruthy();
  });

  it("an empty timeline still offers a way to add the first event", () => {
    const { getByLabelText, getByText } = render(TimelineBlockView, {
      props: { events: [], onCommit: vi.fn() },
    });
    expect(getByText("No events yet")).toBeTruthy();
    expect(getByLabelText("Add event")).toBeTruthy();
  });
});

// ─── Removing the block ───────────────────────────────────────────────────────

describe("removing a Timeline", () => {
  it("offers a way out of the block, which the Row List cannot give it", async () => {
    // Deleting every event leaves an empty timeline, not an absent one — and a sealed
    // block holds every click, so ProseMirror never selects the node and Backspace has
    // nothing to take (#175 review).
    const onRemove = vi.fn();
    const { getByLabelText } = render(TimelineBlockView, {
      props: {
        events: [{ date: "Day 1", title: "Alpha", description: "" }],
        onCommit: vi.fn(),
        onRemove,
      },
    });

    await fireEvent.click(getByLabelText("Remove timeline"));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("is reachable on an empty timeline too", async () => {
    const onRemove = vi.fn();
    const { getByLabelText } = render(TimelineBlockView, {
      props: { events: [], onCommit: vi.fn(), onRemove },
    });

    await fireEvent.click(getByLabelText("Remove timeline"));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
