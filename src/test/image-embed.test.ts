// Obsidian's image embeds, `![[map.png]]` (2026-10 design review): they showed as the
// raw text. They draw as images now, found by name in the world, and the note keeps them
// as written until the GM changes the image.
import { render, cleanup, fireEvent, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { note, closeNote } from "./fixtures/note-editor";
import ImageBlockView from "$lib/components/editor/ImageBlockView.svelte";

afterEach(() => {
  closeNote();
  cleanup();
  vi.mocked(invoke).mockResolvedValue(null);
});

const images = (md: string) => {
  const editor = note(md);
  const found: Record<string, unknown>[] = [];
  editor.state.doc.descendants((n) => {
    if (n.type.name === "image") found.push(n.attrs);
  });
  return { editor, found };
};

describe("an image embed in a note", () => {
  it("reads as an image, keeping what the embed said", () => {
    const { found } = images("The vale:\n\n![[Ashfen Map.png|300]]\n");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ embed: "Ashfen Map.png|300", src: "" });
  });

  it("is written back exactly as it was", () => {
    const md = "The vale:\n\n![[Attachments/Ashfen Map.png|300]]\n";
    const { editor } = images(md);
    expect(editor.getMarkdown().trimEnd()).toBe(md.trimEnd());
  });

  it("leaves a note's embed as the text the GM typed", () => {
    const { found, editor } = images("See ![[Thornhaven Village]] for more.\n");
    expect(found).toHaveLength(0);
    expect(editor.getMarkdown()).toContain("![[Thornhaven Village]]");
  });

  it("leaves Grimoire's own images as they were", () => {
    const md = "![portrait](.grimoire/images/mira.png){align=left width=40%}\n";
    const { editor } = images(md);
    expect(editor.getMarkdown().trimEnd()).toBe(md.trimEnd());
  });
});

describe("the image an embed draws", () => {
  function props(overrides: Record<string, unknown> = {}) {
    return {
      src: "",
      alt: "",
      align: "center",
      width: "100%",
      title: null,
      embed: "Ashfen Map.png",
      selected: true,
      onUpdate: vi.fn(),
      onCaptionUpdate: vi.fn(),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "resolve_image_embed") {
        return (args as { target: string }).target.startsWith("Ashfen")
          ? "Attachments/Ashfen Map.png"
          : null;
      }
      if (cmd === "get_image_absolute_path") return `/world/${(args as { relativePath: string }).relativePath}`;
      return null;
    });
  });

  it("finds its file by name and draws it", async () => {
    const { container } = render(ImageBlockView, { props: props() });
    await waitFor(() => expect(container.querySelector("img")).toBeTruthy());
    expect(
      vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === "resolve_image_embed")?.[1],
    ).toMatchObject({ target: "Ashfen Map.png" });
  });

  it("is drawn at the width in pixels an embed gives, never past the column", async () => {
    // The view draws onto its node view's element, which the connector makes; stand in.
    const host = document.body.appendChild(document.createElement("div"));
    host.setAttribute("data-image-block", "");
    const { container } = render(ImageBlockView, {
      props: props({ embed: "Ashfen Map.png|300" }),
      target: host,
    });
    await waitFor(() => expect(container.querySelector("img")).toBeTruthy());
    expect(host.style.getPropertyValue("--image-width")).toBe("min(100%, 300px)");
  });

  it("says it can't find a file the world doesn't hold, naming the file", async () => {
    const { getByText } = render(ImageBlockView, {
      props: props({ embed: "Lost.png|300" }),
    });
    await waitFor(() => expect(getByText("This image was moved or deleted")).toBeTruthy());
    expect(getByText("Lost.png")).toBeTruthy();
  });

  it("is written Grimoire's way, at the path it was found at, once the GM changes it", async () => {
    const p = props();
    const { container, getByLabelText } = render(ImageBlockView, { props: p });
    await waitFor(() => expect(container.querySelector("img")).toBeTruthy());

    await fireEvent.click(getByLabelText("Align left"));

    expect(p.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ align: "left", src: "Attachments/Ashfen Map.png", embed: null }),
    );
  });
});
