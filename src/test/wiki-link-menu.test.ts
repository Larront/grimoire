// The `[[` menu as it is drawn, and as a GM drives it in prose (2026-10 design review).
// The grammar underneath is pinned in wiki-suggest.test.ts, the ranking in Rust
// (`link_targets.rs`), and the fields in linked-text-field.test.ts.
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { invoke } from "@tauri-apps/api/core";
import WikiLinkSuggestion from "$lib/components/editor/WikiLinkSuggestion.svelte";
import { noteExtensions } from "$lib/editor/note-extensions";
import { WIKI_MENU_ID, wikiOptionId, type WikiSuggestion } from "$lib/editor/wiki-suggest";
import type { WikiLinkSuggestionState } from "$lib/editor/wiki-link";
// For its layout stubs: jsdom gives text no client rects, and the editor scrolls to the caret.
import "./fixtures/note-editor";

afterEach(cleanup);

const MIRA: WikiSuggestion = {
  kind: "note",
  id: 1,
  title: "Mira Ashvale",
  path: "Characters/Mira Ashvale.md",
  folder: "Characters",
  alias: null,
};
const KEEP: WikiSuggestion = {
  kind: "note",
  id: 2,
  title: "The Ember Keep",
  path: "Locations/The Ember Keep.md",
  folder: "Locations",
  alias: null,
};

function menu(items: WikiSuggestion[], selectedIndex = 0) {
  const onSelect = vi.fn();
  const onHover = vi.fn();
  const rendered = render(WikiLinkSuggestion, {
    props: { items, selectedIndex, x: 0, y: 0, onSelect, onHover },
  });
  return { ...rendered, onSelect, onHover };
}

describe("the link menu's rows", () => {
  it("lights only the selected row", () => {
    const { getAllByRole } = menu([MIRA, KEEP], 1);
    const lit = getAllByRole("option").filter((o) => o.className.includes("bg-surface-selected"));
    expect(lit).toHaveLength(1);
    expect(lit[0]).toHaveAttribute("aria-selected", "true");
  });

  it("selects the row the pointer moves onto, rather than lighting a second", async () => {
    const { getAllByRole, onHover } = menu([MIRA, KEEP]);
    await fireEvent.mouseMove(getAllByRole("option")[1]);
    expect(onHover).toHaveBeenCalledWith(1);
  });

  it("keeps rows out of the Tab order, with ids the text can point at", () => {
    const { getAllByRole, getByRole } = menu([MIRA, KEEP]);
    expect(getByRole("listbox")).toHaveAttribute("id", WIKI_MENU_ID);
    getAllByRole("option").forEach((option, i) => {
      expect(option).toHaveAttribute("tabindex", "-1");
      expect(option).toHaveAttribute("id", wikiOptionId(i));
    });
  });

  it("says where a note lives by its folder, not its file path", () => {
    const { getAllByRole } = menu([MIRA]);
    expect(getAllByRole("option")[0]).toHaveTextContent("Characters");
    expect(getAllByRole("option")[0]).not.toHaveTextContent(".md");
  });

  it("says which alias answered", () => {
    const { getAllByRole } = menu([{ ...MIRA, alias: "the Herbalist" } as WikiSuggestion]);
    expect(getAllByRole("option")[0]).toHaveTextContent("the Herbalist");
  });

  it("offers a name no note has as a new note", () => {
    const { getByText } = menu([{ kind: "new", name: "Brannoc" }]);
    expect(getByText("New note “Brannoc”")).toBeTruthy();
  });
});

// ─── In prose ─────────────────────────────────────────────────────────────────

let editor: Editor | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  editor?.destroy();
  host?.remove();
  editor = null;
  host = null;
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(null);
});

/** A note whose link search answers from a fixed list, ranked as the ledger would. */
function note(content = "<p></p>") {
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd !== "search_link_targets") return null;
    const query = String((args as { query: string }).query).toLowerCase();
    return [MIRA, KEEP].filter((n) => n.kind === "note" && n.title.toLowerCase().includes(query));
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  const state: { menu: WikiLinkSuggestionState | null } = { menu: null };
  editor = new Editor({
    element: host,
    extensions: noteExtensions({ onWikiSuggestion: (s) => (state.menu = s) }),
    content,
  });
  editor.commands.focus("end");
  return { editor, state };
}

async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

async function type(ed: Editor, text: string) {
  for (const ch of text) {
    ed.commands.insertContent(ch);
    await settle();
  }
}

function press(ed: Editor, key: string) {
  ed.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

describe("the link menu in prose", () => {
  it("opens on a bare [[ with notes to choose from", async () => {
    const { editor: ed, state } = note();
    await type(ed, "[[");
    expect(state.menu?.items.length).toBeGreaterThan(0);
  });

  it("keeps searching through a space", async () => {
    // "The Ember Keep" has two; the first used to end the search.
    const { editor: ed, state } = note();
    await type(ed, "[[ember k");
    expect(state.menu?.items[0]).toMatchObject({ title: "The Ember Keep" });
  });

  it("writes the display text typed after the name", async () => {
    const { editor: ed } = note();
    await type(ed, "[[ember|the Keep");
    press(ed, "Enter");
    expect(ed.getMarkdown()).toContain("[[Locations/The Ember Keep.md|the Keep]]");
  });

  it("links a new name as typed", async () => {
    const { editor: ed, state } = note();
    await type(ed, "[[Brannoc");
    expect(state.menu?.items.at(-1)).toEqual({ kind: "new", name: "Brannoc" });
    press(ed, "Enter");
    expect(ed.getMarkdown()).toContain("[[Brannoc]]");
  });

  it("points a screen reader at the selected row, and clears it on close", async () => {
    const { editor: ed } = note();
    await type(ed, "[[ember");
    expect(ed.view.dom.getAttribute("aria-activedescendant")).toBe(wikiOptionId(0));
    press(ed, "Escape");
    expect(ed.view.dom.hasAttribute("aria-expanded")).toBe(false);
  });

  it("opens after any character, not only a space", async () => {
    const { editor: ed, state } = note();
    await type(ed, "([[mira");
    expect(state.menu?.items[0]).toMatchObject({ title: "Mira Ashvale" });
  });

  it("closes when the GM has gone on writing a sentence", async () => {
    const { editor: ed, state } = note();
    await type(ed, "[[and then, the party");
    expect(state.menu).toBeNull();
  });
});
