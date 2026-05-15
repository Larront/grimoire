import { render, fireEvent, waitFor } from "@testing-library/svelte";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { tick } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import ImageBlockView from "$lib/components/editor/ImageBlockView.svelte";

vi.mocked(invoke).mockImplementation(async (cmd: string) => {
  if (cmd === "get_image_absolute_path") return "/abs/images/portrait.png";
  return null;
});

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    src: "images/portrait.png",
    alt: "A portrait",
    align: "center",
    width: "100%",
    selected: true,
    onUpdate: vi.fn(),
    onCaptionUpdate: vi.fn(),
    ...overrides,
  };
}

async function flushImageLoad() {
  // imageUrl is set inside a $effect that awaits invoke; one microtask is enough since
  // the mocked invoke resolves synchronously, but tick lets the effect run.
  await tick();
  await tick();
}

describe("Image lightbox button", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("is not present when the image is not selected", () => {
    const { container } = render(ImageBlockView, { props: makeProps({ selected: false }) });
    expect(container.querySelector("[data-lightbox-btn]")).toBeNull();
  });

  it("appears in the floating toolbar when the image is selected", async () => {
    const { container } = render(ImageBlockView, { props: makeProps({ selected: true }) });
    await flushImageLoad();
    expect(container.querySelector("[data-lightbox-btn]")).toBeTruthy();
  });

  it("does not call onUpdate or onCaptionUpdate when clicked", async () => {
    const onUpdate = vi.fn();
    const onCaptionUpdate = vi.fn();
    const { container } = render(ImageBlockView, {
      props: makeProps({ onUpdate, onCaptionUpdate }),
    });
    await flushImageLoad();
    const btn = container.querySelector("[data-lightbox-btn]") as HTMLElement;
    await fireEvent.click(btn);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onCaptionUpdate).not.toHaveBeenCalled();
  });
});

describe("Image lightbox overlay", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("opens a fullscreen overlay when the lightbox button is clicked", async () => {
    const { container } = render(ImageBlockView, { props: makeProps() });
    await flushImageLoad();
    expect(document.body.querySelector("[data-image-lightbox]")).toBeNull();

    const btn = container.querySelector("[data-lightbox-btn]") as HTMLElement;
    await fireEvent.click(btn);

    await waitFor(() => {
      expect(document.body.querySelector("[data-image-lightbox]")).toBeTruthy();
    });
  });

  it("renders the image inside the overlay at natural size (no max-width clamp)", async () => {
    const { container } = render(ImageBlockView, { props: makeProps() });
    await flushImageLoad();
    await fireEvent.click(container.querySelector("[data-lightbox-btn]") as HTMLElement);

    await waitFor(() => {
      const img = document.body.querySelector("[data-lightbox-img]") as HTMLImageElement;
      expect(img).toBeTruthy();
      expect(img.className).toMatch(/max-w-none/);
    });
  });

  it("is portaled to document.body, not nested in the editor component tree", async () => {
    const { container } = render(ImageBlockView, { props: makeProps() });
    await flushImageLoad();
    await fireEvent.click(container.querySelector("[data-lightbox-btn]") as HTMLElement);

    await waitFor(() => {
      const overlay = document.body.querySelector("[data-image-lightbox]") as HTMLElement;
      expect(overlay).toBeTruthy();
      expect(container.contains(overlay)).toBe(false);
      expect(overlay.parentElement).toBe(document.body);
    });
  });

  it("closes when Escape is pressed", async () => {
    const { container } = render(ImageBlockView, { props: makeProps() });
    await flushImageLoad();
    await fireEvent.click(container.querySelector("[data-lightbox-btn]") as HTMLElement);
    await waitFor(() => {
      expect(document.body.querySelector("[data-image-lightbox]")).toBeTruthy();
    });

    await fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(document.body.querySelector("[data-image-lightbox]")).toBeNull();
    });
  });

  it("closes when the backdrop is clicked", async () => {
    const { container } = render(ImageBlockView, { props: makeProps() });
    await flushImageLoad();
    await fireEvent.click(container.querySelector("[data-lightbox-btn]") as HTMLElement);
    const overlay = await waitFor(() => {
      const el = document.body.querySelector("[data-image-lightbox]") as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });

    await fireEvent.click(overlay);

    await waitFor(() => {
      expect(document.body.querySelector("[data-image-lightbox]")).toBeNull();
    });
  });

  it("does NOT close when the image itself is clicked", async () => {
    const { container } = render(ImageBlockView, { props: makeProps() });
    await flushImageLoad();
    await fireEvent.click(container.querySelector("[data-lightbox-btn]") as HTMLElement);
    await waitFor(() => {
      expect(document.body.querySelector("[data-image-lightbox]")).toBeTruthy();
    });

    const img = document.body.querySelector("[data-lightbox-img]") as HTMLElement;
    await fireEvent.click(img);

    expect(document.body.querySelector("[data-image-lightbox]")).toBeTruthy();
  });

  it("closes when the in-overlay close button is clicked", async () => {
    const { container } = render(ImageBlockView, { props: makeProps() });
    await flushImageLoad();
    await fireEvent.click(container.querySelector("[data-lightbox-btn]") as HTMLElement);
    await waitFor(() => {
      expect(document.body.querySelector("[data-lightbox-close]")).toBeTruthy();
    });

    await fireEvent.click(document.body.querySelector("[data-lightbox-close]") as HTMLElement);

    await waitFor(() => {
      expect(document.body.querySelector("[data-image-lightbox]")).toBeNull();
    });
  });

  it("does not call onUpdate or onCaptionUpdate when the overlay closes", async () => {
    const onUpdate = vi.fn();
    const onCaptionUpdate = vi.fn();
    const { container } = render(ImageBlockView, {
      props: makeProps({ onUpdate, onCaptionUpdate }),
    });
    await flushImageLoad();
    await fireEvent.click(container.querySelector("[data-lightbox-btn]") as HTMLElement);
    await waitFor(() => {
      expect(document.body.querySelector("[data-image-lightbox]")).toBeTruthy();
    });
    onUpdate.mockClear();
    onCaptionUpdate.mockClear();

    await fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(document.body.querySelector("[data-image-lightbox]")).toBeNull();
    });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onCaptionUpdate).not.toHaveBeenCalled();
  });
});
