import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "svelte-sonner";
import { api } from "$lib/api";
import { toastImportFailures } from "$lib/toast";
import { pendingSaves } from "$lib/stores/pending-saves";

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
      const result = await api.openLedger(ledgerPath);
      applyOpenResult(result);
      return result;
    } catch (e) {
      if (String(e).includes("ERR_DB_CORRUPT")) {
        corruptLedgerPath = ledgerPath;
      }
      throw e;
    }
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
    api.silent.addRecentLedger({
      path: result.path,
      name,
      note_count: result.note_count,
      scene_count: result.scene_count,
      map_count: result.map_count,
      last_opened: new Date().toISOString(),
      missing: false,
    }).catch(() => {});
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
      error = String(e);
      throw e;
    } finally {
      isLoading = false;
    }
  }

  function dismissCorruptLedger(): void {
    corruptLedgerPath = null;
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
      const savedAccent = await api
        .getAccentPreset()
        .catch(() => null);
      if (savedAccent) accent = savedAccent as AccentPreset;
      const savedDensity = await api
        .getDensityLevel()
        .catch(() => null);
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
    clearPendingStartHere() {
      pendingStartHere = false;
    },
    rebuildCorruptLedger,
    dismissCorruptLedger,
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
