// The Detail Section — a labelled group inside the Details Pane.
//
// What is asserted is what the component *decides*: the label it draws, and the hooks
// (`data-section`, `data-slot`) the panel and its tests find sections by. The separator
// between sections is a border and a margin declared in the class list, and jsdom has no
// boxes to check it against — an assertion on those strings would restate the template
// and would hold whatever the rule actually rendered as. See CONTRIBUTING.md.
import { render, cleanup } from "@testing-library/svelte";
import { describe, it, expect, afterEach } from "vitest";
import DetailSection from "../lib/components/DetailSection.svelte";

afterEach(() => {
  cleanup();
});

describe("DetailSection", () => {
  it("renders the label text", () => {
    const { getByText } = render(DetailSection, { props: { label: "Tags" } });
    expect(getByText("Tags")).toBeTruthy();
  });

  it("sets data-section attribute when sectionKey is provided", () => {
    const { container } = render(DetailSection, {
      props: { label: "Tags", sectionKey: "tags" },
    });
    const section = container.querySelector('[data-section="tags"]');
    expect(section).toBeTruthy();
  });

  it("sets data-slot='detail-section' on the root element", () => {
    const { container } = render(DetailSection, { props: { label: "Test" } });
    const section = container.querySelector('[data-slot="detail-section"]');
    expect(section).toBeTruthy();
  });
});
