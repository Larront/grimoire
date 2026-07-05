import { render, fireEvent, cleanup, act, waitFor, within } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import AppShell from "../lib/components/AppShell.svelte";
import { tabs } from "../lib/stores/tabs.svelte";
import { notes } from "../lib/stores/notes.svelte";
import { appPrefs } from "../lib/stores/app-prefs.svelte";
import type { Note } from "../lib/types/ledger";

vi.mock("svelte-sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
  Toaster: vi.fn(),
}));

import { toast } from "svelte-sonner";

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

const testNote: Note = {
  id: 1,
  path: "Aldric.md",
  title: "Aldric",
  icon: null,
  cover_image: null,
  parent_path: null,
  archived: false,
  modified_at: "2026-01-01T00:00:00Z",
};

afterEach(async () => {
  cleanup();
  tabs.closeAll("left");
  tabs.closeAll("right");
  appPrefs.setConfirmRenameLinks(false);
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: desktopMatchMedia,
  });
  vi.mocked(invoke).mockResolvedValue(null);
  vi.mocked(toast.success).mockClear();
});

/** Defaults that keep the RightRail and other sub-components happy. */
function withRailDefaults(
  invokeImpl: (cmd: string, args?: unknown) => unknown,
): (cmd: string, args?: unknown) => Promise<unknown> {
  return async (cmd: string, args?: unknown) => {
    if (cmd === "read_note_content") return "";
    if (cmd === "read_note_tags") return [];
    if (cmd === "list_all_tags") return [];
    if (cmd === "get_note_aliases") return [];
    if (cmd === "get_alias_collisions") return [];
    return invokeImpl(cmd, args);
  };
}

async function openNotePane(
  invokeImpl: (cmd: string, args?: unknown) => unknown,
) {
  vi.mocked(invoke).mockImplementation(withRailDefaults(invokeImpl));
  tabs.openTab({ type: "note", id: 1, title: "Aldric" });
  await act(() => notes.load());
  return render(AppShell);
}

// ── Auto-rewrite (confirmRenameLinks = off, default) ──────────────────────────

describe("note rename — auto-rewrite (toggle off)", () => {
  it("calls rename_note when title changes (no backlinks)", async () => {
    const invokeSpy = vi.mocked(invoke);
    const { container } = await openNotePane(async (cmd) => {
      if (cmd === "get_notes") return [testNote];
      if (cmd === "rename_note")
        return { note: { ...testNote, title: "Aldric 2", path: "Aldric 2.md" }, updated_count: 0 };
      return null;
    });

    const titleInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Untitled"]',
    );
    expect(titleInput).toBeTruthy();

    await fireEvent.input(titleInput!, { target: { value: "Aldric 2" } });
    invokeSpy.mockClear();
    await fireEvent.blur(titleInput!);

    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith(
        "rename_note",
        expect.objectContaining({
          note: expect.objectContaining({ title: "Aldric 2", path: "Aldric 2.md" }),
        }),
      );
    });
  });

  it("shows a toast with the count when backlinks are updated", async () => {
    const { container } = await openNotePane(async (cmd) => {
      if (cmd === "get_notes") return [testNote];
      if (cmd === "rename_note")
        return {
          note: { ...testNote, title: "Aldric 2", path: "Aldric 2.md" },
          updated_count: 3,
        };
      return null;
    });

    const titleInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Untitled"]',
    );
    await fireEvent.input(titleInput!, { target: { value: "Aldric 2" } });
    await fireEvent.blur(titleInput!);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        "3 notes updated",
        expect.anything(),
      );
    });
  });

  it("shows singular 'note updated' when exactly one backlink is updated", async () => {
    const { container } = await openNotePane(async (cmd) => {
      if (cmd === "get_notes") return [testNote];
      if (cmd === "rename_note")
        return {
          note: { ...testNote, title: "Aldric 2", path: "Aldric 2.md" },
          updated_count: 1,
        };
      return null;
    });

    const titleInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Untitled"]',
    );
    await fireEvent.input(titleInput!, { target: { value: "Aldric 2" } });
    await fireEvent.blur(titleInput!);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        "1 note updated",
        expect.anything(),
      );
    });
  });

  it("does not show a toast when updated_count is 0", async () => {
    const { container } = await openNotePane(async (cmd) => {
      if (cmd === "get_notes") return [testNote];
      if (cmd === "rename_note")
        return {
          note: { ...testNote, title: "Aldric 2", path: "Aldric 2.md" },
          updated_count: 0,
        };
      return null;
    });

    const titleInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Untitled"]',
    );
    await fireEvent.input(titleInput!, { target: { value: "Aldric 2" } });
    await fireEvent.blur(titleInput!);

    await act(() => {});
    expect(toast.success).not.toHaveBeenCalled();
  });
});

// ── Confirmation dialog (confirmRenameLinks = on) ─────────────────────────────

describe("note rename — confirmation dialog (toggle on)", () => {
  beforeEach(() => {
    appPrefs.setConfirmRenameLinks(true);
  });

  it("shows dialog when there are backlinks and toggle is on", async () => {
    const { container } = await openNotePane(async (cmd) => {
      if (cmd === "get_notes") return [testNote];
      if (cmd === "get_note_backlink_count") return 2;
      return null;
    });

    const titleInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Untitled"]',
    );
    await fireEvent.input(titleInput!, { target: { value: "Aldric 2" } });
    await fireEvent.blur(titleInput!);

    await waitFor(() => {
      expect(document.body.querySelector('[role="alertdialog"]')).toBeTruthy();
    });
  });

  it("dialog shows the backlink count in its description", async () => {
    const { container } = await openNotePane(async (cmd) => {
      if (cmd === "get_notes") return [testNote];
      if (cmd === "get_note_backlink_count") return 2;
      return null;
    });

    const titleInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Untitled"]',
    );
    await fireEvent.input(titleInput!, { target: { value: "Aldric 2" } });
    await fireEvent.blur(titleInput!);

    await waitFor(() => {
      const dialog = document.body.querySelector('[role="alertdialog"]');
      expect(dialog).toBeTruthy();
      expect(dialog!.textContent).toMatch(/2\s+notes link/);
    });
  });

  it("'Rename + Update' calls rename_note", async () => {
    const invokeSpy = vi.mocked(invoke);
    const { container } = await openNotePane(async (cmd) => {
      if (cmd === "get_notes") return [testNote];
      if (cmd === "get_note_backlink_count") return 2;
      if (cmd === "rename_note")
        return {
          note: { ...testNote, title: "Aldric 2", path: "Aldric 2.md" },
          updated_count: 2,
        };
      return null;
    });

    const titleInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Untitled"]',
    );
    await fireEvent.input(titleInput!, { target: { value: "Aldric 2" } });
    await fireEvent.blur(titleInput!);
    await waitFor(() =>
      expect(document.body.querySelector('[role="alertdialog"]')).toBeTruthy(),
    );

    invokeSpy.mockClear();
    const updateBtn = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="rename-update-btn"]',
    );
    expect(updateBtn).toBeTruthy();
    await fireEvent.click(updateBtn!);

    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith(
        "rename_note",
        expect.objectContaining({
          note: expect.objectContaining({ title: "Aldric 2" }),
        }),
      );
    });
  });

  it("'Rename only' calls update_note (not rename_note)", async () => {
    const invokeSpy = vi.mocked(invoke);
    const { container } = await openNotePane(async (cmd) => {
      if (cmd === "get_notes") return [testNote];
      if (cmd === "get_note_backlink_count") return 2;
      if (cmd === "update_note")
        return { ...testNote, title: "Aldric 2", path: "Aldric 2.md" };
      return null;
    });

    const titleInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Untitled"]',
    );
    await fireEvent.input(titleInput!, { target: { value: "Aldric 2" } });
    await fireEvent.blur(titleInput!);
    await waitFor(() =>
      expect(document.body.querySelector('[role="alertdialog"]')).toBeTruthy(),
    );

    invokeSpy.mockClear();
    const renameOnlyBtn = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="rename-only-btn"]',
    );
    expect(renameOnlyBtn).toBeTruthy();
    await fireEvent.click(renameOnlyBtn!);

    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith(
        "update_note",
        expect.objectContaining({
          note: expect.objectContaining({ title: "Aldric 2" }),
        }),
      );
      expect(invokeSpy).not.toHaveBeenCalledWith(
        "rename_note",
        expect.anything(),
      );
    });
  });

  it("Cancel closes the dialog and resets the title", async () => {
    const { container } = await openNotePane(async (cmd) => {
      if (cmd === "get_notes") return [testNote];
      if (cmd === "get_note_backlink_count") return 2;
      return null;
    });

    const titleInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Untitled"]',
    );
    await fireEvent.input(titleInput!, { target: { value: "Aldric 2" } });
    await fireEvent.blur(titleInput!);
    await waitFor(() =>
      expect(document.body.querySelector('[role="alertdialog"]')).toBeTruthy(),
    );

    const cancelBtn = document.body.querySelector<HTMLButtonElement>(
      '[role="alertdialog"] button',
    );
    await fireEvent.click(cancelBtn!);

    await waitFor(() => {
      expect(document.body.querySelector('[role="alertdialog"]')).toBeFalsy();
    });
  });

  it("does not show dialog when there are no backlinks (toggle on)", async () => {
    const invokeSpy = vi.mocked(invoke);
    const { container } = await openNotePane(async (cmd) => {
      if (cmd === "get_notes") return [testNote];
      if (cmd === "get_note_backlink_count") return 0;
      if (cmd === "rename_note")
        return {
          note: { ...testNote, title: "Aldric 2", path: "Aldric 2.md" },
          updated_count: 0,
        };
      return null;
    });

    const titleInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Untitled"]',
    );
    await fireEvent.input(titleInput!, { target: { value: "Aldric 2" } });
    invokeSpy.mockClear();
    await fireEvent.blur(titleInput!);

    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith(
        "rename_note",
        expect.objectContaining({
          note: expect.objectContaining({ title: "Aldric 2" }),
        }),
      );
    });
    expect(document.body.querySelector('[role="alertdialog"]')).toBeFalsy();
  });
});

// ── Settings dialog — Editing section ────────────────────────────────────────

describe("settings dialog — editing section", () => {
  // Editing prefs now live under the "Content" section tab; navigate there.
  async function openSettingsDialog() {
    vi.mocked(invoke).mockResolvedValue(null);
    const result = render(AppShell);
    const rail = result.getByTestId("icon-rail");
    await fireEvent.click(within(rail).getByRole("button", { name: /^settings$/i }));
    const dialog = await result.findByRole("dialog");
    await fireEvent.click(within(dialog).getByTestId("settings-tab-content"));
    return { ...result, dialog };
  }

  it("exposes a 'Content' settings section", async () => {
    const { dialog } = await openSettingsDialog();
    expect(within(dialog).getByTestId("settings-tab-content")).toBeTruthy();
  });

  it("renders the 'Confirm before updating links on rename' toggle", async () => {
    const { dialog } = await openSettingsDialog();
    const toggle = dialog.querySelector('[data-testid="confirm-rename-links-toggle"]');
    expect(toggle).toBeTruthy();
  });

  it("toggle defaults to off (aria-checked=false)", async () => {
    appPrefs.setConfirmRenameLinks(false);
    const { dialog } = await openSettingsDialog();
    const toggle = dialog.querySelector('[data-testid="confirm-rename-links-toggle"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
  });

  it("clicking the toggle turns it on (aria-checked=true)", async () => {
    appPrefs.setConfirmRenameLinks(false);
    const { dialog } = await openSettingsDialog();
    const toggle = dialog.querySelector<HTMLButtonElement>(
      '[data-testid="confirm-rename-links-toggle"]',
    );
    await fireEvent.click(toggle!);
    expect(appPrefs.confirmRenameLinks).toBe(true);
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
  });
});
