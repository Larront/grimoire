// The slash menu as a GM drives it in a note — `/` typed, keys pressed, a row run — rather
// than its filter alone (slash-command.test.ts). What is pinned here is what the editor
// does around the menu: the row Enter runs, where the caret lands afterwards, and what a
// screen reader is told while focus stays in the text.
import { describe, it, expect, afterEach, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "prosemirror-state";
import { invoke } from "@tauri-apps/api/core";
import { noteExtensions } from "$lib/editor/note-extensions";
import { SLASH_MENU_ID, slashOptionId, type SlashCommandSuggestionState } from "$lib/editor/slash-command";
import { statblockPresets } from "$lib/stores/statblock-presets.svelte";

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

/** A note with the menu's state captured as the editor pushes it. */
function note(content: string) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const menu: { state: SlashCommandSuggestionState | null } = { state: null };
  editor = new Editor({
    element: host,
    extensions: noteExtensions({ onSlashCommand: (s) => (menu.state = s) }),
    content,
  });
  editor.commands.focus("end");
  return { editor, menu };
}

/** Types as the GM does, a character at a time, so the suggestion plugin sees each. */
async function type(ed: Editor, text: string) {
  for (const ch of text) {
    ed.commands.insertContent(ch);
    await Promise.resolve();
  }
}

function press(ed: Editor, key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  ed.view.dom.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("the slash menu in a note", () => {
  it("opens on / and points the editor at its selected row", async () => {
    const { editor: ed, menu } = note("<p></p>");
    await type(ed, "/");

    expect(menu.state?.items.length).toBeGreaterThan(0);
    const dom = ed.view.dom;
    expect(dom.getAttribute("aria-expanded")).toBe("true");
    expect(dom.getAttribute("aria-controls")).toBe(SLASH_MENU_ID);
    expect(dom.getAttribute("aria-activedescendant")).toBe(slashOptionId(0));

    press(ed, "ArrowDown");
    expect(dom.getAttribute("aria-activedescendant")).toBe(slashOptionId(1));
  });

  it("says nothing about a menu once it has closed", async () => {
    const { editor: ed } = note("<p></p>");
    await type(ed, "/");
    press(ed, "Escape");

    expect(ed.view.dom.hasAttribute("aria-expanded")).toBe(false);
    expect(ed.view.dom.hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("selects the row the pointer moves onto, so only one row is lit", async () => {
    const { editor: ed, menu } = note("<p></p>");
    await type(ed, "/");
    menu.state!.select(3);

    expect(menu.state!.selectedIndex).toBe(3);
    expect(ed.view.dom.getAttribute("aria-activedescendant")).toBe(slashOptionId(3));
  });

  it("moves a page at a time and stops at the ends", async () => {
    const { editor: ed, menu } = note("<p></p>");
    await type(ed, "/");
    const last = menu.state!.items.length - 1;

    press(ed, "PageDown");
    expect(menu.state!.selectedIndex).toBe(6);
    press(ed, "PageDown");
    press(ed, "PageDown");
    expect(menu.state!.selectedIndex).toBe(last);
    press(ed, "PageUp");
    press(ed, "PageUp");
    press(ed, "PageUp");
    expect(menu.state!.selectedIndex).toBe(0);
  });

  it("stays open saying nothing matches a word, rather than vanishing", async () => {
    const { editor: ed, menu } = note("<p></p>");
    await type(ed, "/zzz");

    expect(menu.state).not.toBeNull();
    expect(menu.state!.items).toEqual([]);
    expect(menu.state!.query).toBe("zzz");
  });

  it("lets Enter break the line when nothing matches, and closes", async () => {
    const { editor: ed, menu } = note("<p></p>");
    await type(ed, "/zzz");

    press(ed, "Enter");
    expect(menu.state).toBeNull();
    expect(ed.state.doc.childCount).toBe(2);
    expect(ed.state.doc.child(0).textContent).toBe("/zzz");
  });

  it("closes for prose after a stray slash", async () => {
    const { editor: ed, menu } = note("<p></p>");
    await type(ed, "and / or");
    expect(menu.state).toBeNull();
  });

  it("runs the ranked first row on Enter", async () => {
    const { editor: ed } = note("<p></p>");
    await type(ed, "/st");
    press(ed, "Enter");

    expect(ed.getJSON().content?.[0].type).toBe("statblockBlock");
  });
});

describe("a statblock stamped from a preset", () => {
  it("leaves the caret in the line after it, so typing does not replace it", async () => {
    // It was left selected, and the next letter the GM typed replaced it.
    const { editor: ed } = note("<p></p>");
    await type(ed, "/statblock large orc");
    press(ed, "Enter");

    const { selection, doc } = ed.state;
    expect(selection).toBeInstanceOf(TextSelection);
    expect(selection).not.toBeInstanceOf(NodeSelection);
    expect(doc.child(0).type.name).toBe("statblockBlock");
    expect(doc.child(1).type.name).toBe("paragraph");

    await type(ed, "x");
    expect(ed.state.doc.child(0).type.name).toBe("statblockBlock");
  });

  it("stamps the preset row the GM moved to", async () => {
    vi.mocked(invoke).mockImplementation(async () => null);
    await statblockPresets.reload();
    const { editor: ed, menu } = note("<p></p>");
    await type(ed, "/statblock");
    const orc = menu.state!.items.findIndex((item) => item.label === "Large Orc");
    menu.state!.select(orc);
    press(ed, "Enter");

    expect(ed.getMarkdown()).toContain("# Large Orc");
  });
});

describe("a list command inside its own list", () => {
  it("takes the line out of the list, as the toggle says", async () => {
    const { editor: ed } = note("<ul><li><p>item one</p></li><li><p>item two</p></li></ul><p></p>");
    // The caret at the end of the second item, then a fresh item for the command.
    ed.commands.setTextSelection(ed.state.doc.child(0).nodeSize - 3);
    ed.commands.splitListItem("listItem");
    await type(ed, "/bullet");
    press(ed, "Enter");

    const [list, line] = [ed.state.doc.child(0), ed.state.doc.child(1)];
    expect(list.childCount).toBe(2);
    expect(line.type.name).toBe("paragraph");
    expect(ed.state.selection.$from.parent).toBe(line);
  });
});
