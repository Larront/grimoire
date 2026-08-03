import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "svelte-sonner";
import { api, friendlyMessage } from "$lib/api";
import { toastError, toastImportFailures, toastMigrationReport } from "$lib/toast";
import { pendingSaves } from "$lib/stores/pending-saves";
import type { MigrationPlan } from "$lib/bindings.gen";

export type AccentPreset =
  | "accent-crimson"
  | "accent-arcane"
  | "accent-verdant"
  | "accent-ice"
  | "accent-amber";

export type DensityLevel = "cozy" | "balanced" | "dense";

export interface FailedImport {
  path: string;
  reason: string;
}

interface OpenLedgerResult {
  path: string;
  note_count: number;
  scene_count: number;
  map_count: number;
  failed_imports: FailedImport[];
  /** RFC 3339 date of the snapshot the DB was auto-restored from (issue #116). */
  recovered_from_backup: string | null;
}

export interface RecentLedger {
  path: string;
  name: string;
  note_count: number;
  scene_count: number;
  map_count: number;
  last_opened: string;
  /** Derived by the backend at read time: folder not found on disk. */
  missing?: boolean;
}

export const failedImportsModal = $state({
  open: false,
  failures: [] as FailedImport[],
});

function createLedgerStore() {
  let path = $state<string | null>(null);
  let isOpen = $state(false);
  let isLoading = $state(false);
  let error = $state<string | null>(null);
  let accent = $state<AccentPreset>("accent-crimson");
  let density = $state<DensityLevel>("balanced");
  let isSample = $state(false);
  let pendingStartHere = $state(false);
  // Set when open_ledger reported ERR_DB_CORRUPT with no usable snapshot —
  // DbRecoveryDialog (mounted in the root layout) offers Rebuild/Cancel.
  let corruptLedgerPath = $state<string | null>(null);
  // Set when open_ledger refused because the vault's notes are on an older
  // format (ADR-0017) — FormatMigrationDialog (also in the root layout) composes
  // its copy from this plan and offers Update/Cancel. Declining leaves it null
  // and the ledger closed: the refusal that put it here simply stands.
  let formatMigration = $state<{ path: string; plan: MigrationPlan } | null>(
    null,
  );

  /** Applies a successful open_ledger result to store state and surfaces
   *  failed imports and snapshot recovery. */
  function applyOpenResult(result: OpenLedgerResult): void {
    path = result.path;
    isOpen = true;

    if (result.failed_imports.length > 0) {
      failedImportsModal.failures = result.failed_imports;
      toastImportFailures(result.failed_imports, () => {
        failedImportsModal.open = true;
      });
    }

    // Invisible background recovery → informational toast (issue #116).
    if (result.recovered_from_backup) {
      const taken = new Date(result.recovered_from_backup);
      toast("Ledger restored from a backup", {
        description: `The database was damaged and has been restored — scenes and pins reflect ${taken.toLocaleString()}. The damaged file was kept beside it.`,
        duration: Infinity,
      });
    }
  }

  /** Invokes open_ledger, updates store state, and surfaces failed imports. */
  async function openAtPath(ledgerPath: string): Promise<OpenLedgerResult> {
    // Flush pending editor saves while the outgoing ledger is still open, so
    // a debounced edit is never dropped or written into the wrong ledger.
    await pendingSaves.flushAll();
    try {
      // The quiet surface, so a refusal that becomes a dialog is not also toasted:
      // reporting is this function's own job below, once the routing has decided
      // whether anything else is going to speak.
      const result = await api.silent.openLedger(ledgerPath);
      applyOpenResult(result);
      return result;
    } catch (e) {
      const routed = await routeOpenRefusal(ledgerPath, e);
      if (!routed) toastError(friendlyMessage(e));
      throw e;
    }
  }

  /** Turn a refusal from an open into the dialog that resolves it, if there is
   *  one. Shared by both ways in — a plain open and a post-rebuild open — because
   *  a ledger can be damaged *and* behind, and the rebuild path reaching the
   *  format refusal with no prompt would be a dead end.
   *
   *  Returns whether a prompt took the refusal over, which is what decides if it
   *  is also toasted. Only the [[Format Migration]] prompt answers yes: it states
   *  the whole refusal — the count, what changes, and both ways out — so a toast
   *  beside it would say less than the dialog behind it. The rebuild prompt is
   *  left reporting, because a damaged database is a fault the GM should be told
   *  about whether or not they take the offer to repair it. */
  async function routeOpenRefusal(
    ledgerPath: string,
    e: unknown,
  ): Promise<boolean> {
    const raw = String(e);
    if (raw.includes("ERR_DB_CORRUPT")) {
      corruptLedgerPath = ledgerPath;
    }
    if (raw.includes("ERR_FORMAT_MIGRATION_REQUIRED")) {
      // Ask the scan what would change, so the prompt is composed from the
      // migrations that actually found work rather than written in advance.
      // A plan we cannot obtain means no prompt: the refusal stands, which is
      // the same place a decline leaves the GM.
      const plan = await api.silent
        .planFormatMigration(ledgerPath)
        .catch(() => null);
      if (plan) {
        formatMigration = { path: ledgerPath, plan };
        // The database side is settled by the time this refusal is reached, so
        // the rebuild dialog must step aside rather than stack behind it.
        corruptLedgerPath = null;
        return true;
      }
    }
    return false;
  }

  async function openLedger(selectedPath?: string): Promise<boolean> {
    isLoading = true;
    error = null;

    try {
      const ledgerPath =
        selectedPath ??
        (await open({
          directory: true,
          title: "Open Ledger Folder",
        }));

      if (!ledgerPath || typeof ledgerPath !== "string") {
        isLoading = false;
        return false;
      }

      const result = await openAtPath(ledgerPath);
      recordRecent(result);
      return true;
    } catch (e) {
      error = String(e);
      throw e;
    } finally {
      isLoading = false;
    }
  }

  // Record in recent ledgers (fire-and-forget).
  // Item counts in this entry are set at open time and refreshed on the next open_ledger call.
  // In-session counts are derived reactively from notes.noteCount, scenes.sceneCount,
  // and maps.mapCount — these update immediately after store.load() calls in the sidebar.
  function recordRecent(result: OpenLedgerResult): void {
    const name = result.path.split(/[\\/]/).pop() ?? "Untitled";
    api.silent
      .addRecentLedger({
        path: result.path,
        name,
        note_count: result.note_count,
        scene_count: result.scene_count,
        map_count: result.map_count,
        last_opened: new Date().toISOString(),
        missing: false,
      })
      .catch(() => {});
  }

  /** Confirmed rebuild after ERR_DB_CORRUPT with no snapshot: the backend
   *  moves the damaged database aside and re-runs the open flow (notes are
   *  recovered from their files; scenes/pins/maps are not — the dialog that
   *  triggers this said so). */
  async function rebuildCorruptLedger(): Promise<boolean> {
    const target = corruptLedgerPath;
    if (!target) return false;
    isLoading = true;
    error = null;
    try {
      const result = await api.rebuildLedgerDb(target);
      applyOpenResult(result);
      recordRecent(result);
      corruptLedgerPath = null;
      return true;
    } catch (e) {
      // A rebuilt database can still be a vault whose *notes* are behind: the
      // rebuild ran, the format gate refused, and without this the GM would be
      // left holding a generic toast and no way through.
      await routeOpenRefusal(target, e);
      error = String(e);
      throw e;
    } finally {
      isLoading = false;
    }
  }

  function dismissCorruptLedger(): void {
    corruptLedgerPath = null;
  }

  /** The GM said yes to the [[Format Migration]] prompt: the backend backs the
   *  affected notes up, rewrites them, writes its report, and opens the ledger.
   *  It opens even when some notes could not be rewritten — consent was given and
   *  the casualties are named — so the report is toasted either way, persistently
   *  when something failed. */
  async function migrateLedgerFormat(): Promise<boolean> {
    const target = formatMigration;
    if (!target) return false;
    isLoading = true;
    error = null;
    try {
      const result = await api.migrateLedgerFormat(target.path);
      applyOpenResult(result.ledger);
      recordRecent(result.ledger);
      formatMigration = null;
      toastMigrationReport(result.report);
      return true;
    } catch (e) {
      error = String(e);
      throw e;
    } finally {
      isLoading = false;
    }
  }

  /** Declining opens nothing: there is no compatibility mode, because with no
   *  reader for the old format an un-migrated vault would not expose the GM to a
   *  risk they accepted — it would destroy content they never see leave. */
  function dismissFormatMigration(): void {
    formatMigration = null;
  }

  async function adopt(parent: string, name: string): Promise<boolean> {
    isLoading = true;
    error = null;
    try {
      const destPath = await api.adoptSampleLedger(parent, name);
      const opened = await openLedger(destPath);
      if (!opened) {
        // openLedger only resolves false (without throwing) when no path was
        // chosen in the dialog — impossible here, but guard so isSample is
        // never cleared while the sandbox is still the open ledger.
        throw new Error("Failed to open the adopted ledger.");
      }
      isSample = false;
      return true;
    } catch (e) {
      error = String(e);
      throw e;
    } finally {
      isLoading = false;
    }
  }

  async function exploreSample(): Promise<boolean> {
    isLoading = true;
    error = null;
    try {
      // Flush before the backend wipes and re-copies the sandbox — if the
      // current ledger IS the sandbox, a later flush would write into the
      // freshly reset copy.
      await pendingSaves.flushAll();
      const sandboxPath = await api.exploreSampleLedger();
      await openAtPath(sandboxPath);
      isSample = true;
      pendingStartHere = true;
      return true;
    } catch (e) {
      error = String(e);
      throw e;
    } finally {
      isLoading = false;
    }
  }

  function setDensity(level: DensityLevel): void {
    density = level;
    api.silent.saveDensityLevel(level).catch(console.error);
  }

  function setAccent(preset: AccentPreset): void {
    accent = preset;
    api.silent.saveAccentPreset(preset).catch(console.error);
  }

  async function getRecentLedgers(): Promise<RecentLedger[]> {
    try {
      return (await api.silent.getRecentLedgers()) ?? [];
    } catch {
      return [];
    }
  }

  async function closeLedger(): Promise<void> {
    await pendingSaves.flushAll();
    try {
      await api.closeLedger();
    } catch (e) {
      // Log but do not block frontend close — we still clear local state
      console.warn("[ledger] close_ledger command failed:", e);
    }
    path = null;
    isOpen = false;
    isSample = false;
    pendingStartHere = false;
    accent = "accent-crimson";
    density = "balanced";
    error = null;
  }

  async function checkExistingLedger(): Promise<void> {
    try {
      const existingPath = await api.getLedgerPath();
      if (existingPath) {
        path = existingPath;
        isOpen = true;
      }
      const savedAccent = await api.getAccentPreset().catch(() => null);
      if (savedAccent) accent = savedAccent as AccentPreset;
      const savedDensity = await api.getDensityLevel().catch(() => null);
      if (savedDensity) density = savedDensity as DensityLevel;
    } catch {
      // No ledger open — normal on first launch
    }
  }

  return {
    get path() {
      return path;
    },
    get isOpen() {
      return isOpen;
    },
    get isLoading() {
      return isLoading;
    },
    get error() {
      return error;
    },
    get accent() {
      return accent;
    },
    get density() {
      return density;
    },
    get isSample() {
      return isSample;
    },
    get pendingStartHere() {
      return pendingStartHere;
    },
    get corruptLedgerPath() {
      return corruptLedgerPath;
    },
    get formatMigration() {
      return formatMigration;
    },
    clearPendingStartHere() {
      pendingStartHere = false;
    },
    rebuildCorruptLedger,
    dismissCorruptLedger,
    migrateLedgerFormat,
    dismissFormatMigration,
    openLedger,
    adopt,
    exploreSample,
    closeLedger,
    checkExistingLedger,
    getRecentLedgers,
    setAccent,
    setDensity,
  };
}

export const ledger = createLedgerStore();
