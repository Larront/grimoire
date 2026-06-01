import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi } from "vitest";
import { createRawSnippet } from "svelte";
import DetailPanel from "../lib/components/DetailPanel.svelte";

afterEach(() => {
  cleanup();
});

describe("DetailPanel", () => {
  it("renders data-slot='detail-panel'", () => {
    const { container } = render(DetailPanel, { props: { title: "Details" } });
    expect(container.querySelector('[data-slot="detail-panel"]')).toBeTruthy();
  });

  it("shows title text", () => {
    const { getByText } = render(DetailPanel, { props: { title: "My Panel" } });
    expect(getByText("My Panel")).toBeTruthy();
  });

  it("close button calls onclose when clicked", async () => {
    const onclose = vi.fn();
    const { container } = render(DetailPanel, {
      props: { title: "Details", onclose },
    });
    const btn = container.querySelector('button[aria-label="Close details panel"]') as HTMLElement;
    await fireEvent.click(btn);
    expect(onclose).toHaveBeenCalledOnce();
  });

  it("saveStatus='idle' shows neither saved nor error indicator", () => {
    const { container } = render(DetailPanel, {
      props: { title: "Details", saveStatus: "idle" },
    });
    expect(container.textContent).not.toContain("Saved");
    expect(container.textContent).not.toContain("Save failed");
  });

  it("saveStatus='saved' shows 'Saved' text", () => {
    const { container } = render(DetailPanel, {
      props: { title: "Details", saveStatus: "saved" },
    });
    expect(container.textContent).toContain("Saved");
  });

  it("saveStatus='error' shows 'Save failed · Retry' button that calls onRetrySave", async () => {
    const onRetrySave = vi.fn();
    const { container } = render(DetailPanel, {
      props: { title: "Details", saveStatus: "error", onRetrySave },
    });
    const btn = container.querySelector("button") as HTMLElement;
    // Find the retry button specifically
    const retryBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Save failed"),
    ) as HTMLElement;
    expect(retryBtn).toBeTruthy();
    await fireEvent.click(retryBtn);
    expect(onRetrySave).toHaveBeenCalledOnce();
  });

  it("isEmpty=true renders emptyState snippet instead of children", () => {
    const emptyState = createRawSnippet(() => ({
      render: () => `<div data-testid="empty-state">Nothing here</div>`,
    }));
    const children = createRawSnippet(() => ({
      render: () => `<div data-testid="main-content">Content</div>`,
    }));
    const { container } = render(DetailPanel, {
      props: { title: "Details", isEmpty: true, emptyState, children },
    });
    expect(container.querySelector('[data-testid="empty-state"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="main-content"]')).toBeNull();
  });

  it("children render in body when not isEmpty", () => {
    const children = createRawSnippet(() => ({
      render: () => `<div data-testid="main-content">Content</div>`,
    }));
    const { container } = render(DetailPanel, {
      props: { title: "Details", isEmpty: false, children },
    });
    expect(container.querySelector('[data-testid="main-content"]')).toBeTruthy();
  });
});
