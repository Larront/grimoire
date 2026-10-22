import { render, cleanup, act, fireEvent, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import DbRecoveryDialog from "../lib/components/DbRecoveryDialog.svelte";
import { ledger } from "../lib/stores/ledger.svelte";
import { toast as sonner } from "svelte-sonner";

vi.mock("svelte-sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    dismiss: vi.fn(),
  }),
  Toaster: vi.fn(),
}));

const CORRUPT_PATH = "/worlds/damaged-world";

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Drive the store into the corrupt state through the real openAtPath path. */
async function triggerCorrupt() {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "open_ledger") throw "ERR_DB_CORRUPT: quick_check failed";
    return null;
  });
  await expect(ledger.openLedger(CORRUPT_PATH)).rejects.toBeTruthy();
  await flush();
}

afterEach(async () => {
  cleanup();
  ledger.dismissCorruptLedger();
  await ledger.closeLedger();
  vi.mocked(invoke).mockResolvedValue(null);
});

describe("DB recovery dialog (issue #116)", () => {
  it("ERR_DB_CORRUPT from open_ledger opens the rebuild dialog", async () => {
    const { getByTestId } = render(DbRecoveryDialog);
    await triggerCorrupt();

    expect(ledger.corruptLedgerPath).toBe(CORRUPT_PATH);
    await waitFor(() => {
      // Whitespace collapsed: the copy wraps in the markup, and where it wraps is
      // the formatter's business, not this assertion's.
      const text = getByTestId("db-recovery-dialog").textContent?.replace(/\s+/g, " ");
      // It names the world it is about — over another world it read as that one.
      expect(text).toContain("“damaged-world” can't open as it is");
      // Quick Notes are database-only (ADR-0018), so a rebuild takes them too — a GM
      // deciding whether to rebuild has to be told that before they choose. And maps
      // come back from their images, but without their pins.
      expect(text).toContain("each map from its image, without its pins");
      expect(text).toContain("Scenes and Quick Notes can't be brought back");
    });
  });

  it("says it in the dialog only — no toast repeating its title", async () => {
    render(DbRecoveryDialog);
    vi.mocked(sonner.error).mockClear();
    await triggerCorrupt();
    expect(sonner.error).not.toHaveBeenCalled();
  });

  it("says a failed rebuild in the dialog, which stays to try again", async () => {
    const { getByTestId, findByTestId } = render(DbRecoveryDialog);
    await triggerCorrupt();
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "rebuild_ledger_db") throw "Failed to move damaged database aside: denied";
      return null;
    });
    await waitFor(() => getByTestId("db-recovery-rebuild"));
    await fireEvent.click(getByTestId("db-recovery-rebuild"));

    const error = await findByTestId("db-recovery-error");
    expect(error.textContent).toContain("Couldn't rebuild it");
    expect(error.textContent).not.toContain("Failed to move");
    expect(ledger.corruptLedgerPath).toBe(CORRUPT_PATH);
  });

  it("Rebuild calls rebuild_ledger_db and opens the ledger", async () => {
    const { getByTestId } = render(DbRecoveryDialog);
    await triggerCorrupt();

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "rebuild_ledger_db")
        return {
          path: CORRUPT_PATH,
          note_count: 7,
          scene_count: 0,
          map_count: 0,
          failed_imports: [],
          unlinked_pins: [],
          recovered_from_backup: null,
          damaged_file: "/worlds/damaged-world/.grimoire/ledger.db.corrupt-1",
          rebuilt: { maps_recovered: 2 },
        };
      return null;
    });
    vi.mocked(sonner).mockClear();

    await waitFor(() => getByTestId("db-recovery-rebuild"));
    await fireEvent.click(getByTestId("db-recovery-rebuild"));
    await flush();
    await flush();

    const calls = vi.mocked(invoke).mock.calls;
    const rebuild = calls.find(([cmd]) => cmd === "rebuild_ledger_db");
    expect(rebuild?.[1]).toMatchObject({ path: CORRUPT_PATH });
    expect(ledger.isOpen).toBe(true);
    expect(ledger.corruptLedgerPath).toBeNull();
    // And it says what came back, and what didn't, where the GM can read it.
    const [title, opts] = vi.mocked(sonner).mock.calls.at(-1) as unknown as [
      string,
      { description: string; closeButton: boolean; action: { label: string } },
    ];
    expect(title).toBe("“damaged-world” was rebuilt from its notes");
    expect(opts.description).toContain("Its 2 maps came back from their images, without pins");
    expect(opts.closeButton).toBe(true);
    expect(opts.action.label).toBe("Show damaged file");
  });

  it("names a restore lastingly but closably, and the next open takes it down", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) =>
      cmd === "open_ledger"
        ? {
            path: CORRUPT_PATH,
            note_count: 1,
            scene_count: 0,
            map_count: 0,
            failed_imports: [],
            unlinked_pins: [],
            recovered_from_backup: "2026-10-21T19:30:00Z",
            damaged_file: null,
            rebuilt: null,
          }
        : null,
    );
    vi.mocked(sonner).mockClear();
    await ledger.openLedger(CORRUPT_PATH);
    const [title, opts] = vi.mocked(sonner).mock.calls.at(-1) as unknown as [
      string,
      { description: string; closeButton: boolean; id: string },
    ];
    expect(title).toBe("“damaged-world” was restored from its last backup");
    expect(opts.description).toContain("Your notes are unaffected");
    expect(opts.closeButton).toBe(true);

    vi.mocked(invoke).mockImplementation(async (cmd: string) =>
      cmd === "open_ledger"
        ? {
            path: "/worlds/other",
            note_count: 1,
            scene_count: 0,
            map_count: 0,
            failed_imports: [],
            unlinked_pins: [],
            recovered_from_backup: null,
          }
        : null,
    );
    await ledger.openLedger("/worlds/other");
    expect(sonner.dismiss).toHaveBeenCalledWith(opts.id);

    // And closing a world takes it down too — it used to sit on over the Splash.
    vi.mocked(sonner.dismiss).mockClear();
    await ledger.closeLedger();
    expect(sonner.dismiss).toHaveBeenCalledWith(opts.id);
  });

  it("Cancel dismisses without touching the database", async () => {
    const { getByTestId } = render(DbRecoveryDialog);
    await triggerCorrupt();

    vi.mocked(invoke).mockClear();
    await waitFor(() => getByTestId("db-recovery-cancel"));
    await fireEvent.click(getByTestId("db-recovery-cancel"));
    await flush();

    expect(ledger.corruptLedgerPath).toBeNull();
    const calls = vi.mocked(invoke).mock.calls.map(([cmd]) => cmd);
    expect(calls).not.toContain("rebuild_ledger_db");
    expect(ledger.isOpen).toBe(false);
  });
});
