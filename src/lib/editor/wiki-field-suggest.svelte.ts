// The `[[` menu in a text field — a block's Linked Text Field and the Quick Notes box.
//
// Both kept their own copy of this, and the copies had drifted: only one guarded against a
// slow search landing over a newer one, neither placed the menu at the `[[`, and both wrote
// a bare `[[path]]` whatever the GM had typed after the name. One copy now, so a field
// cannot answer differently from the box beside it — and the grammar underneath is
// `wiki-suggest.ts`'s, so neither can answer differently from prose.
import { tick } from "svelte";
import { caretRect } from "$lib/utils/caret-rect";
import {
  describeWikiMenu,
  findWikiTrigger,
  looksLikeProse,
  parseWikiQuery,
  readWikiSuggestKey,
  searchWikiTargets,
  wikiLinkTarget,
  wikiMenuAnchor,
  type WikiMenuAnchor,
  type WikiSuggestion,
} from "./wiki-suggest";

export interface FieldSuggestion extends WikiMenuAnchor {
  items: WikiSuggestion[];
  selectedIndex: number;
  /** Where the `[[` sits in the value, so accepting replaces from there. */
  triggerStart: number;
}

type Field = HTMLInputElement | HTMLTextAreaElement;

export interface FieldWikiSuggest {
  /** The open menu, or null. */
  readonly current: FieldSuggestion | null;
  /** The field's value changed: open, update or close the menu for what is behind the caret. */
  offer: (el: Field) => Promise<void>;
  /** Whether a key belonged to the menu (and was handled). */
  keydown: (e: KeyboardEvent) => boolean;
  /** Take a row: write the link into the value and put the caret after it. */
  accept: (row: WikiSuggestion) => void;
  /** The pointer moved onto a row. */
  hover: (index: number) => void;
  /** Read the `[[`'s position again — something scrolled. */
  reposition: () => void;
  /** Close the menu and disown any search still in flight. */
  close: () => void;
}

export function createFieldWikiSuggest(field: {
  input: () => Field | null | undefined;
  value: () => string;
  setValue: (value: string) => void;
}): FieldWikiSuggest {
  let current = $state<FieldSuggestion | null>(null);
  /**
   * Which search is the current one. A slow one that lands after a newer keystroke — or
   * after the line was committed — would otherwise reopen a stale menu over the field.
   */
  let generation = 0;
  /**
   * The `[[` the GM dismissed with Escape. It stays dismissed until they start another:
   * the next keystroke used to reopen it, and a reflexive second Escape then cancelled the
   * whole field edit, links already accepted with it.
   */
  let dismissedAt: number | null = null;

  function describe() {
    describeWikiMenu(
      field.input(),
      current && { itemCount: current.items.length, selectedIndex: current.selectedIndex },
    );
  }

  function close() {
    generation++;
    current = null;
    describe();
  }

  function anchorFor(el: Field, start: number) {
    return wikiMenuAnchor(caretRect(el, start));
  }

  async function offer(el: Field) {
    const mine = ++generation;
    const trigger = findWikiTrigger(el.value, el.selectionStart ?? el.value.length);
    if (!trigger || looksLikeProse(trigger.query)) {
      if (!trigger) dismissedAt = null;
      current = null;
      describe();
      return;
    }
    if (trigger.start === dismissedAt) return;
    dismissedAt = null;

    const items = await searchWikiTargets(trigger.query);
    if (mine !== generation) return;
    current = {
      items,
      selectedIndex: 0,
      ...anchorFor(el, trigger.start),
      triggerStart: trigger.start,
    };
    describe();
  }

  function accept(row: WikiSuggestion) {
    if (!current) return;
    const { triggerStart } = current;
    const el = field.input();
    const value = field.value();
    const caret = el?.selectionStart ?? value.length;
    const typed = value.slice(triggerStart + 2, caret);
    const inserted = `[[${wikiLinkTarget(row, parseWikiQuery(typed))}]]`;
    field.setValue(value.slice(0, triggerStart) + inserted + value.slice(caret));
    close();

    const next = triggerStart + inserted.length;
    void tick().then(() => {
      const input = field.input();
      input?.focus();
      input?.setSelectionRange(next, next);
    });
  }

  function keydown(e: KeyboardEvent): boolean {
    if (!current) return false;
    const verdict = readWikiSuggestKey(e.key, {
      itemCount: current.items.length,
      selectedIndex: current.selectedIndex,
      shiftKey: e.shiftKey,
    });
    if (!verdict) return false;

    e.preventDefault();
    if (verdict.kind === "move") {
      current.selectedIndex = verdict.selectedIndex;
      describe();
    } else if (verdict.kind === "dismiss") {
      // The menu's Escape is the menu's alone: it closes the menu and keeps the edit, and
      // never reaches whatever else Escape means here.
      e.stopPropagation();
      dismissedAt = current.triggerStart;
      close();
    } else {
      accept(current.items[verdict.selectedIndex]);
    }
    return true;
  }

  return {
    get current() {
      return current;
    },
    offer,
    keydown,
    accept,
    hover(index) {
      if (!current || current.selectedIndex === index) return;
      current.selectedIndex = index;
      describe();
    },
    reposition() {
      const el = field.input();
      if (!current || !el) return;
      Object.assign(current, anchorFor(el, current.triggerStart));
    },
    close,
  };
}
