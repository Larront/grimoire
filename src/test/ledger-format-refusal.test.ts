// The GM-facing half of the [[Ledger Format Version]] gate (ADR-0017, #183):
// a refusal from `open_ledger` opens nothing. The comparison itself is the
// backend's (`src-tauri/src/format_version.rs`); what matters here is that a
// refused open leaves the app on the welcome screen rather than half-open, and
// that a format refusal is not mistaken for a damaged database.
import { describe, it, expect, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ledger } from "../lib/stores/ledger.svelte";

vi.mock("svelte-sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
  Toaster: vi.fn(),
}));

const VAULT = "/worlds/synced-world";

afterEach(async () => {
  ledger.dismissCorruptLedger();
  await ledger.closeLedger();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(null);
});

describe("Ledger format refusals", () => {
  const refusals = [
    ["ERR_FORMAT_AHEAD: vault notes are on format 2, this Grimoire only reads 1", "ahead"],
    [
      "ERR_FORMAT_MIGRATION_REQUIRED: vault notes are on format 0, this Grimoire writes 1",
      "behind",
    ],
    ["ERR_FORMAT_STAMP_UNREADABLE: does not hold a format version", "corrupt stamp"],
  ] as const;

  for (const [raw, label] of refusals) {
    it(`a ${label} vault opens nothing`, async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "open_ledger") throw raw;
        return null;
      });

      await expect(ledger.openLedger(VAULT)).rejects.toBeTruthy();

      expect(ledger.isOpen).toBe(false);
      expect(ledger.path).toBeNull();
      // Not a database problem — the rebuild dialog must stay shut, or the GM
      // is offered a destructive fix for something a rebuild cannot touch.
      expect(ledger.corruptLedgerPath).toBeNull();
      // A refused vault is not recorded as recently opened.
      const calls = vi.mocked(invoke).mock.calls.map(([cmd]) => cmd);
      expect(calls).not.toContain("add_recent_ledger");
    });
  }
});
