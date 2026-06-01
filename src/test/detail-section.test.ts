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

  it("first section has no top border class", () => {
    const { container } = render(DetailSection, {
      props: { label: "Tags", first: true },
    });
    const section = container.querySelector('[data-slot="detail-section"]')!;
    expect(section.className).not.toContain("border-t");
    expect(section.className).not.toContain("pt-3");
    expect(section.className).not.toContain("mt-3");
  });

  it("non-first sections have border-t border-background-border pt-3 mt-3", () => {
    const { container } = render(DetailSection, {
      props: { label: "Aliases", first: false },
    });
    const section = container.querySelector('[data-slot="detail-section"]')!;
    expect(section.className).toContain("border-t");
    expect(section.className).toContain("border-background-border");
    expect(section.className).toContain("pt-3");
    expect(section.className).toContain("mt-3");
  });

  it("first=true is the default when prop is omitted", () => {
    // Without first prop, defaults to false → should have border
    const { container } = render(DetailSection, {
      props: { label: "Section" },
    });
    const section = container.querySelector('[data-slot="detail-section"]')!;
    expect(section.className).toContain("border-t");
  });
});
