// The Quick Notes Dialog (#231) — the same capture, from anywhere.
//
// The seam is the shell over a mocked `invoke`, as the pane's tests use the real
// store over one: the shortcut is pressed on `window` the way a GM presses it,
// and a capture is a real `create_quick_note` followed by a real re-read. What
// that buys is the claim the ticket actually makes — that the thought survives
// every way out of the box — rather than a mock returning what the test wanted.
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "svelte-sonner";
import AppShell from "$lib/components/AppShell.svelte";
import QuickNoteDialog from "$lib/components/QuickNoteDialog.svelte";
import { dialogs } from "$lib/stores/overlay.svelte";
import { quickNotes } from "$lib/stores/quick-notes.svelte";
import { tabs } from "$lib/stores/tabs.svelte";
import { pendingSaves } from "$lib/stores/pending-saves";
import { ledger } from "$lib/stores/ledger.svelte";
import type { QuickNote } from "$lib/bindings.gen";

// Stubbed so "silent" can be asserted rather than assumed: the shell mounts no
// Toaster of its own, so a toast would otherwise leave no trace to look for.
vi.mock("svelte-sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }),
  Toaster: vi.fn(),
}));

// The ledger store is the real one, driven through the real `open_ledger` path:
// the shell only exists over an open world, and "silent with no ledger open" is a
// claim about the store actually being shut rather than about a stub saying so.
const LEDGER_PATH = "/worlds/marsh";

const SEARCH_RESULTS = [{ id: 42, title: "Mira Ashvale", path: "People/Mira Ashvale.md" }];

let rows: QuickNote[] = [];

async function openLedger() {
  await ledger.openLedger(LEDGER_PATH);
}

beforeEach(() => {
  rows = [];
  dialogs.settingsOpen = false;
  dialogs.quickNoteOpen = false;
  vi.mocked(invoke).mockClear();
  vi.mocked(toast).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    if (cmd === "open_ledger")
      return Promise.resolve({
        path: LEDGER_PATH,
        note_count: 0,
        scene_count: 0,
        map_count: 0,
        failed_imports: [],
        unlinked_pins: [],
        recovered_from_backup: null,
      });
    if (cmd === "get_file_tree")
      return Promise.resolve({ name: "", path: "", is_dir: true, children: [] });
    // Two shapes the blanket `[]` below is wrong for: a tree, and a name.
    if (cmd === "get_statblock_preset_default") return Promise.resolve(null);
    if (cmd === "list_quick_notes") return Promise.resolve([...rows]);
    if (cmd === "search_notes") return Promise.resolve(SEARCH_RESULTS);
    if (cmd === "create_quick_note") {
      const created: QuickNote = {
        id: rows.length + 1,
        body: String((args as { body?: string })?.body),
        captured_at: new Date().toISOString(),
      };
      rows = [...rows, created];
      return Promise.resolve(created);
    }
    // Every other collection the shell loads over an open ledger wants a list,
    // and a null would be the sidebar crashing rather than an empty world.
    return Promise.resolve([]);
  });
});

afterEach(async () => {
  cleanup();
  dialogs.quickNoteOpen = false;
  dialogs.settingsOpen = false;
  tabs.closeAll("left");
  tabs.closeAll("right");
  rows = [];
  vi.mocked(invoke).mockImplementation(() => Promise.resolve(null));
  await ledger.closeLedger();
  await quickNotes.load();
});

/** Press the capture shortcut wherever the focus happens to be. */
function pressShortcut(target: Window | Element = window, init: KeyboardEventInit = {}) {
  return fireEvent.keyDown(target, { key: "N", ctrlKey: true, shiftKey: true, ...init });
}

const dialog = () => document.querySelector('[data-testid="quick-note-dialog"]');

/** The dialog's box, which is the only capture box the shell has open unless a
 *  Quick Notes Pane is showing — where the tests that care say which they mean. */
const box = () =>
  document.querySelector<HTMLInputElement>(
    '[data-testid="quick-note-dialog"] [data-wiki-capture]',
  ) as HTMLInputElement;

/**
 * Click somewhere that is not the dialog.
 *
 * Coordinates, because that is what "outside" means to `bits-ui`: it compares the
 * pointer's position against the content's bounding box, and jsdom measures every
 * box as 0×0 at 0,0 — so an event with the default `clientX`/`clientY` of 0 lands
 * *inside* the dialog and dismisses nothing. The settle first is for the same
 * layer: it registers its document listeners a tick after opening.
 */
async function clickOutside() {
  await settle();
  await fireEvent.pointerDown(document.body, { button: 0, clientX: 500, clientY: 500 });
  await settle();
}

/** Let a debounced listener or a deferred registration catch up. */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

/** Open the shell and the dialog over it, ready to type into. */
async function openDialog() {
  await openLedger();
  const view = render(AppShell);
  await pressShortcut();
  await waitFor(() => expect(dialog()).toBeTruthy());
  await waitFor(() => expect(box()).toBeTruthy());
  return view;
}

describe("Quick Notes Dialog — the gesture", () => {
  it("opens on Ctrl/Cmd+Shift+N from anywhere in the shell", async () => {
    await openLedger();
    render(AppShell);
    expect(dialog()).toBeNull();

    await pressShortcut();
    await waitFor(() => expect(dialog()).toBeTruthy());
    expect(dialogs.quickNoteOpen).toBe(true);
  });

  it("opens on the Cmd spelling too, since the shortcut is one gesture on both", async () => {
    await openLedger();
    render(AppShell);
    await pressShortcut(window, { ctrlKey: false, metaKey: true });
    await waitFor(() => expect(dialog()).toBeTruthy());
  });

  it("opens over the Quick Notes Pane, which has a capture box of its own", async () => {
    await openLedger();
    render(AppShell);
    tabs.openTab({ type: "quickNotes", id: 0, title: "Quick Notes" });
    await waitFor(() => expect(document.querySelector("[data-quick-notes-pane]")).toBeTruthy());

    // The pane's own box is not what the key means: one key, one meaning, or a GM
    // stops trusting it mid-session.
    await pressShortcut();
    await waitFor(() => expect(dialog()).toBeTruthy());
    expect(box()).toBeTruthy();
  });

  it("opens over another shell dialog, since 'no exceptions' includes those", async () => {
    await openLedger();
    render(AppShell);
    dialogs.settingsOpen = true;
    await waitFor(() =>
      expect(document.querySelector('[data-slot="dialog-content"]')).toBeTruthy(),
    );

    await pressShortcut();
    await waitFor(() => expect(dialog()).toBeTruthy());
    // The capture box is the one thing the GM needs to be typing into.
    await waitFor(() => expect(document.activeElement).toBe(box()));
  });

  it("lists nothing — it is a gesture, not a place", async () => {
    rows = [{ id: 1, body: "the marsh fires spread west", captured_at: new Date().toISOString() }];
    await quickNotes.load();
    await openDialog();

    expect(dialog()?.textContent).not.toContain("the marsh fires spread west");
    expect(dialog()?.querySelector("[data-quick-note]")).toBeNull();
  });

  it("takes the caret on open, so the line can just be typed", async () => {
    await openDialog();
    await waitFor(() => expect(document.activeElement).toBe(box()));
  });

  it("says nothing at all with no ledger open", async () => {
    // No `openLedger()`: mounted directly, because with no world there is no shell
    // to hang it on — and the rule is the component's own rather than an accident
    // of where it happens to live.
    expect(ledger.isOpen).toBe(false);
    render(QuickNoteDialog);

    await pressShortcut();
    expect(dialogs.quickNoteOpen).toBe(false);
    expect(dialog()).toBeNull();
    // Silent: not even a toast explaining that a world is required.
    expect(toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("Quick Notes Dialog — committing", () => {
  it("commits on Enter and clears for the next line", async () => {
    await openDialog();

    await fireEvent.input(box(), { target: { value: "the marsh fires spread west" } });
    await fireEvent.keyDown(box(), { key: "Enter" });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("create_quick_note", {
        body: "the marsh fires spread west",
      }),
    );
    // Cleared and still open: a second thought is typed straight in.
    await waitFor(() => expect(box().value).toBe(""));
    expect(dialog()).toBeTruthy();

    await fireEvent.input(box(), { target: { value: "and the ferry is gone" } });
    await fireEvent.keyDown(box(), { key: "Enter" });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("create_quick_note", { body: "and the ferry is gone" }),
    );
  });

  it("offers the `[[` autocomplete", async () => {
    await openDialog();

    await fireEvent.input(box(), { target: { value: "ask [[mi" } });
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeTruthy());
    expect(document.querySelector('[role="listbox"]')?.textContent).toContain("Mira Ashvale");

    // Enter belongs to the dropdown while it is open, not to the commit.
    await fireEvent.keyDown(box(), { key: "Enter" });
    await waitFor(() => expect(box().value).toBe("ask [[People/Mira Ashvale.md]]"));
    expect(invoke).not.toHaveBeenCalledWith("create_quick_note", expect.anything());
  });

  it("accepts a suggestion with the mouse without dismissing the dialog", async () => {
    await openDialog();
    await settle();

    await fireEvent.input(box(), { target: { value: "ask [[mi" } });
    await waitFor(() => expect(document.querySelector("[data-wiki-suggest]")).toBeTruthy());

    // The dropdown is portalled to the body, so to `bits-ui` it is *outside* the
    // dialog — and pointing at it is a dismissal unless the dialog knows better.
    // Left unhandled, choosing a note would commit `ask [[mi` and vanish.
    const option = document.querySelector<HTMLElement>("[data-wiki-suggest] [role='option']")!;
    await fireEvent.pointerDown(option, { button: 0, clientX: 400, clientY: 400 });
    await settle();

    expect(dialog()).toBeTruthy();
    expect(invoke).not.toHaveBeenCalledWith("create_quick_note", expect.anything());

    await fireEvent.click(option);
    await waitFor(() => expect(box().value).toBe("ask [[People/Mira Ashvale.md]]"));
  });

  it("lands the captured line in the pane's day group for today", async () => {
    await openLedger();
    render(AppShell);
    tabs.openTab({ type: "quickNotes", id: 0, title: "Quick Notes" });
    await waitFor(() => expect(document.querySelector("[data-quick-notes-pane]")).toBeTruthy());

    await pressShortcut();
    await waitFor(() => expect(box()).toBeTruthy());
    await fireEvent.input(box(), { target: { value: "the ferryman lied" } });
    await fireEvent.keyDown(box(), { key: "Enter" });

    // The GM's local calendar day, as the grouping means it — not UTC's, which is
    // a different date for most of the day in this repo's own timezone.
    const now = new Date();
    const today = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    await waitFor(() => {
      const group = document.querySelector(`[data-capture-day="${today}"]`);
      expect(group?.textContent).toContain("Today");
      expect(group?.textContent).toContain("the ferryman lied");
    });
  });
});

// The premise of the feature is not losing the thought, so a box that discarded
// on dismissal is the one behaviour that would make it untrustworthy. Each way
// out gets its own test, because each takes a different route to the same write.
describe("Quick Notes Dialog — every exit commits", () => {
  it("commits on Escape", async () => {
    await openDialog();
    await fireEvent.input(box(), { target: { value: "the marsh fires spread west" } });

    await fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("create_quick_note", {
        body: "the marsh fires spread west",
      }),
    );
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it("commits when the GM clicks outside", async () => {
    await openDialog();
    await fireEvent.input(box(), { target: { value: "and the ferry is gone" } });

    await clickOutside();

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("create_quick_note", {
        body: "and the ferry is gone",
      }),
    );
  });

  it("commits when the window closes or the ledger switches", async () => {
    await openDialog();
    await fireEvent.input(box(), { target: { value: "she already knows" } });

    // Neither teardown unmounts anything, so neither reaches the box on its own:
    // both await Pending Saves first, which is what this registration is for.
    await pendingSaves.flushAll();

    expect(invoke).toHaveBeenCalledWith("create_quick_note", { body: "she already knows" });
    // Written while the outgoing ledger was still the open one, and the dialog is
    // gone rather than left hanging over whatever opens next.
    await waitFor(() => expect(dialogs.quickNoteOpen).toBe(false));
  });

  it("writes the line exactly once when a dismissal follows a flush", async () => {
    await openDialog();
    await fireEvent.input(box(), { target: { value: "one thought only" } });

    await pendingSaves.flushAll();
    await waitFor(() => expect(dialog()).toBeNull());

    const writes = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "create_quick_note").length;
    expect(writes).toBe(1);
  });

  it("stays open holding the line when the write fails on the way out", async () => {
    await openDialog();
    await fireEvent.input(box(), { target: { value: "the ferryman lied" } });
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "create_quick_note") return Promise.reject(new Error("ERR_DB_LOCKED: busy"));
      return Promise.resolve([]);
    });

    await fireEvent.keyDown(document, { key: "Escape" });

    // A thought that reached nowhere must not leave with the dialog: the failure
    // was toasted, and the line is still where the GM can see it.
    await waitFor(() => expect(box()?.value).toBe("the ferryman lied"));
    expect(dialog()).toBeTruthy();
    expect(dialogs.quickNoteOpen).toBe(true);
  });

  it("leaves the dialog alone when Escape belongs to the `[[` dropdown", async () => {
    await openDialog();
    await settle();
    await fireEvent.input(box(), { target: { value: "ask [[mi" } });
    await waitFor(() => expect(document.querySelector("[data-wiki-suggest]")).toBeTruthy());

    // One Escape, one dismissal: the menu goes and the box stays, with the line
    // still in it and nothing written.
    await fireEvent.keyDown(box(), { key: "Escape" });
    await waitFor(() => expect(document.querySelector("[data-wiki-suggest]")).toBeNull());
    expect(dialog()).toBeTruthy();
    expect(box().value).toBe("ask [[mi");
    expect(invoke).not.toHaveBeenCalledWith("create_quick_note", expect.anything());
  });

  it("writes nothing when the box is empty", async () => {
    await openDialog();
    await fireEvent.input(box(), { target: { value: "   " } });

    await fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(dialog()).toBeNull());
    await pendingSaves.flushAll();

    expect(invoke).not.toHaveBeenCalledWith("create_quick_note", expect.anything());
  });
});
