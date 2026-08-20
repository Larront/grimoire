import { describe, it, expect, afterEach } from "vitest";
import { ImageBlock, isImageFile, serializeImageNode } from "$lib/editor/image-block";

function makeFile(name: string, type: string): File {
  return new File([], name, { type });
}

describe("isImageFile", () => {
  it.each([
    ["image/jpeg", "photo.jpg"],
    ["image/jpeg", "photo.jpeg"],
    ["image/png", "img.png"],
    ["image/gif", "anim.gif"],
    ["image/webp", "img.webp"],
  ])("accepts %s", (type, name) => {
    expect(isImageFile(makeFile(name, type))).toBe(true);
  });

  it.each([
    ["image/svg+xml", "icon.svg"],
    ["application/pdf", "doc.pdf"],
    ["audio/mp3", "track.mp3"],
    ["text/plain", "readme.txt"],
    ["", "noext"],
  ])("rejects %s", (type, name) => {
    expect(isImageFile(makeFile(name, type))).toBe(false);
  });
});

// ─── serializeImageNode ──────────────────────────────────────────────────────

describe("serializeImageNode", () => {
  it("no attrs, no caption → ![](src)", () => {
    expect(
      serializeImageNode({
        attrs: {
          src: "images/a.png",
          alt: null,
          align: "center",
          width: "100%",
        },
      }),
    ).toBe("![](images/a.png)");
  });

  it("caption only → ![caption](src) (no attrs block)", () => {
    expect(
      serializeImageNode({
        attrs: {
          src: "images/a.png",
          alt: "portrait",
          align: "center",
          width: "100%",
        },
      }),
    ).toBe("![portrait](images/a.png)");
  });

  it("align only → ![](src){align=left}", () => {
    expect(
      serializeImageNode({
        attrs: { src: "images/a.png", alt: null, align: "left", width: "100%" },
      }),
    ).toBe("![](images/a.png){align=left}");
  });

  it("width only → ![](src){width=60%}", () => {
    expect(
      serializeImageNode({
        attrs: {
          src: "images/a.png",
          alt: null,
          align: "center",
          width: "60%",
        },
      }),
    ).toBe("![](images/a.png){width=60%}");
  });

  it("caption + align → ![caption](src){align=right}", () => {
    expect(
      serializeImageNode({
        attrs: {
          src: "images/a.png",
          alt: "portrait",
          align: "right",
          width: "100%",
        },
      }),
    ).toBe("![portrait](images/a.png){align=right}");
  });

  it("caption + width → ![caption](src){width=50%}", () => {
    expect(
      serializeImageNode({
        attrs: {
          src: "images/a.png",
          alt: "portrait",
          align: "center",
          width: "50%",
        },
      }),
    ).toBe("![portrait](images/a.png){width=50%}");
  });

  it("caption + align + width → ![caption](src){align=left width=75%}", () => {
    expect(
      serializeImageNode({
        attrs: {
          src: "images/a.png",
          alt: "portrait",
          align: "left",
          width: "75%",
        },
      }),
    ).toBe("![portrait](images/a.png){align=left width=75%}");
  });

  it("empty string alt treated same as null", () => {
    expect(
      serializeImageNode({
        attrs: { src: "images/a.png", alt: "", align: "center", width: "100%" },
      }),
    ).toBe("![](images/a.png)");
  });

  it("special chars in caption are preserved exactly", () => {
    const caption = 'café [brackets] (parens) "quotes"';
    expect(
      serializeImageNode({
        attrs: {
          src: "images/a.png",
          alt: caption,
          align: "center",
          width: "100%",
        },
      }),
    ).toBe(`![${caption}](images/a.png)`);
  });

  it("unicode caption survives", () => {
    expect(
      serializeImageNode({
        attrs: {
          src: "images/a.png",
          alt: "人物の肖像",
          align: "left",
          width: "60%",
        },
      }),
    ).toBe("![人物の肖像](images/a.png){align=left width=60%}");
  });
});

// ─── Extension markdown serializer wiring ────────────────────────────────────
//
// @tiptap/markdown reads a node's serializer from the `renderMarkdown` extension
// field (via getExtensionField), NOT from `storage.markdown.serialize`. If this
// field is missing or misnamed, getMarkdown() drops the custom align/width attrs
// (and for non-builtin nodes, the whole node) on save.
describe("ImageBlock renderMarkdown", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderMarkdown = (ImageBlock.config as any).renderMarkdown as
    | ((node: {
        attrs: {
          src: string;
          alt: string | null;
          align: string;
          width: string;
        };
      }) => string)
    | undefined;

  it("exposes a renderMarkdown serializer (the field @tiptap/markdown reads)", () => {
    expect(typeof renderMarkdown).toBe("function");
  });

  it("serializes align/width attrs that would otherwise be lost", () => {
    const attrs = {
      src: "images/a.png",
      alt: "portrait",
      align: "left",
      width: "75%",
    };
    expect(renderMarkdown!({ attrs })).toBe("![portrait](images/a.png){align=left width=75%}");
  });
});

// ─── Node view: ProseMirror event handling ────────────────────────────────────
//
// Image's use of the shared connector's event hole (ADR-0016 §4). A mousedown
// must reach ProseMirror or the image cannot be selected at all, which is the
// divergence the connector must not paper over; a resize drag must not.

interface TestNodeView {
  dom: HTMLElement;
  stopEvent: (event: Event) => boolean;
  destroy: () => void;
}

describe("ImageBlock node view — event handling", () => {
  let mounted: TestNodeView | null = null;
  let outsideEl: HTMLElement | null = null;

  afterEach(() => {
    mounted?.destroy();
    mounted?.dom.remove();
    mounted = null;
    outsideEl?.remove();
    outsideEl = null;
  });

  // Node views are mounted imperatively against a fake editor: nothing here
  // writes an attribute, so the editor only has to exist.
  function mountNodeView(): TestNodeView {
    const addNodeView = (
      ImageBlock.config as unknown as {
        addNodeView: () => (props: {
          node: unknown;
          getPos: () => number;
          editor: unknown;
        }) => TestNodeView;
      }
    ).addNodeView;

    const view = addNodeView()({
      node: {
        type: { name: "image" },
        attrs: { src: "images/a.png", alt: "", align: "center", width: "100%" },
      },
      getPos: () => 1,
      editor: { commands: { command: () => true } },
    });
    document.body.appendChild(view.dom);
    mounted = view;
    return view;
  }

  function eventOn(target: globalThis.Node, type: string): Event {
    return { type, target } as unknown as Event;
  }

  it("lets a mousedown through so ProseMirror can select the image", () => {
    const view = mountNodeView();
    const inside = view.dom.firstElementChild ?? view.dom;

    expect(view.stopEvent(eventOn(inside, "mousedown"))).toBe(false);
  });

  it("keeps everything while a resize drag is underway, wherever the pointer is", () => {
    const view = mountNodeView();
    outsideEl = document.body.appendChild(document.createElement("div"));

    expect(view.stopEvent(eventOn(outsideEl, "mousemove"))).toBe(false);

    view.dom.setAttribute("data-resizing", "");
    expect(view.stopEvent(eventOn(outsideEl, "mousemove"))).toBe(true);
    expect(view.stopEvent(eventOn(outsideEl, "mousedown"))).toBe(true);
  });
});
