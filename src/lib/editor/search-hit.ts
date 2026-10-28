// Where a search landed in a note: the matched words tinted for a moment, fading as the
// GM's eye arrives (DESIGN.md §5 Motion — attention, 600ms).
//
// A decoration, not the selection. Until the 2026-10 design review the editor animated
// `::selection`, which takes no animation in any engine, so the "pulse" had never shown.
// The selection still moves to the match; this only marks it.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { ATTENTION } from "$lib/motion";

type SearchHitMeta = { from: number; to: number } | null;

export const searchHitKey = new PluginKey<DecorationSet>("searchHit");

export const SearchHit = Extension.create({
  name: "searchHit",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: searchHitKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, deco) {
            const meta = tr.getMeta(searchHitKey) as SearchHitMeta | undefined;
            if (meta === null) return DecorationSet.empty;
            if (meta) {
              return DecorationSet.create(tr.doc, [
                Decoration.inline(meta.from, meta.to, { class: "search-hit" }),
              ]);
            }
            return deco.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations: (state: EditorState) => searchHitKey.getState(state),
        },
      }),
    ];
  },
});

/** Tint `from`–`to` for as long as the fade runs, then take the tint away. */
export function showSearchHit(view: EditorView, range: { from: number; to: number }): void {
  view.dispatch(view.state.tr.setMeta(searchHitKey, range));
  setTimeout(() => {
    if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(searchHitKey, null));
  }, ATTENTION);
}
