// Timeline on the Row List (#173) — the block's row behaviour after the controls
// and the order arithmetic moved out of it. This is the "nothing changed for the
// GM" test: events still reorder, delete and insert between exactly as they did,
// and an expanded description still travels with the event the GM moved.
//
// The Row List's own seams are tested in row-list.test.ts; here the block is the
// subject, because a consumer noticing nothing is the whole claim of the
// extraction.
import { render, fireEvent, waitFor, cleanup } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi } from "vitest";
import TimelineBlockView from "$lib/components/editor/TimelineBlockView.svelte";

afterEach(cleanup);

/** Titles as the block last handed them to the document, per commit. */
function committedTitles(onCommit: ReturnType<typeof vi.fn>, call: number): string[] {
  return (onCommit.mock.calls[call][0] as { events: { title: string }[] }).events.map(
    (e) => e.title,
  );
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

  it("inserting between two events opens the new one for typing without committing", async () => {
    const onCommit = vi.fn();
    const { getByLabelText, getAllByLabelText } = render(TimelineBlockView, {
      props: {
        events: [
          { date: "", title: "Alpha", description: "" },
          { date: "", title: "Beta", description: "" },
        ],
        onCommit,
      },
    });
    await fireEvent.click(getAllByLabelText("Insert event below")[0]);
    expect(getAllByLabelText("Delete event")).toHaveLength(3);
    // A blank event is not worth writing to the note until the GM types in it.
    expect(onCommit).not.toHaveBeenCalled();
    // The new event's title is the field that took the caret — an input rather than the
    // button a drawn value is.
    expect(getByLabelText("Event 2 title").tagName).toBe("INPUT");
  });

  it("names each event's group by its title", () => {
    // "Event 2" told a screen reader nothing about which event it had entered.
    const { getAllByRole } = render(TimelineBlockView, {
      props: {
        events: [
          { date: "", title: "Alpha", description: "" },
          { date: "", title: "[[Beta]] rises", description: "" },
        ],
        onCommit: vi.fn(),
      },
    });
    expect(getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual([
      "Event 1: Alpha",
      "Event 2: Beta rises",
    ]);
  });

  it("drops an inserted event the GM leaves without typing, and never writes it", async () => {
    // A stray click used to leave an "Untitled event" behind, and the next edit wrote it
    // into the note as a bare `# `.
    const onCommit = vi.fn();
    const { getAllByLabelText, getByLabelText } = render(TimelineBlockView, {
      props: {
        events: [
          { date: "", title: "Alpha", description: "" },
          { date: "", title: "Beta", description: "" },
        ],
        onCommit,
      },
    });
    await fireEvent.click(getAllByLabelText("Insert event below")[0]);
    expect(getAllByLabelText("Delete event")).toHaveLength(3);
    const input = getByLabelText("Event 2 title");
    // Focus leaving the row for somewhere else on the page.
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    input.focus();
    elsewhere.focus();

    await waitFor(() => expect(getAllByLabelText("Delete event")).toHaveLength(2));
    expect(onCommit).not.toHaveBeenCalled();
    elsewhere.remove();
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
    expect(getByText(/No events yet/)).toBeTruthy();
    expect(getByLabelText("Add event")).toBeTruthy();
  });
});

// ─── Removing the block ───────────────────────────────────────────────────────

describe("removing a Timeline", () => {
  // The block's corner held a trash can, because deleting every event leaves an empty
  // timeline rather than an absent one, and a sealed block holds every click so
  // ProseMirror never selected the node for Backspace to take (#175 review). The gutter
  // handle's menu deletes any block now (#194), which is where that gesture lives —
  // pinned in block-handle.test.ts, not here.

  it("draws no removal control of its own", () => {
    const { queryByLabelText } = render(TimelineBlockView, {
      props: {
        events: [{ date: "Day 1", title: "Alpha", description: "" }],
        onCommit: vi.fn(),
      },
    });

    expect(queryByLabelText("Remove timeline")).toBeNull();
  });

  it("draws none on an empty timeline either", () => {
    const { queryByLabelText } = render(TimelineBlockView, {
      props: { events: [], onCommit: vi.fn() },
    });

    expect(queryByLabelText("Remove timeline")).toBeNull();
  });
});
