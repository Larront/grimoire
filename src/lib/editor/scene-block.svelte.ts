import { Node, mergeAttributes } from "@tiptap/core";
import SceneBlockView from "$lib/components/editor/SceneBlockView.svelte";
import { createBlockNodeView } from "$lib/editor/node-view-connector";

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
    return createBlockNodeView({
      component: SceneBlockView,
      class: "scene-block-wrapper",
      defaults: { sceneId: null, expanded: false },
      props: ({ updateAttributes }) => ({ onUpdate: updateAttributes }),

      // Scene's use of the connector's event hole: hold a slider drag that
      // leaves the node view. The connector's default — anything raised inside
      // dom is ours — is not enough, because when the mouse strays outside dom
      // during a drag the target is no longer inside it, so ProseMirror's
      // document-level mousemove handler takes over and kills the drag.
      stopEvent: ({ dom }) => {
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
        return () => (isDraggingSlider ? true : undefined);
      },
    });
  },
});
