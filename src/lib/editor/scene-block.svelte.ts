import { Node, mergeAttributes } from "@tiptap/core";
import SceneBlockView from "$lib/components/editor/SceneBlockView.svelte";
import { createBlockNodeView } from "$lib/editor/node-view-connector";

// ─── Reading a scene-block tag ────────────────────────────────────────────────
//
// Scene's on-disk form is still an HTML tag: the ` ```scene ` fence carrying the
// id *and* the scene's name is the vault migration's change, behind the ledger
// format version stamp. What this file owns is the two readers below, which the
// element path and the markdown path share so they cannot drift apart.

/** The scene a tag references, or null when it references none. */
function readSceneId(el: Element): number | null {
  const raw = (el as HTMLElement).dataset.id;
  if (!raw) return null;
  const n = Number(raw);
  return isNaN(n) ? null : n;
}

function readExpanded(el: Element): boolean {
  return (el as HTMLElement).dataset.expanded === "true";
}

/**
 * A `<scene-block …>` tag on its own, and nothing else — paired as Grimoire
 * writes it, or self-closing as a GM may have hand-written it.
 */
const SCENE_TAG_RE = /^\s*<scene-block\b[^>]*(?:\/>|>\s*<\/scene-block>)\s*$/i;

export const SceneBlock = Node.create({
  name: "sceneBlock",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      sceneId: {
        default: null,
        parseHTML: readSceneId,
      },
      expanded: {
        default: false,
        parseHTML: readExpanded,
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

  // Scene's declaration to the markdown reader. Its own form is not a fence, so
  // it claims the HTML token instead — and only when that token is a scene-block
  // tag and nothing else, so a GM's hand-written HTML still reaches the reader's
  // general HTML handling untouched.
  markdownTokenName: "html",

  parseMarkdown: (token) => {
    const raw = String(token.raw ?? token.text ?? "");
    if (!SCENE_TAG_RE.test(raw)) return [];
    const holder = document.createElement("div");
    holder.innerHTML = raw.trim();
    const el = holder.firstElementChild;
    if (!el) return [];
    return {
      type: "sceneBlock",
      attrs: { sceneId: readSceneId(el), expanded: readExpanded(el) },
    };
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
