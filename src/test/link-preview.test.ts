// The link preview (2026-10 design review): when its card shows and goes, and what the
// card says. The excerpt underneath is pinned in note-excerpt.test.ts.
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

const resolve = vi.fn();
const readNoteContent = vi.fn();

vi.mock("$lib/stores/link-resolver.svelte", () => ({
  linkResolver: { resolve: (...args: unknown[]) => resolve(...args), isKnown: () => true, prime: vi.fn() },
}));
vi.mock("$lib/api", () => ({
  api: { silent: { readNoteContent: (...args: unknown[]) => readNoteContent(...args) } },
}));

import {
  createLinkPreview,
  PREVIEW_HIDE_MS,
  PREVIEW_SHOW_MS,
  type LinkPreviewCard,
} from "$lib/editor/link-preview.svelte";
import WikiLinkPreview from "$lib/components/editor/WikiLinkPreview.svelte";

const MIRA = { id: 1, title: "Mira Ashvale", path: "Characters/Mira Ashvale.md" };

function link(path: string, text = "the Herbalist") {
  const el = document.createElement("span");
  el.dataset.wikiLink = "";
  el.dataset.path = path;
  el.dataset.title = text;
  el.textContent = text;
  document.body.appendChild(el);
  return el;
}

function over(el: HTMLElement) {
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: 1, clientY: 1 }));
}
function out(el: HTMLElement) {
  el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
}

/** A preview listening on the body, as a surface listens on its own container. */
function surface() {
  const preview = createLinkPreview();
  const onOver = (e: MouseEvent) => preview.pointerOver(e);
  const onOut = (e: MouseEvent) => preview.pointerOut(e);
  document.body.addEventListener("mouseover", onOver);
  document.body.addEventListener("mouseout", onOut);
  return {
    preview,
    stop() {
      document.body.removeEventListener("mouseover", onOver);
      document.body.removeEventListener("mouseout", onOut);
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  resolve.mockReset().mockResolvedValue(MIRA);
  readNoteContent.mockReset().mockResolvedValue("A weathered herbalist.");
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  document.body.innerHTML = "";
});

describe("when the card shows and goes", () => {
  it("shows after the pointer rests on a link", async () => {
    const { preview, stop } = surface();
    over(link("Characters/Mira Ashvale.md"));
    expect(preview.card).toBeNull();

    await vi.advanceTimersByTimeAsync(PREVIEW_SHOW_MS);
    await flush();
    expect(preview.card?.note).toEqual(MIRA);
    stop();
  });

  it("does not stick when the pointer leaves while the note is still being read", async () => {
    // The wait fired, the lookups were still running, the pointer left — and the card
    // appeared anyway, with nothing left to take it down.
    let land: (v: string) => void = () => {};
    readNoteContent.mockReturnValueOnce(new Promise<string>((r) => (land = r)));
    const { preview, stop } = surface();
    const el = link("Characters/Mira Ashvale.md");
    over(el);
    await vi.advanceTimersByTimeAsync(PREVIEW_SHOW_MS);
    out(el);
    land("A weathered herbalist.");
    await flush();
    await vi.advanceTimersByTimeAsync(PREVIEW_HIDE_MS);

    expect(preview.card).toBeNull();
    stop();
  });

  it("stays while the pointer is on the card, and goes once it leaves", async () => {
    const { preview, stop } = surface();
    const el = link("Characters/Mira Ashvale.md");
    over(el);
    await vi.advanceTimersByTimeAsync(PREVIEW_SHOW_MS);
    await flush();
    out(el);
    preview.cardPointer(true);
    await vi.advanceTimersByTimeAsync(PREVIEW_HIDE_MS * 3);
    expect(preview.card).not.toBeNull();

    preview.cardPointer(false);
    await vi.advanceTimersByTimeAsync(PREVIEW_HIDE_MS);
    expect(preview.card).toBeNull();
    stop();
  });

  it("hands over at once from one link to the next", async () => {
    const { preview, stop } = surface();
    const first = link("Characters/Mira Ashvale.md");
    over(first);
    await vi.advanceTimersByTimeAsync(PREVIEW_SHOW_MS);
    await flush();
    out(first);
    resolve.mockResolvedValue({ id: 2, title: "Brannoc", path: "Characters/Brannoc.md" });
    over(link("Characters/Brannoc.md", "Brannoc"));
    await flush();

    expect(preview.card?.note?.title).toBe("Brannoc");
    stop();
  });

  it("opens from the keyboard at once, marked to take focus", async () => {
    const { preview, stop } = surface();
    preview.openFor(link("Characters/Mira Ashvale.md"));
    await flush();
    expect(preview.card?.viaKeyboard).toBe(true);
    stop();
  });

  it("shows a card for a note not written yet", async () => {
    resolve.mockResolvedValue(null);
    const { preview, stop } = surface();
    preview.openFor(link("Brannoc", "Brannoc"));
    await flush();
    expect(preview.card?.note).toBeNull();
    expect(preview.card?.linkText).toBe("Brannoc");
    stop();
  });
});

// ─── The card ─────────────────────────────────────────────────────────────────

function card(overrides: Partial<LinkPreviewCard> = {}, allowCreate = false) {
  const handlers = { onPointer: vi.fn(), onOpen: vi.fn(), onCreate: vi.fn(), onClose: vi.fn() };
  const rendered = render(WikiLinkPreview, {
    props: {
      card: {
        path: "Characters/Mira Ashvale.md|the Herbalist",
        linkText: "the Herbalist",
        note: MIRA,
        content: "A weathered herbalist.\n\n## Tactics\n\nRuns.",
        anchor: { x: 0, y: 0, anchorTop: 0 },
        viaKeyboard: false,
        returnTo: null,
        ...overrides,
      },
      allowCreate,
      ...handlers,
    },
  });
  return { ...rendered, ...handlers };
}

describe("what the card says", () => {
  beforeEach(() => vi.useRealTimers());

  it("is titled by the note, not the alias the link was written with", () => {
    const { getByRole } = card();
    expect(getByRole("dialog", { name: "Preview of Mira Ashvale" })).toBeTruthy();
  });

  it("says where the note lives by its folder, and which section a #heading link means", () => {
    const { getByText } = card({ path: "Characters/Mira Ashvale.md#Tactics" });
    expect(getByText("Characters · § Tactics")).toBeTruthy();
  });

  it("sets a heading apart from the prose under it", () => {
    const { getByText } = card();
    expect(getByText("Tactics").className).toContain("font-semibold");
  });

  it("opens the note", async () => {
    const { getByRole, onOpen } = card();
    await fireEvent.click(getByRole("button", { name: /Open/ }));
    expect(onOpen).toHaveBeenCalledWith(MIRA);
  });

  it("says a note has nothing written in it, rather than showing an empty card", () => {
    const { getByText } = card({ content: "## Description\n\n## Notes\n" });
    expect(getByText("Nothing written in this note yet.")).toBeTruthy();
  });

  it("offers to create a note not written yet, where the surface allows it", async () => {
    const unwritten = { note: null, linkText: "Brannoc", path: "Brannoc", content: "" };
    const { getByText, getByRole, onCreate } = card(unwritten, true);
    expect(getByText("Not written yet")).toBeTruthy();
    await fireEvent.click(getByRole("button", { name: /Create/ }));
    expect(onCreate).toHaveBeenCalledWith("Brannoc");
    cleanup();

    const inert = card(unwritten, false);
    expect(inert.queryByRole("button", { name: /Create/ })).toBeNull();
  });

  it("closes on Escape", async () => {
    const { onClose } = card();
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("puts focus on its action when the keyboard raised it", () => {
    const { getByRole } = card({ viaKeyboard: true });
    expect(document.activeElement).toBe(getByRole("button", { name: /Open/ }));
  });
});
