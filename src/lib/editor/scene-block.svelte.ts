// src/lib/editor/extensions/scene-block.svelte.ts
import { Node, mergeAttributes } from "@tiptap/core";
import { mount, unmount } from "svelte";
import SceneBlockView from "$lib/components/editor/SceneBlockView.svelte";

interface SceneBlockExports {
  setAttrs: (sceneId: number | null, expanded: boolean) => void;
}

export const SceneBlock = Node.create({
  name: "sceneBlock",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      sceneId: {
        default: null,
        parseHTML: (el) => {
          const raw = (el as HTMLElement).dataset.id;
          if (!raw) return null;
          const n = Number(raw);
          return isNaN(n) ? null : n;
        },
      },
      expanded: {
        default: false,
        parseHTML: (el) => (el as HTMLElement).dataset.expanded === "true",
      },
    };
  },

  parseHTML() {
    return [{ tag: "scene-block" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "scene-block",
      mergeAttributes(
        {
          "data-id": node.attrs.sceneId ?? "",
          "data-expanded": String(node.attrs.expanded),
        },
        HTMLAttributes,
      ),
    ];
  },

  // @ts-expect-error — renderMarkdown is read by @tiptap/markdown via getExtensionField
  renderMarkdown(node: {
    attrs: { sceneId: number | null; expanded: boolean };
  }) {
    const id = node.attrs.sceneId ?? "";
    const exp = String(node.attrs.expanded);
    return `<scene-block data-id="${id}" data-expanded="${exp}"></scene-block>`;
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("div");
      dom.className = "scene-block-wrapper";
      dom.setAttribute("contenteditable", "false");

      function handleUpdate(attrs: {
        sceneId: number | null;
        expanded: boolean;
      }) {
        const pos = getPos();
        if (pos === undefined) return;
        editor.commands.command(({ tr }) => {
          tr.setNodeMarkup(pos, undefined, {
            sceneId: attrs.sceneId,
            expanded: attrs.expanded,
          });
          return true;
        });
      }

      const raw = mount(SceneBlockView, {
        target: dom,
        props: {
          sceneId: node.attrs.sceneId ?? null,
          expanded: node.attrs.expanded ?? false,
          onUpdate: handleUpdate,
        },
      });
      const component = raw as unknown as SceneBlockExports;

      // Track whether a range input drag is in progress.
      // stopEvent with dom.contains() alone isn't enough — when the mouse strays
      // outside dom during a drag, event.target is no longer inside dom, so
      // ProseMirror's document-level mousemove handler takes over and kills the drag.
      let isDraggingSlider = false;
      dom.addEventListener("mousedown", (e) => {
        const t = e.target as HTMLElement;
        if (t instanceof HTMLInputElement && t.type === "range") {
          isDraggingSlider = true;
          const onMouseUp = () => {
            isDraggingSlider = false;
            window.removeEventListener("mouseup", onMouseUp);
          };
          window.addEventListener("mouseup", onMouseUp);
        }
      });

      return {
        dom,
        // Block all ProseMirror event handling while a slider is being dragged,
        // and for any event that originates inside our node view DOM.
        stopEvent(event) {
          if (isDraggingSlider) return true;
          return dom.contains(event.target as unknown as globalThis.Node);
        },
        update(updatedNode) {
          if (updatedNode.type !== node.type) return false;
          component.setAttrs(
            updatedNode.attrs.sceneId ?? null,
            updatedNode.attrs.expanded ?? false,
          );
          return true;
        },
        destroy() {
          unmount(raw);
        },
      };
    };
  },
});
