// Quick Notes in the shell (#233) — the rail icon, its count badge, and the one
// sidebar button.
//
// The seam is the whole shell over the real store and a mocked `invoke`: the
// badge reads `quickNotes.count`, and the count is whatever `list_quick_notes`
// last returned. Asserting through captures and deletes rather than by poking
// the store is what makes "the count updates" a claim about the app rather than
// about a number this test set.
import { render, fireEvent, cleanup, act, within } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The undo window is what makes forgetting a thought safe, so it is asserted
// rather than waited out: this double hands the test the confirm and cancel
// callbacks directly. The rest are here because the shell's other subscribers
// take them from the same module.
vi.mock("$lib/toast", () => ({
  toastUndo: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastExternalMoveLinks: vi.fn(),
  toastUnlinkedPins: vi.fn(),
}));
import { toastUndo } from "$lib/toast";
import { invoke } from "@tauri-apps/api/core";
import AppShell from "$lib/components/AppShell.svelte";
import { ledger } from "$lib/stores/ledger.svelte";
import { quickNotes } from "$lib/stores/quick-notes.svelte";
import { tabs } from "$lib/stores/tabs.svelte";
import type { QuickNote } from "$lib/bindings.gen";

const desktopMatchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

let rows: QuickNote[] = [];

function note(id: number, body: string): QuickNote {
  return { id, body, captured_at: new Date().toISOString() };
}

beforeEach(async () => {
  Object.defineProperty(window, "matchMedia", { writable: true, value: desktopMatchMedia });
  rows = [];
  vi.mocked(invoke).mockClear();
  vi.mocked(toastUndo).mockClear();
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "open_ledger")
      return {
        path: "/vault",
        note_count: 0,
        scene_count: 0,
        map_count: 0,
        failed_imports: [],
        unlinked_pins: [],
      };
    if (cmd === "list_quick_notes") return [...rows];
    if (cmd === "create_quick_note") {
      const created = note(rows.length + 1, String((args as { body?: string })?.body));
      rows = [...rows, created];
      return created;
    }
    if (cmd === "delete_quick_note") {
      const { id } = args as { id: number };
      rows = rows.filter((r) => r.id !== id);
      return 1;
    }
    if (cmd === "get_file_tree")
      return { name: "vault", path: "", is_dir: true, note_id: null, map_id: null, children: [] };
    // Every other list the shell's stores fetch on open: an empty ledger apart
    // from the pen, which is the only collection this file is about.
    if (cmd.startsWith("get_") || cmd.startsWith("list_")) return [];
    return null;
  });
  await ledger.openLedger("/vault");
  await flush();
});

afterEach(async () => {
  cleanup();
  await ledger.closeLedger();
  tabs.closeAll("left");
  if (tabs.right) tabs.closeAll("right");
  vi.mocked(invoke).mockResolvedValue(null);
});

describe("Quick Notes in the app shell (#233)", () => {
  it("the rail icon opens the Quick Notes Pane in one click", async () => {
    const { getByTestId } = render(AppShell);
    await flush();

    await fireEvent.click(getByTestId("rail-quick-notes"));
    await flush();

    expect(tabs.leftActiveTab?.type).toBe("quickNotes");
  });

  it("draws no badge at all when the pen is empty — not a zero", async () => {
    const { queryByTestId } = render(AppShell);
    await flush();

    expect(quickNotes.count).toBe(0);
    expect(queryByTestId("rail-quick-notes-count")).toBeNull();
    expect(queryByTestId("sidebar-quick-notes-count")).toBeNull();
  });

  it("shows the ledger's total on both surfaces once a thought is held", async () => {
    rows = [note(1, "The innkeeper knows"), note(2, "Bridge is out")];
    await quickNotes.load();

    const { getByTestId } = render(AppShell);
    await flush();

    expect(getByTestId("rail-quick-notes-count").textContent?.trim()).toBe("2");
    expect(getByTestId("sidebar-quick-notes-count").textContent?.trim()).toBe("2");
  });

  it("the count follows a capture and a delete", async () => {
    const { getByTestId, queryByTestId } = render(AppShell);
    await flush();
    expect(queryByTestId("rail-quick-notes-count")).toBeNull();

    await quickNotes.capture("The innkeeper knows");
    await flush();
    expect(getByTestId("rail-quick-notes-count").textContent?.trim()).toBe("1");

    await quickNotes.capture("Bridge is out");
    await flush();
    expect(getByTestId("rail-quick-notes-count").textContent?.trim()).toBe("2");

    await quickNotes.remove(1);
    await flush();
    expect(getByTestId("rail-quick-notes-count").textContent?.trim()).toBe("1");
  });

  it("an undone delete leaves the count where it was", async () => {
    // Forgetting is deferred behind an undo window (#232): undo cancels a timer
    // rather than restoring a row, so nothing ever left the ledger and the badge
    // must not have flinched. Driven through the pane's own delete button, with
    // the pane mounted where the GM meets it — inside the shell that draws the
    // badge.
    await quickNotes.capture("The innkeeper knows");
    tabs.openTab({ type: "quickNotes", id: 0, title: "Quick Notes" });

    const { getByTestId, container } = render(AppShell);
    await flush();
    expect(getByTestId("rail-quick-notes-count").textContent?.trim()).toBe("1");

    const deleteButton = container.querySelector<HTMLElement>("[data-quick-note-delete]");
    expect(deleteButton).toBeTruthy();
    await fireEvent.click(deleteButton!);
    await flush();

    const [, , onCancel] = vi.mocked(toastUndo).mock.calls.at(-1)!;
    onCancel?.();
    await flush();

    expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === "delete_quick_note")).toBe(false);
    expect(getByTestId("rail-quick-notes-count").textContent?.trim()).toBe("1");
  });

  it("the sidebar carries one Quick Notes button and lists nothing", async () => {
    rows = [note(1, "The innkeeper knows"), note(2, "Bridge is out")];
    await quickNotes.load();

    const { getByTestId } = render(AppShell);
    await flush();

    const button = getByTestId("sidebar-quick-notes");
    const sidebar = button.closest<HTMLElement>('[data-slot="sidebar"]')!;
    // Not one row of the pen is drawn in the sidebar — the pane and the dialog
    // are the only two surfaces a Quick Note has. Scoped to the sidebar because
    // the pane itself may well be the open tab beside it.
    expect(within(sidebar).queryByText("The innkeeper knows")).toBeNull();
    expect(within(sidebar).queryByText("Bridge is out")).toBeNull();

    await fireEvent.click(button);
    await flush();
    expect(tabs.leftActiveTab?.type).toBe("quickNotes");
  });
});
