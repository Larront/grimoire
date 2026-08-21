import Image from "@tiptap/extension-image";
import { api } from "$lib/api";
import type { Editor } from "@tiptap/core";
import ImageBlockView from "$lib/components/editor/ImageBlockView.svelte";
import { createBlockNodeView, type BlockView } from "$lib/editor/node-view-connector";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * What an image node holds (#209) — the record the node view and the view are both typed
 * against.
 *
 * Not derived from a `blockDom` table like the fenced blocks', and it is the one block
 * where that would be wrong: `src`, `alt` and `title` are TipTap's own attributes on the
 * extension this one extends, written as real HTML attributes rather than as a dataset of
 * a record, and `align` and `width` render themselves through the schema. So the record is
 * declared here and the attributes stay where they are, checked against each other by the
 * connector rather than by a table.
 *
 * `alt` is a string here and nullable in the document, which the node view's stand-ins
 * settle before the view ever sees it. `title` is TipTap's, never written by Grimoire and
 * never read by the view; it is named because a record that hid an attribute would be the
 * silent-loss shape all over again.
 */
export interface ImageAttrs {
  src: string;
  alt: string;
  align: string;
  width: string;
  title: string | null;
}

/** Image draws its own selected state, so its view must accept one. */
interface ImageBlockViewExports extends BlockView<ImageAttrs> {
  setSelected: (selected: boolean) => void;
}

// ─── Markdown declaration ─────────────────────────────────────────────────────
//
// Image is the one block whose syntax is not a fence, so it declares a tokenizer
// rather than making a fence claim: `![alt](src){align=left width=60%}` has to
// arrive as *one* token, and the reader's own image rule stops at the closing
// paren, leaving the suffix behind as loose text.
//
// The token it produces is an ordinary `image` token with two extra fields, so
// one parse handler below covers both a plain image and an aligned one.

/**
 * `![alt](src){align=… width=…}`, anchored: a tokenizer is offered the rest of the
 * line. The src is read up to the closing paren and may hold spaces — Grimoire
 * keeps a copied image's original filename, so `.grimoire/images/my map.png` is an
 * ordinary path rather than an edge case.
 */
const IMAGE_WITH_ATTRS_RE = /^!\[([^\]]*)\]\(([^)]+)\)\{([^}]+)\}/;

/** `align=left width=60%` → `{ align: "left", width: "60%" }`. */
function parseImageAttrs(attrsStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const pair of attrsStr.trim().split(/\s+/)) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    attrs[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return attrs;
}

// ─── Markdown serializer ─────────────────────────────────────────────────────

/**
 * Serializes an image node to markdown, encoding non-default align/width as a
 * trailing `{align=… width=…}` attr block that the tokenizer above reads back on
 * load. Returns the string directly so it can be wired into the extension's
 * `renderMarkdown` field — the hook @tiptap/markdown actually reads.
 */
export function serializeImageNode(node: {
  attrs: {
    src: string;
    alt: string | null;
    align: string;
    width: string;
  };
}): string {
  const { src, alt, align, width } = node.attrs;
  let md = `![${alt ?? ""}](${src})`;
  const parts: string[] = [];
  if (align !== "center") parts.push(`align=${align}`);
  if (width !== "100%") parts.push(`width=${width}`);
  if (parts.length) md += `{${parts.join(" ")}}`;
  return md;
}

// ─── Extension ────────────────────────────────────────────────────────────────

export const ImageBlock = Image.extend({
  inline: false,
  group: "block",

  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: "center",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-align") ?? "center",
        renderHTML: (attrs) => ({ "data-align": attrs.align }),
      },
      width: {
        default: "100%",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-width") ?? "100%",
        renderHTML: (attrs) => ({ "data-width": attrs.width }),
      },
    };
  },

  markdownTokenizer: {
    name: "imageWithAttrs",
    level: "inline",
    // Where a match could begin, so the reader stops its plain-text run there
    // rather than swallowing the image into a paragraph's prose.
    start: (src: string) => src.indexOf("!["),
    tokenize: (src: string) => {
      const match = IMAGE_WITH_ATTRS_RE.exec(src);
      if (!match) return undefined;
      const [raw, alt, href, attrsStr] = match;
      const attrs = parseImageAttrs(attrsStr);
      return {
        type: "image",
        raw,
        href,
        text: alt,
        align: attrs.align,
        width: attrs.width,
      };
    },
  },

  // Both shapes of image token land here: the tokenizer's, carrying the suffix's
  // align and width, and the reader's own for a plain `![alt](src)`.
  parseMarkdown: (token, helpers) =>
    helpers.createNode("image", {
      src: token.href ?? "",
      alt: token.text ?? "",
      title: token.title ?? null,
      align: token.align ?? "center",
      width: token.width ?? "100%",
    }),

  // @ts-expect-error — renderMarkdown is read by @tiptap/markdown via getExtensionField
  renderMarkdown(node: {
    attrs: { src: string; alt: string | null; align: string; width: string };
  }) {
    return serializeImageNode(node);
  },

  addNodeView() {
    return createBlockNodeView<ImageAttrs, ImageBlockViewExports>({
      component: ImageBlockView,
      domAttrs: { "data-image-block": "", "data-note-block": "image" },
      defaults: {
        src: "",
        alt: "",
        align: "center",
        width: "100%",
        title: null,
      },
      drawsOwnSelection: true,
      props: ({ updateAttributes }) => ({
        onUpdate: updateAttributes,
        onCaptionUpdate: (alt: string) => updateAttributes({ alt }),
        onSrcReplace: (src: string) => updateAttributes({ src }),
      }),

      // Image's use of the connector's event hole: a mousedown must reach
      // ProseMirror so it can select this node, and a resize drag must not.
      stopEvent:
        ({ dom }) =>
        (event) => {
          if (dom.hasAttribute("data-resizing")) return true;
          if (event.type === "mousedown") return false;
          return undefined;
        },
    });
  },
});

// ─── Insertion helpers ────────────────────────────────────────────────────────

const IMAGE_MIME = /^image\/(jpeg|png|gif|webp)$/;

export function isImageFile(file: File): boolean {
  return IMAGE_MIME.test(file.type);
}

function mimeToExt(type: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  return map[type] ?? "png";
}

export async function insertImageFromHandle(file: File, editor: Editor): Promise<void> {
  const filePath = (file as File & { path?: string }).path;
  let src: string;

  if (filePath) {
    src = await api.copyImageFile(filePath);
  } else {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    src = await api.saveImageBytes(bytes, file.name || `pasted-image.${mimeToExt(file.type)}`);
  }

  editor
    .chain()
    .focus()
    .insertContent({
      type: "image",
      attrs: { src, align: "center", width: "100%" },
    })
    .run();
}

export async function insertImageFromFile(absolutePath: string, editor: Editor): Promise<void> {
  const src = await api.copyImageFile(absolutePath);
  editor
    .chain()
    .focus()
    .insertContent({
      type: "image",
      attrs: { src, align: "center", width: "100%" },
    })
    .run();
}
