// The Timeline's fields (#214) — every value on the rail as a Linked Text Field.
//
// The format is pinned in timeline-block.test.ts, the fence claim in
// block-markdown.test.ts, and the rows' order and controls in timeline-row-list.test.ts.
// What is left for here is the one thing the block used to do itself: draw and resolve the
// wikilinks inside its three values. It built `data-wiki-link` spans as an HTML string and
// handed them to `{@html}`, against ADR-0016 §8's sentence that *a block never renders or
// resolves a wikilink itself*.
//
// The escaping case is the one with teeth. A value holding `<b>` is characters the GM
// typed, and the old path had an escaper standing between those characters and the
// document; the field has no markup to escape, so the guarantee is structural rather than
// remembered.
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi } from "vitest";
import TimelineBlockView from "$lib/components/editor/TimelineBlockView.svelte";
import type { Timeline, TimelineEvent } from "$lib/editor/timeline-block";

vi.mock("$lib/stores/link-resolver.svelte", () => ({
  linkResolver: { isKnown: () => true, prime: vi.fn(), resolve: vi.fn() },
}));

afterEach(cleanup);

const SHATTERING: TimelineEvent[] = [
  {
    date: "3rd of Frostfall",
    title: "The Shattering",
    description: "The tower fell, and [[Aldric]] was not seen again.",
  },
];

function timeline(events: TimelineEvent[] = SHATTERING) {
  const onCommit = vi.fn();
  const rendered = render(TimelineBlockView, { props: { events, onCommit } });
  return { ...rendered, onCommit };
}

/** The events as the block last handed them to the document. */
function committed(onCommit: ReturnType<typeof vi.fn>, call = 0): TimelineEvent[] {
  return (onCommit.mock.calls[call][0] as Timeline).events;
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

describe("a Timeline draws its events", () => {
  it("draws the date, the title and the description", () => {
    const { getByLabelText } = timeline();

    expect(getByLabelText("Event 1 date")).toHaveTextContent("3rd of Frostfall");
    expect(getByLabelText("Event 1 title")).toHaveTextContent("The Shattering");
    expect(getByLabelText("Event 1 description")).toHaveTextContent("The tower fell");
  });

  it("draws empty values as nothing but their placeholders", () => {
    const { getByLabelText } = timeline([{ date: "", title: "", description: "" }]);

    expect(getByLabelText("Event 1 date")).toHaveTextContent("Date");
    expect(getByLabelText("Event 1 title")).toHaveTextContent("Untitled event");
    expect(getByLabelText("Event 1 description")).toHaveTextContent("Description (optional)");
  });

  it("draws a wikilink in any of the three as a live link", () => {
    const { container } = timeline([
      { date: "[[The Long Winter]]", title: "[[Aldric]] rides", description: "Toward [[Harbor]]." },
    ]);
    const links = [...container.querySelectorAll("[data-wiki-link]")];

    expect(links.map((el) => el.getAttribute("data-path"))).toEqual([
      "The Long Winter",
      "Aldric",
      "Harbor",
    ]);
  });

  it("shows the characters the GM typed, markup and all", () => {
    // The escaper's case, and the reason it is gone rather than moved: a field draws text
    // as text, so `<b>` is three characters and never an element.
    const { container, getByLabelText } = timeline([
      { date: "", title: "A <b> title & more", description: "" },
    ]);

    expect(getByLabelText("Event 1 title")).toHaveTextContent("A <b> title & more");
    expect(container.querySelector("b")).toBeNull();
  });
});

// ─── Editing ──────────────────────────────────────────────────────────────────

describe("editing an event's values", () => {
  /** Clicking a drawn value swaps in its input, which is the field's whole gesture. */
  async function openField(el: HTMLElement) {
    await fireEvent.click(el);
  }

  it("has no mode to enter: a value is a field all of the time", async () => {
    // ADR-0016 §6 — a timeline holds no play values, so nothing here needs guarding
    // behind a pencil, and there is none to find.
    const { getByLabelText, queryByLabelText } = timeline();

    expect(queryByLabelText("Edit timeline structure")).toBeNull();

    await openField(getByLabelText("Event 1 title"));
    expect(getByLabelText("Event 1 title").tagName).toBe("INPUT");
  });

  it.each([
    ["date", "1st of Thaw"],
    ["title", "The Second Shattering"],
  ])("commits an edited %s when the GM leaves the field", async (field, typed) => {
    const { getByLabelText, onCommit } = timeline();

    await openField(getByLabelText(`Event 1 ${field}`));
    const input = getByLabelText(`Event 1 ${field}`);
    await fireEvent.input(input, { target: { value: typed } });
    await fireEvent.blur(input);

    expect(committed(onCommit)[0][field as keyof TimelineEvent]).toBe(typed);
  });

  it("commits an edited description, line breaks and all", async () => {
    const { getByLabelText, onCommit } = timeline();

    await openField(getByLabelText("Event 1 description"));
    const input = getByLabelText("Event 1 description");
    expect(input.tagName).toBe("TEXTAREA");
    await fireEvent.input(input, { target: { value: "Two lines.\n\nAnd a third." } });
    await fireEvent.blur(input);

    expect(committed(onCommit)[0].description).toBe("Two lines.\n\nAnd a third.");
  });

  it("keeps the other two values as they were", async () => {
    const { getByLabelText, onCommit } = timeline();

    await openField(getByLabelText("Event 1 date"));
    const input = getByLabelText("Event 1 date");
    await fireEvent.input(input, { target: { value: "1st of Thaw" } });
    await fireEvent.blur(input);

    expect(committed(onCommit)[0].title).toBe("The Shattering");
    expect(committed(onCommit)[0].description).toBe(SHATTERING[0].description);
  });

  it("writes nothing when the GM leaves a value unchanged", async () => {
    const { getByLabelText, onCommit } = timeline();

    await openField(getByLabelText("Event 1 title"));
    await fireEvent.blur(getByLabelText("Event 1 title"));

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("keeps a collapsed description out of the tab order, not merely out of sight", async () => {
    // The description field is a real button when it is drawn, and the panel holding it
    // stays mounted so it has a height to animate to — so a collapsed event would
    // otherwise put a focusable control inside an `aria-hidden` subtree, clipped to
    // nothing. `inert` is the half that keeps Tab out of it.
    // Read as a property rather than an attribute: Svelte sets `inert` on the element,
    // and jsdom does not reflect that back into the markup the way a browser does.
    const { getByLabelText, container } = timeline();
    const panel = container.querySelector<HTMLElement>(".desc-panel")!;

    expect(panel).toHaveAttribute("aria-hidden", "true");
    expect(panel.inert).toBe(true);

    await fireEvent.click(getByLabelText("Expand event 1"));

    expect(panel).toHaveAttribute("aria-hidden", "false");
    expect(panel.inert).toBe(false);
  });

  it("reaches an empty description through the chevron rather than a mode", async () => {
    // The collapse is drawn on every event now, because it is how a description that
    // does not exist yet is added.
    const { getByLabelText, onCommit } = timeline([
      { date: "", title: "The Shattering", description: "" },
    ]);

    await fireEvent.click(getByLabelText("Expand event 1"));
    await openField(getByLabelText("Event 1 description"));
    const input = getByLabelText("Event 1 description");
    await fireEvent.input(input, { target: { value: "The tower fell." } });
    await fireEvent.blur(input);

    expect(committed(onCommit)[0].description).toBe("The tower fell.");
  });
});
