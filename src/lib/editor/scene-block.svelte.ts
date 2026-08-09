// The Scene reference — a fenced block naming the [[Scene]] a note plays (#185).
//
// On disk:
//
//     ```scene
//     # Boss Battle
//     Id: 1
//     ```
//
// which replaced `<scene-block data-id="1" data-expanded="false"></scene-block>`.
// A GM opening the note in Obsidian used to see that tag where a scene reference
// should be; now they see the scene's name. The legacy reader is **deleted** — the
// [[Ledger Format Version]] stamp is the guarantee that no file still holds a tag,
// so no shim lives underneath. Named cost, accepted: an old tag hand-pasted into an
// up-to-date vault is unrecognised, dropped at parse, and gone on the next autosave.
//
// ── Why the name is in the file at all ───────────────────────────────────────
//
// The id is the truth; the name is a **copy of a value the database owns**, and it
// was put here knowingly against the recommendation. A copy goes stale, and a stale
// name does not fail loudly — it *lies*: search finds the note under a name the
// scene no longer has and misses its current one. It was accepted because both wins
// being chased are about humans reading text — the hover preview and full-text
// search — and an id alone buys neither. Addressing by name instead was never
// available: scene names have no uniqueness constraint.
//
// The price is paid on the other side: **renaming a scene rewrites the name in every
// note referencing it** (`src-tauri/src/scene_fence.rs`), through the path that
// already rewrites wikilinks on a note rename. A cache with an owner elsewhere is
// either synced or lying.
//
// Nothing reads the cached name back as authority. The view draws the scene's *live*
// name from the store and its not-found state when the id resolves to nothing, so a
// stale copy shows up as a name in a file and never as a name on screen.
//
// ── What is not here ─────────────────────────────────────────────────────────
//
// `expanded` is gone. It was view state persisted into the document, which ADR-0016
// §6 forbids; the mixer's collapse now lives in the view for as long as the view does.
//
// Scene remains ADR-0016 §1's **documented exception**: a scene is a database row
// with no ledger path, so it cannot be a legal reference. The fence makes the
// reference *legible*, not legal.
import { Node, mergeAttributes } from "@tiptap/core";
import SceneBlockView from "$lib/components/editor/SceneBlockView.svelte";
import { createBlockNodeView } from "$lib/editor/node-view-connector";
import { fenceInfo } from "$lib/editor/fence-claim";
import { oneLine } from "$lib/editor/labelled-row";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SceneRef {
  /** The scene this references, or null when it references none. */
  sceneId: number | null;
  /**
   * The scene's name as it was when the fence was last written — a legible copy,
   * never the authority. "" when the fence carries none.
   */
  sceneName: string;
}

/** What `/scene` inserts: a reference bound to nothing, so the picker opens. */
export function blankSceneRef(): SceneRef {
  return { sceneId: null, sceneName: "" };
}

// ─── Grammar ──────────────────────────────────────────────────────────────────
//
// Two optional lines, in the order a reader wants them: the name, then the id.
// `#` names the thing, matching Infobox, Statblock and Timeline — a GM meeting a
// third dialect meets the same convention in it.

/**
 * `# Boss Battle` — the remembered name, or null when the line is not one.
 *
 * A `#` line with nothing after it is *not* a name line, and that is deliberate: an
 * empty name has nothing to remember, so the serializer would not write the line
 * back and the pair would stop being inverse. Unlike an Infobox — where a bare `#`
 * is a shield over a first row that opens with `# ` — there is no row here to shield.
 */
function nameOf(line: string): string | null {
  return line.startsWith("# ") ? line.slice(2) : null;
}

/** `Id: 1` — a bare non-negative integer and nothing else. */
function idOf(line: string): number | null {
  const rest = line.startsWith("Id:") ? line.slice(3).trimStart() : null;
  if (rest === null || rest === "" || !/^\d+$/.test(rest)) return null;
  return Number(rest);
}

// ─── Parse ────────────────────────────────────────────────────────────────────

/**
 * The body of a fenced ```scene as the reference it names.
 *
 * Read forgivingly on order and on blank lines, so a file hand-edited in Obsidian
 * survives: either line may be absent, and the two may be swapped. What the format
 * has no reading for is **dropped** — a scene reference is two fields with nowhere
 * to put a third, unlike an Infobox where an unrecognised line is still a row. That
 * is the one place a hand-edit inside this fence loses characters, and it is the
 * documented cost of the fence holding exactly what it holds.
 *
 * Where a hand-edit gives either field twice, the **first** wins: a reference names
 * one scene, so a second `# …` line is a line the format has no reading for, like
 * any other. First rather than last because the scene rename that keeps the cached
 * name true rewrites the first one (`src-tauri/src/scene_fence.rs`) — the two must
 * agree about which line is the name, or a rename would update a line the editor
 * does not read.
 */
export function parseSceneBody(body: string): SceneRef {
  let sceneId: number | null = null;
  let sceneName = "";

  for (const line of body.split("\n")) {
    if (line.trim() === "") continue;
    const name = nameOf(line);
    if (name !== null) {
      if (!sceneName) sceneName = name;
      continue;
    }
    const id = idOf(line);
    if (id !== null && sceneId === null) sceneId = id;
  }

  return { sceneId, sceneName };
}

// ─── Serialize ────────────────────────────────────────────────────────────────

/**
 * A reference as its fence. Each line is omitted when it has nothing to say, so a
 * fresh `/scene` the GM never bound writes an empty fence rather than `Id:` with
 * no id after it.
 *
 * The pair is inverse over every record `parseSceneBody` can produce, which is what
 * ADR-0016 §2 rule 3 asks for: `getMarkdown()` rewrites the whole document on every
 * autosave, so a parser and serializer that disagree corrupt a note with no user
 * action. `oneLine` is what keeps that total against the *other* input — a scene
 * name arriving from the database, which the format holds on one line.
 */
export function serializeSceneRef(ref: SceneRef): string {
  const lines: string[] = [];
  if (ref.sceneName) lines.push(`# ${oneLine(ref.sceneName)}`);
  if (ref.sceneId !== null) lines.push(`Id: ${ref.sceneId}`);
  return ["```scene", ...lines, "```"].join("\n");
}

// ─── Extension ────────────────────────────────────────────────────────────────

export const SceneBlock = Node.create({
  name: "sceneBlock",
  group: "block",
  atom: true,
  // Draggable so a grip can carry it. ProseMirror will not drag a node whose spec does
  // not allow it, however the selection was made.
  draggable: true,

  addAttributes() {
    return {
      // Both read themselves back off the DOM: copying a reference inside the
      // editor goes out through `renderHTML` and back in through here, and an
      // attribute that only writes is one a copy-paste drops.
      sceneId: {
        default: null,
        parseHTML: (el) => {
          const raw = (el as HTMLElement).dataset.id;
          if (!raw) return null;
          const n = Number(raw);
          return isNaN(n) ? null : n;
        },
      },
      sceneName: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).dataset.name ?? "",
      },
    };
  },

  // The editor's *DOM* form, which is the clipboard and nothing else — never a
  // file. It is deliberately not the legacy `<scene-block>` element: that name
  // belongs to the on-disk form this ticket deleted, and reusing it would give the
  // reader's generic HTML handling a way to quietly repair a hand-pasted old tag
  // into a working reference, which is exactly what the deletion rules out.
  parseHTML() {
    return [{ tag: "scene-ref" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "scene-ref",
      mergeAttributes(
        {
          "data-id": node.attrs.sceneId ?? "",
          "data-name": node.attrs.sceneName ?? "",
        },
        HTMLAttributes,
      ),
    ];
  },

  // Scene's declaration to the markdown reader (ADR-0016 §3): a fenced code token
  // whose language is `scene` is one of these, at any nesting depth — inside a
  // Callout as readily as at column zero. Anything else is declined with `[]`.
  markdownTokenName: "code",

  parseMarkdown: (token) =>
    fenceInfo(token) === "scene"
      ? { type: "sceneBlock", attrs: parseSceneBody(token.text ?? "") }
      : [],

  // @ts-expect-error — renderMarkdown is read by @tiptap/markdown via getExtensionField
  renderMarkdown(node: { attrs: SceneRef }) {
    return serializeSceneRef(node.attrs);
  },

  addNodeView() {
    return createBlockNodeView({
      component: SceneBlockView,
      class: "scene-block-wrapper",
      domAttrs: { "data-note-block": "scene" },
      defaults: { sceneId: null, sceneName: "" },
      props: ({ updateAttributes, deleteNode, selectNode }) => ({
        onGrab: selectNode,
        onUpdate: updateAttributes,
        onRemove: deleteNode,
      }),

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
