import Image from "@tiptap/extension-image";
import { invoke } from "@tauri-apps/api/core";
import { mount, unmount } from "svelte";
import type { Editor } from "@tiptap/core";
import ImageBlockView from "$lib/components/editor/ImageBlockView.svelte";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ImageBlockViewExports {
  setAttrs: (align: string, width: string, src: string, alt: string) => void;
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

  addStorage() {
    return {
      markdown: {
        serialize(
          state: {
            write: (s: string) => void;
            closeBlock: (n: unknown) => void;
          },
          node: {
            attrs: {
              src: string;
              alt: string | null;
              align: string;
              width: string;
            };
          },
        ) {
          const { src, alt, align, width } = node.attrs;
          let md = `![${alt ?? ""}](${src})`;
          const parts: string[] = [];
          if (align !== "center") parts.push(`align=${align}`);
          if (width !== "100%") parts.push(`width=${width}`);
          if (parts.length) md += `{${parts.join(" ")}}`;
          state.write(md);
          state.closeBlock(node);
        },
      },
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement("div");
      dom.setAttribute("contenteditable", "false");
      dom.setAttribute("data-image-block", "");

      function handleUpdate(attrs: { align: string; width: string }) {
        const pos = (getPos as () => number | undefined)();
        if (pos === undefined) return;
        editor.commands.command(({ tr }) => {
          const currentNode = tr.doc.nodeAt(pos);
          if (!currentNode) return false;
          tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, ...attrs });
          return true;
        });
      }

      const raw = mount(ImageBlockView, {
        target: dom,
        props: {
          src: node.attrs.src ?? "",
          alt: node.attrs.alt ?? "",
          align: node.attrs.align ?? "center",
          width: node.attrs.width ?? "100%",
          onUpdate: handleUpdate,
        },
      });
      const component = raw as unknown as ImageBlockViewExports;

      return {
        dom,
        stopEvent(event: Event) {
          if (dom.hasAttribute("data-resizing")) return true;
          // Let mousedown reach ProseMirror so it can select this node
          if (event.type === "mousedown") return false;
          return dom.contains(event.target as globalThis.Node);
        },
        update(updatedNode) {
          if (updatedNode.type !== node.type) return false;
          component.setAttrs(
            updatedNode.attrs.align ?? "center",
            updatedNode.attrs.width ?? "100%",
            updatedNode.attrs.src ?? "",
            updatedNode.attrs.alt ?? "",
          );
          return true;
        },
        selectNode() {
          component.setSelected(true);
        },
        deselectNode() {
          component.setSelected(false);
        },
        destroy() {
          unmount(raw);
        },
      };
    };
  },
});

// ─── Insertion helpers ────────────────────────────────────────────────────────

const IMAGE_MIME = /^image\/(jpeg|png|gif|webp|svg\+xml)$/;

export function isImageFile(file: File): boolean {
  return IMAGE_MIME.test(file.type);
}

function mimeToExt(type: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
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
    src = await invoke<string>("copy_image_file", { absolutePath: filePath });
  } else {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    src = await invoke<string>("save_image_bytes", {
      bytes,
      filename: file.name || `pasted-image.${mimeToExt(file.type)}`,
    });
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
  const src = await invoke<string>("copy_image_file", { absolutePath });
  editor
    .chain()
    .focus()
    .insertContent({
      type: "image",
      attrs: { src, align: "center", width: "100%" },
    })
    .run();
}
