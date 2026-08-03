// The GM-facing half of the [[Format Migration]] mechanism (ADR-0017, #184):
// the composed consent prompt, and what each of the two answers does.
//
// The backend owns everything that decides *what* changes — the registry, the
// scan, the fold, the backup, the report (`src-tauri/src/format_migration/`).
// What only this seam can show is that the prompt is assembled from the plan
// rather than written here, that a decline opens nothing, and that a partial
// failure opens the vault and names its casualties.
import {
  render,
  cleanup,
  act,
  fireEvent,
  waitFor,
} from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "svelte-sonner";
import FormatMigrationDialog from "../lib/components/FormatMigrationDialog.svelte";
import { ledger } from "../lib/stores/ledger.svelte";

vi.mock("svelte-sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
  Toaster: vi.fn(),
}));

const VAULT = "/worlds/old-world";
const REFUSAL =
  "ERR_FORMAT_MIGRATION_REQUIRED: vault notes are on format 0, this Grimoire writes 1";

const TIMELINE_SENTENCE =
  'Timeline events will be written with their title as a heading instead of a "Title:" line, so a description can run to more than one paragraph.';

const PLAN = {
  from: 0,
  to: 1,
  sentences: [TIMELINE_SENTENCE],
  file_count: 23,
  warnings: [],
} as const;

const OPENED = {
  path: VAULT,
  note_count: 23,
  scene_count: 0,
  map_count: 0,
  failed_imports: [],
  recovered_from_backup: null,
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Drive the store into the behind-vault state through the real open path. */
async function refuseOpen(plan: unknown = PLAN) {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "open_ledger") throw REFUSAL;
    if (cmd === "plan_format_migration") return plan;
    return null;
  });
  await expect(ledger.openLedger(VAULT)).rejects.toBeTruthy();
  await flush();
}

/** What `migrate_ledger_format` answers with, once the GM says yes. */
function migrateResult(report: Partial<Record<string, unknown>> = {}) {
  return {
    report: {
      from: 0,
      to: 1,
      migrated: Array.from({ length: 23 }, (_, i) => `Note ${i}.md`),
      failed: [],
      warnings: [],
      backup_dir: `${VAULT}/.grimoire/format-backup-20260730T120000Z`,
      report_path: `${VAULT}/.grimoire/format-backup-20260730T120000Z/migration-report.md`,
      stamped: true,
      ...report,
    },
    ledger: OPENED,
  };
}

afterEach(async () => {
  cleanup();
  ledger.dismissFormatMigration();
  ledger.dismissCorruptLedger();
  await ledger.closeLedger();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(null);
  vi.mocked(toast).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("the consent prompt is composed from the plan", () => {
  it("a behind vault asks the scan what would change and prompts with it", async () => {
    const { getByTestId } = render(FormatMigrationDialog);
    await refuseOpen();

    // The prompt cannot say "23 notes" without the scan having found them.
    const asked = vi
      .mocked(invoke)
      .mock.calls.find(([cmd]) => cmd === "plan_format_migration");
    expect(asked?.[1]).toMatchObject({ path: VAULT });

    await waitFor(() => {
      const text = getByTestId("format-migration-dialog").textContent ?? "";
      // The union count, and the migration's own sentence — not copy written here.
      expect(text).toContain("23 notes");
      expect(text).toContain("title as a heading");
      // And the reassurance the whole mechanism is built on.
      expect(text).toContain("copied first");
    });
    // Nothing has been opened or rewritten yet.
    expect(ledger.isOpen).toBe(false);
    expect(vi.mocked(invoke).mock.calls.map(([c]) => c)).not.toContain(
      "migrate_ledger_format",
    );
  });

  it("carries the Timeline prose warning, named per file", async () => {
    const { getByTestId } = render(FormatMigrationDialog);
    await refuseOpen({
      ...PLAN,
      file_count: 2,
      warnings: [
        'Lore/Chronicle.md: a description line starting with # is indented by one space, so it stays part of the event "The Shattering" instead of starting a new one',
      ],
    });

    await waitFor(() => {
      const text = getByTestId("format-migration-dialog").textContent ?? "";
      expect(text).toContain("One line of your own writing changes");
      expect(text).toContain("Lore/Chronicle.md");
      expect(text).toContain("indented by one space");
    });
  });

  it("says nothing about prose when the scan raised no warning", async () => {
    const { getByTestId } = render(FormatMigrationDialog);
    await refuseOpen();

    await waitFor(() => getByTestId("format-migration-dialog"));
    expect(getByTestId("format-migration-dialog").textContent).not.toContain(
      "your own writing",
    );
  });

  it("counts one affected note in the singular", async () => {
    const { getByTestId } = render(FormatMigrationDialog);
    await refuseOpen({ ...PLAN, file_count: 1 });

    await waitFor(() => {
      expect(getByTestId("format-migration-dialog").textContent).toContain(
        "1 note in this ledger",
      );
    });
  });

  it("renders one sentence per pending migration", async () => {
    // A vault several versions behind: the dialog is the sentences of whichever
    // migrations found work, so nobody edits it again.
    const { getByTestId } = render(FormatMigrationDialog);
    await refuseOpen({
      ...PLAN,
      from: 0,
      to: 3,
      sentences: [TIMELINE_SENTENCE, "Scene blocks will be written as fences."],
    });

    await waitFor(() => {
      const text = getByTestId("format-migration-dialog").textContent ?? "";
      expect(text).toContain("title as a heading");
      expect(text).toContain("Scene blocks will be written as fences.");
    });
  });

  it("shows no prompt when the scan finds no work", async () => {
    // Reached when the backend refused for some other reason, or the vault
    // changed underneath the refusal: with no plan there is nothing to consent
    // to, so the refusal simply stands.
    render(FormatMigrationDialog);
    await refuseOpen(null);

    expect(ledger.formatMigration).toBeNull();
    expect(ledger.isOpen).toBe(false);
  });
});

describe("saying yes", () => {
  it("migrates, opens the ledger, and records it as recently opened", async () => {
    const { getByTestId } = render(FormatMigrationDialog);
    await refuseOpen();

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "migrate_ledger_format") return migrateResult();
      return null;
    });
    await waitFor(() => getByTestId("format-migration-confirm"));
    await fireEvent.click(getByTestId("format-migration-confirm"));
    await flush();
    await flush();

    const migrate = vi
      .mocked(invoke)
      .mock.calls.find(([cmd]) => cmd === "migrate_ledger_format");
    expect(migrate?.[1]).toMatchObject({ path: VAULT });
    expect(ledger.isOpen).toBe(true);
    expect(ledger.path).toBe(VAULT);
    expect(ledger.formatMigration).toBeNull();
    expect(vi.mocked(invoke).mock.calls.map(([c]) => c)).toContain(
      "add_recent_ledger",
    );
  });

  it("points at the report with a toast that fades", async () => {
    const { getByTestId } = render(FormatMigrationDialog);
    await refuseOpen();
    vi.mocked(invoke).mockImplementation(async (cmd: string) =>
      cmd === "migrate_ledger_format" ? migrateResult() : null,
    );

    await waitFor(() => getByTestId("format-migration-confirm"));
    await fireEvent.click(getByTestId("format-migration-confirm"));
    await flush();
    await flush();

    // The report is the record; the toast only points at it, and a clean sweep
    // is news rather than an unresolved state, so it expires.
    const [message, options] = vi.mocked(toast).mock.calls.at(-1) ?? [];
    expect(message).toBe("23 notes updated");
    expect(
      String((options as { description?: string })?.description),
    ).toContain("migration-report.md");
    expect((options as { duration?: number })?.duration).not.toBe(Infinity);
  });

  it("a partial failure opens the vault and names the casualties, persistently", async () => {
    const { getByTestId } = render(FormatMigrationDialog);
    await refuseOpen();
    vi.mocked(invoke).mockImplementation(async (cmd: string) =>
      cmd === "migrate_ledger_format"
        ? migrateResult({
            migrated: ["Alpha.md", "Zeta.md"],
            failed: [{ path: "Locked.md", reason: "access denied" }],
            stamped: false,
          })
        : null,
    );

    await waitFor(() => getByTestId("format-migration-confirm"));
    await fireEvent.click(getByTestId("format-migration-confirm"));
    await flush();
    await flush();

    // Consent was given and the casualties are named, so the vault opens — the
    // alternative is a permanent lockout from a campaign over one file.
    expect(ledger.isOpen).toBe(true);
    const [message, options] = vi.mocked(toast.error).mock.calls.at(-1) ?? [];
    expect(message).toContain("1 note couldn't be updated");
    expect((options as { duration?: number })?.duration).toBe(Infinity);
    expect(
      String((options as { description?: string })?.description),
    ).toContain("migration-report.md");
  });

  it("cannot be dismissed while the notes are being rewritten", async () => {
    const { getByTestId } = render(FormatMigrationDialog);
    await refuseOpen();

    // A migration that has not answered yet.
    let release: (value: unknown) => void = () => {};
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "migrate_ledger_format")
        return new Promise((resolve) => {
          release = resolve;
        });
      return null;
    });

    await waitFor(() => getByTestId("format-migration-confirm"));
    await fireEvent.click(getByTestId("format-migration-confirm"));
    await flush();

    // Backing out now would clear the prompt while the pass ran on regardless,
    // and the ledger would open behind an empty screen.
    const cancel = getByTestId("format-migration-cancel");
    expect(cancel.getAttribute("aria-disabled")).toBe("true");
    await fireEvent.click(cancel);
    await flush();
    expect(ledger.formatMigration).not.toBeNull();

    release(migrateResult());
    await flush();
    await flush();
    expect(ledger.isOpen).toBe(true);
  });

  it("a failed migration keeps the prompt open and opens nothing", async () => {
    const { getByTestId } = render(FormatMigrationDialog);
    await refuseOpen();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "migrate_ledger_format")
        throw "ERR_FORMAT_BACKUP_FAILED: could not copy Chronicle.md";
      return null;
    });

    await waitFor(() => getByTestId("format-migration-confirm"));
    await fireEvent.click(getByTestId("format-migration-confirm"));
    await flush();
    await flush();

    expect(ledger.isOpen).toBe(false);
    // Still on screen: a silent close would leave the GM at the welcome screen
    // with no idea whether their notes had been touched.
    expect(ledger.formatMigration).not.toBeNull();
  });
});

describe("a ledger that is damaged and behind", () => {
  it("the rebuild path reaches the prompt instead of a dead end", async () => {
    // The database was rebuilt, and the vault behind it turns out to be on an
    // old note format. Without routing this refusal the GM would be left with a
    // generic toast and no way through.
    const { getByTestId } = render(FormatMigrationDialog);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "open_ledger") throw "ERR_DB_CORRUPT: quick_check failed";
      return null;
    });
    await expect(ledger.openLedger(VAULT)).rejects.toBeTruthy();
    await flush();
    expect(ledger.corruptLedgerPath).toBe(VAULT);

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "rebuild_ledger_db") throw REFUSAL;
      if (cmd === "plan_format_migration") return PLAN;
      return null;
    });
    await expect(ledger.rebuildCorruptLedger()).rejects.toBeTruthy();
    await flush();

    expect(ledger.formatMigration?.path).toBe(VAULT);
    // One dialog at a time: the database question is settled by now.
    expect(ledger.corruptLedgerPath).toBeNull();
    await waitFor(() => getByTestId("format-migration-dialog"));
  });
});

describe("saying no", () => {
  it("opens nothing and rewrites nothing", async () => {
    const { getByTestId } = render(FormatMigrationDialog);
    await refuseOpen();
    vi.mocked(invoke).mockClear();

    await waitFor(() => getByTestId("format-migration-cancel"));
    await fireEvent.click(getByTestId("format-migration-cancel"));
    await flush();

    expect(ledger.formatMigration).toBeNull();
    expect(ledger.isOpen).toBe(false);
    expect(ledger.path).toBeNull();
    // There is no compatibility mode and no "open at your own risk": with no
    // reader for the old format, opening would destroy content unseen.
    const calls = vi.mocked(invoke).mock.calls.map(([cmd]) => cmd);
    expect(calls).not.toContain("migrate_ledger_format");
    expect(calls).not.toContain("add_recent_ledger");
  });
});

describe("what the GM is told, and when", () => {
  it("says nothing beside the prompt: the dialog is the whole refusal", async () => {
    // The toast used to fire from the command wrapper before the prompt had even been
    // composed, so the GM got a line telling them their notes needed updating and then a
    // dialog telling them the same thing with the count, the changes and both answers
    // (#175 review). A dialog already forcing a decision does not need a toast.
    render(FormatMigrationDialog);
    await refuseOpen();

    expect(ledger.formatMigration).not.toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("still reports when no prompt can be composed", async () => {
    // The dead end: the scan itself failed, so there is nothing to consent to and the
    // refusal stands. Suppressing the toast here would leave the GM at the welcome
    // screen with a ledger that silently refused to open.
    render(FormatMigrationDialog);
    await refuseOpen(null);

    expect(ledger.formatMigration).toBeNull();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain("need updating");
  });

  it("reports the work afterwards, which is the toast that is worth having", async () => {
    render(FormatMigrationDialog);
    await refuseOpen();
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "migrate_ledger_format") return migrateResult();
      return null;
    });

    await fireEvent.click(document.querySelector("[data-testid=format-migration-confirm]") as HTMLElement);
    await flush();
    await flush();

    expect(ledger.isOpen).toBe(true);
    const [message] = vi.mocked(toast).mock.calls.at(-1) ?? [];
    expect(message).toMatch(/notes? updated/);
  });
});
