import { render, fireEvent, waitFor } from "@testing-library/svelte";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { tick } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import ImageBlockView from "$lib/components/editor/ImageBlockView.svelte";

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    src: "images/missing.png",
    alt: "A portrait",
    align: "right",
    width: "75%",
    selected: false,
    onUpdate: vi.fn(),
    onCaptionUpdate: vi.fn(),
    onSrcReplace: vi.fn(),
    ...overrides,
  };
}

async function flushBrokenState() {
  await tick();
  await tick();
  await tick();
}

describe("Image replace action on broken state", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.mocked(invoke).mockReset();
    vi.mocked(open).mockReset();
  });

  it("does not render Replace button when image loads successfully", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_image_absolute_path") return "/abs/images/portrait.png";
      return null;
    });
    const { container } = render(ImageBlockView, { props: makeProps() });
    await flushBrokenState();
    expect(container.querySelector("[data-replace-btn]")).toBeNull();
  });

  it("renders Replace button on the not-found placeholder when image is missing", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_image_absolute_path") throw new Error("not found");
      return null;
    });
    const { container } = render(ImageBlockView, { props: makeProps() });
    await waitFor(() => {
      expect(container.querySelector("[data-replace-btn]")).toBeTruthy();
    });
  });

  it("clicking Replace calls onSrcReplace with new src; does NOT change caption/align/width", async () => {
    const onUpdate = vi.fn();
    const onCaptionUpdate = vi.fn();
    const onSrcReplace = vi.fn();
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_image_absolute_path") throw new Error("not found");
      if (cmd === "copy_image_file") {
        const a = args as { absolutePath: string };
        expect(a.absolutePath).toBe("/picked/new.png");
        return "images/new.png";
      }
      return null;
    });
    vi.mocked(open).mockResolvedValue("/picked/new.png");

    const { container } = render(ImageBlockView, {
      props: makeProps({ onUpdate, onCaptionUpdate, onSrcReplace }),
    });
    await waitFor(() => {
      expect(container.querySelector("[data-replace-btn]")).toBeTruthy();
    });

    const btn = container.querySelector("[data-replace-btn]") as HTMLElement;
    await fireEvent.click(btn);

    await waitFor(() => {
      expect(onSrcReplace).toHaveBeenCalledTimes(1);
      expect(onSrcReplace).toHaveBeenCalledWith("images/new.png");
    });
    // caption/align/width must NOT be re-emitted — they are preserved via the
    // node view's partial-attrs merge, not by re-sending them through these callbacks.
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onCaptionUpdate).not.toHaveBeenCalled();
  });

  it("cancelling the file picker leaves the node untouched", async () => {
    const onSrcReplace = vi.fn();
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_image_absolute_path") throw new Error("not found");
      return null;
    });
    vi.mocked(open).mockResolvedValue(null);

    const { container } = render(ImageBlockView, {
      props: makeProps({ onSrcReplace }),
    });
    await waitFor(() => {
      expect(container.querySelector("[data-replace-btn]")).toBeTruthy();
    });

    await fireEvent.click(container.querySelector("[data-replace-btn]") as HTMLElement);
    await tick();
    await tick();

    expect(onSrcReplace).not.toHaveBeenCalled();
  });

  it("does not call onSrcReplace when copy_image_file rejects (unsupported file)", async () => {
    const onSrcReplace = vi.fn();
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_image_absolute_path") throw new Error("not found");
      if (cmd === "copy_image_file") throw new Error("Unsupported image format: .svg");
      return null;
    });
    vi.mocked(open).mockResolvedValue("/picked/icon.svg");

    const { container } = render(ImageBlockView, {
      props: makeProps({ onSrcReplace }),
    });
    await waitFor(() => {
      expect(container.querySelector("[data-replace-btn]")).toBeTruthy();
    });

    await fireEvent.click(container.querySelector("[data-replace-btn]") as HTMLElement);
    await tick();
    await tick();
    await tick();

    expect(onSrcReplace).not.toHaveBeenCalled();
  });
});
