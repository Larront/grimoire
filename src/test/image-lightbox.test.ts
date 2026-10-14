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
    // TipTap's own attribute, part of the record and read by nothing here.
    title: null,
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
    const { container } = render(ImageBlockView, {
      props: makeProps({ selected: false }),
    });
    expect(container.querySelector("[data-lightbox-btn]")).toBeNull();
  });

  it("appears in the floating toolbar when the image is selected", async () => {
    const { container } = render(ImageBlockView, {
      props: makeProps({ selected: true }),
    });
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

  it("fits the image to the screen, and toggles actual size when the image is clicked", async () => {
    // It opened at the file's own size: a small handout sat tiny mid-window, and a large
    // map ran off the bottom with its scale bar. It is shown to the table, so it fits.
    const { container } = render(ImageBlockView, { props: makeProps() });
    await flushImageLoad();
    await fireEvent.click(container.querySelector("[data-lightbox-btn]") as HTMLElement);

    const img = await waitFor(() => {
      const el = document.body.querySelector("[data-lightbox-img]") as HTMLImageElement;
      expect(el).toBeTruthy();
      return el;
    });
    expect(img.className).toMatch(/h-full w-full/);
    expect(img.className).toMatch(/object-contain/);

    await fireEvent.click(img);
    expect(img.className).toMatch(/max-w-none/);
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

describe("showing an image to the table", () => {
  it("opens on a double-click of the image itself", async () => {
    const { container } = render(ImageBlockView, { props: makeProps({ selected: false }) });
    await flushImageLoad();
    await fireEvent.dblClick(container.querySelector("img") as HTMLElement);
    await waitFor(() => expect(document.body.querySelector("[data-image-lightbox]")).toBeTruthy());
  });

  it("is named by what the image shows, and draws no caption", async () => {
    // The caption is the GM's note about the image, and may say what the players
    // should not yet know.
    const { container } = render(ImageBlockView, { props: makeProps() });
    await flushImageLoad();
    await fireEvent.click(container.querySelector("[data-lightbox-btn]") as HTMLElement);
    const viewer = await waitFor(() => {
      const el = document.body.querySelector("[data-image-lightbox]") as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    expect(viewer).toHaveAttribute("aria-label", "A portrait");
    expect(viewer.textContent).not.toContain("A portrait");
  });

  it("opens from the image block's own event, which Enter and Space on a selection send", async () => {
    // Space used to delete a selected image — the key a GM presses to show it.
    // Mounted as the connector mounts it: inside the node view's own element.
    const host = document.createElement("div");
    host.setAttribute("data-image-block", "");
    document.body.appendChild(host);
    render(ImageBlockView, { props: makeProps(), target: host });
    await flushImageLoad();
    host.dispatchEvent(new CustomEvent("image-block:open-viewer"));
    await waitFor(() => expect(document.body.querySelector("[data-image-lightbox]")).toBeTruthy());
  });
});

describe("the image block's toolbar", () => {
  it("offers Replace for any image, not only a missing one", async () => {
    const { getByLabelText } = render(ImageBlockView, { props: makeProps() });
    await flushImageLoad();
    expect(getByLabelText("Replace image")).toHaveAttribute("title", "Replace image");
  });
});
