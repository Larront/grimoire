// The link preview's life: which link it is for, when it shows, and when it goes
// (2026-10 design review).
//
// It lived inline in the note editor, which is why only the note editor had one — Quick
// Notes draws the same links and showed no card. One controller now, used by every surface
// that draws `[[…]]` links, each passing pointer events from its own container.
//
// And it is a *peek*: the pointer can move from the link onto the card, which stays while
// it is there, scrolls, and opens the note. The old card was `pointer-events-none` and went
// the instant the pointer left the link.
import { api } from "$lib/api";
import { linkResolver } from "$lib/stores/link-resolver.svelte";
import { parseFrontmatter } from "$lib/utils";
import { stripWikiFragment } from "./wiki-target";

/** How long the pointer rests on a link before its card shows. */
export const PREVIEW_SHOW_MS = 400;
/**
 * How long a card outlives the pointer leaving its link — long enough to cross the gap
 * onto the card, short enough that one abandoned is gone before the GM looks back.
 */
export const PREVIEW_HIDE_MS = 200;

export interface LinkPreviewCard {
  /** The link's target as written, `#heading` and all. */
  path: string;
  /** What the link says — the card's title when the note is not written yet. */
  linkText: string;
  /** The note the link resolves to, or null for a note not written yet. */
  note: { id: number; title: string; path: string } | null;
  /** The note's body, frontmatter off. */
  content: string;
  /** The line of the link the card hangs off — below it, or above it if it must flip. */
  anchor: { x: number; y: number; anchorTop: number };
  /** Raised from the keyboard: the card takes focus, and Escape gives it back. */
  viaKeyboard: boolean;
  /** Where focus goes back to when a keyboard-raised card closes. */
  returnTo: HTMLElement | null;
}

export interface LinkPreview {
  readonly card: LinkPreviewCard | null;
  /** A pointer moved over the surface. */
  pointerOver: (e: MouseEvent) => void;
  /** A pointer left something on the surface. */
  pointerOut: (e: MouseEvent) => void;
  /** The pointer reached the card, or left it. */
  cardPointer: (on: boolean) => void;
  /** The keyboard asked for this link's card. */
  openFor: (link: HTMLElement) => void;
  /** Down, now, and any lookup still running disowned. */
  close: () => void;
  destroy: () => void;
}

/**
 * The line box of a link the card should hang off: the one under the pointer when a
 * pointer raised it. A link that wraps has a box spanning both lines, and the card used to
 * sit under the second line, 600px from where the GM was pointing.
 */
function lineOf(link: HTMLElement, at: { x: number; y: number } | null) {
  const rects = Array.from(link.getClientRects());
  const box =
    (at && rects.find((r) => at.x >= r.left && at.x <= r.right && at.y >= r.top && at.y <= r.bottom)) ??
    rects[0] ??
    link.getBoundingClientRect();
  return { x: box.left, y: box.bottom + 6, anchorTop: box.top - 6 };
}

export function createLinkPreview(): LinkPreview {
  let card = $state.raw<LinkPreviewCard | null>(null);
  /** The link the pointer is on, so moving within it does not restart the wait. */
  let pointed: HTMLElement | null = null;
  let onCard = false;
  /**
   * Which lookup is the current one. The card used to stick: the pointer left after the
   * wait had fired, and the lookups still running set the card anyway — and then nothing
   * was left to take it down. Every way out bumps this, so a lookup landing late is dropped.
   */
  let generation = 0;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  async function show(link: HTMLElement, at: { x: number; y: number } | null, viaKeyboard: boolean) {
    const path = link.dataset.path;
    if (!path) return;
    const mine = ++generation;
    const returnTo = viaKeyboard ? (document.activeElement as HTMLElement | null) : null;

    // A preview owns its own (absent) error UI, so every lookup here is silent.
    const note = await linkResolver.resolve(stripWikiFragment(path), { silent: true }).catch(() => null);
    let content = "";
    if (note) {
      try {
        content = parseFrontmatter(await api.silent.readNoteContent(note.path)).body;
      } catch {
        content = "";
      }
    }
    if (mine !== generation) return;
    card = {
      path,
      linkText: link.dataset.title || link.textContent?.trim() || path,
      note: note ? { id: note.id, title: note.title, path: note.path } : null,
      content,
      anchor: lineOf(link, at),
      viaKeyboard,
      returnTo,
    };
  }

  function close() {
    generation++;
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    pointed = null;
    onCard = false;
    card = null;
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!onCard && !pointed) close();
    }, PREVIEW_HIDE_MS);
  }

  return {
    get card() {
      return card;
    },

    pointerOver(e) {
      const link = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-wiki-link]");
      if (!link || link === pointed) return;
      pointed = link;
      clearTimeout(hideTimer);
      clearTimeout(showTimer);
      const at = { x: e.clientX, y: e.clientY };
      // From one link straight to the next, a card already up hands over at once rather
      // than blinking out and making the GM wait again.
      if (card) void show(link, at, false);
      else showTimer = setTimeout(() => void show(link, at, false), PREVIEW_SHOW_MS);
    },

    pointerOut(e) {
      const link = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-wiki-link]");
      if (!link || link !== pointed) return;
      if (e.relatedTarget instanceof Node && link.contains(e.relatedTarget)) return;
      pointed = null;
      clearTimeout(showTimer);
      // A lookup for this link still in flight is no longer wanted unless a card is up.
      if (!card) generation++;
      scheduleHide();
    },

    cardPointer(on) {
      onCard = on;
      if (on) clearTimeout(hideTimer);
      else scheduleHide();
    },

    openFor(link) {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      pointed = null;
      void show(link, null, true);
    },

    close,

    destroy() {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      generation++;
    },
  };
}
