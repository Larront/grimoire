import Image from "@tiptap/extension-image";
import { api } from "$lib/api";
import type { Editor } from "@tiptap/core";
import ImageBlockView from "$lib/components/editor/ImageBlockView.svelte";
import {
  createBlockNodeView,
  type BlockView,
} from "$lib/editor/node-view-connector";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Image draws its own selected state, so its view must accept one. */
interface ImageBlockViewExports extends BlockView {
  setSelected: (selected: boolean) => void;
}

// ─── Markdown preprocessor ────────────────────────────────────────────────────
// Converts  ![alt](src){align=left width=60%}
// to        <img src="src" alt="alt" data-align="left" data-width="60%">
// so TipTap's HTML parser can read the custom attributes.

const ATTR_RE = /!\[([^\]]*)\]\(([^)]+)\)\{([^}]+)\}/g;

export function preprocessImageAttrs(markdown: string): string {
  return markdown.replace(ATTR_RE, (_, alt, src, attrsStr) => {
    const attrs: Record<string, string> = {};
    for (const pair of attrsStr.trim().split(/\s+/)) {
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      attrs[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
    const align = attrs.align ?? "center";
    const width = attrs.width ?? "100%";
    const safeAlt = alt.replace(/"/g, "&quot;");
    const safeSrc = src.replace(/"/g, "&quot;");
    return `<img src="${safeSrc}" alt="${safeAlt}" data-align="${align}" data-width="${width}">`;
  });
}

// ─── Markdown serializer ─────────────────────────────────────────────────────

/**
 * Serializes an image node to markdown, encoding non-default align/width as a
 * trailing `{align=… width=…}` attr block that preprocessImageAttrs() reverses
 * on load. Returns the string directly so it can be wired into the extension's
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
        parseHTML: (el) =>
          (el as HTMLElement).getAttribute("data-align") ?? "center",
        renderHTML: (attrs) => ({ "data-align": attrs.align }),
      },
      width: {
        default: "100%",
        parseHTML: (el) =>
          (el as HTMLElement).getAttribute("data-width") ?? "100%",
        renderHTML: (attrs) => ({ "data-width": attrs.width }),
      },
    };
  },

  // @ts-expect-error — renderMarkdown is read by @tiptap/markdown via getExtensionField
  renderMarkdown(node: {
    attrs: { src: string; alt: string | null; align: string; width: string };
  }) {
    return serializeImageNode(node);
  },

  addNodeView() {
    return createBlockNodeView<ImageBlockViewExports>({
      component: ImageBlockView,
      domAttrs: { "data-image-block": "" },
      defaults: { src: "", alt: "", align: "center", width: "100%" },
      drawsOwnSelection: true,
      props: ({ updateAttributes }) => ({
        onUpdate: updateAttributes,
        onCaptionUpdate: (alt: string) => updateAttributes({ alt }),
        onSrcReplace: (src: string) => updateAttributes({ src }),
      }),

      // Image's use of the connector's event hole: a mousedown must reach
      // ProseMirror so it can select this node, and a resize drag must not.
      stopEvent: ({ dom }) => (event) => {
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

export async function insertImageFromHandle(
  file: File,
  editor: Editor,
): Promise<void> {
  const filePath = (file as File & { path?: string }).path;
  let src: string;

  if (filePath) {
    src = await api.copyImageFile(filePath);
  } else {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    src = await api.saveImageBytes(
      bytes,
      file.name || `pasted-image.${mimeToExt(file.type)}`,
    );
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

export async function insertImageFromFile(
  absolutePath: string,
  editor: Editor,
): Promise<void> {
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
