import { render, cleanup, act, fireEvent, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import DbRecoveryDialog from "../lib/components/DbRecoveryDialog.svelte";
import { ledger } from "../lib/stores/ledger.svelte";

vi.mock("svelte-sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
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
      expect(getByTestId("db-recovery-dialog").textContent).toContain(
        "scenes, pins, and map details will be lost",
      );
    });
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
          recovered_from_backup: null,
        };
      return null;
    });

    await waitFor(() => getByTestId("db-recovery-rebuild"));
    await fireEvent.click(getByTestId("db-recovery-rebuild"));
    await flush();
    await flush();

    const calls = vi.mocked(invoke).mock.calls;
    const rebuild = calls.find(([cmd]) => cmd === "rebuild_ledger_db");
    expect(rebuild?.[1]).toMatchObject({ path: CORRUPT_PATH });
    expect(ledger.isOpen).toBe(true);
    expect(ledger.corruptLedgerPath).toBeNull();
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
