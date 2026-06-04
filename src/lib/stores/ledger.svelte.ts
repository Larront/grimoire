import { open } from "@tauri-apps/plugin-dialog";
import { api } from "$lib/api";
import { toastImportFailures } from "$lib/toast";

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
}

export interface RecentLedger {
  path: string;
  name: string;
  note_count: number;
  scene_count: number;
  map_count: number;
  last_opened: string;
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

  /** Invokes open_ledger, updates store state, and surfaces failed imports. */
  async function openAtPath(ledgerPath: string): Promise<OpenLedgerResult> {
    const result = await api.openLedger(ledgerPath);

    path = result.path;
    isOpen = true;

    if (result.failed_imports.length > 0) {
      failedImportsModal.failures = result.failed_imports;
      toastImportFailures(result.failed_imports, () => {
        failedImportsModal.open = true;
      });
    }

    return result;
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

      // Record in recent ledgers (fire-and-forget).
      // Item counts in this entry are set at open time and refreshed on the next open_ledger call.
      // In-session counts are derived reactively from notes.noteCount, scenes.sceneCount,
      // and maps.mapCount — these update immediately after store.load() calls in the sidebar.
      const name = result.path.split(/[\\/]/).pop() ?? "Untitled";
      api.addRecentLedger({
        path: result.path,
        name,
        note_count: result.note_count,
        scene_count: result.scene_count,
        map_count: result.map_count,
        last_opened: new Date().toISOString(),
      }).catch(console.error);

      return true;
    } catch (e) {
      error = String(e);
      throw e;
    } finally {
      isLoading = false;
    }
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
    api.saveDensityLevel(level).catch(console.error);
  }

  function setAccent(preset: AccentPreset): void {
    accent = preset;
    api.saveAccentPreset(preset).catch(console.error);
  }

  async function getRecentLedgers(): Promise<RecentLedger[]> {
    try {
      return (await api.getRecentLedgers()) ?? [];
    } catch {
      return [];
    }
  }

  async function closeLedger(): Promise<void> {
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
    clearPendingStartHere() {
      pendingStartHere = false;
    },
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
