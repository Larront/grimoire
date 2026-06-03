import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
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

      const result = await invoke<OpenLedgerResult>("open_ledger", {
        path: ledgerPath,
      });

      path = result.path;
      isOpen = true;

      if (result.failed_imports.length > 0) {
        failedImportsModal.failures = result.failed_imports;
        toastImportFailures(result.failed_imports, () => {
          failedImportsModal.open = true;
        });
      }

      // Record in recent ledgers (fire-and-forget).
      // Item counts in this entry are set at open time and refreshed on the next open_ledger call.
      // In-session counts are derived reactively from notes.noteCount, scenes.sceneCount,
      // and maps.mapCount — these update immediately after store.load() calls in the sidebar.
      const name = result.path.split(/[\\/]/).pop() ?? "Untitled";
      invoke("add_recent_ledger", {
        entry: {
          path: result.path,
          name,
          note_count: result.note_count,
          scene_count: result.scene_count,
          map_count: result.map_count,
          last_opened: new Date().toISOString(),
        },
      }).catch(console.error);

      return true;
    } catch (e) {
      error = String(e);
      console.log(error);
      return false;
    } finally {
      isLoading = false;
    }
  }

  async function exploreSample(): Promise<boolean> {
    isLoading = true;
    error = null;
    try {
      const sandboxPath = await invoke<string>("explore_sample_ledger");
      const result = await invoke<OpenLedgerResult>("open_ledger", {
        path: sandboxPath,
      });
      path = result.path;
      isOpen = true;
      isSample = true;
      if (result.failed_imports.length > 0) {
        failedImportsModal.failures = result.failed_imports;
        toastImportFailures(result.failed_imports, () => {
          failedImportsModal.open = true;
        });
      }
      return true;
    } catch (e) {
      error = String(e);
      return false;
    } finally {
      isLoading = false;
    }
  }

  function setDensity(level: DensityLevel): void {
    density = level;
    invoke("save_density_level", { level }).catch(console.error);
  }

  function setAccent(preset: AccentPreset): void {
    accent = preset;
    invoke("save_accent_preset", { preset }).catch(console.error);
  }

  async function getRecentLedgers(): Promise<RecentLedger[]> {
    try {
      return (await invoke<RecentLedger[]>("get_recent_ledgers")) ?? [];
    } catch {
      return [];
    }
  }

  async function closeLedger(): Promise<void> {
    try {
      await invoke("close_ledger");
    } catch (e) {
      // Log but do not block frontend close — we still clear local state
      console.warn("[ledger] close_ledger command failed:", e);
    }
    path = null;
    isOpen = false;
    isSample = false;
    accent = "accent-crimson";
    density = "balanced";
    error = null;
  }

  async function checkExistingLedger(): Promise<void> {
    try {
      const existingPath = await invoke<string | null>("get_ledger_path");
      if (existingPath) {
        path = existingPath;
        isOpen = true;
      }
      const savedAccent = await invoke<AccentPreset | null>(
        "get_accent_preset",
      ).catch(() => null);
      if (savedAccent) accent = savedAccent;
      const savedDensity = await invoke<DensityLevel | null>(
        "get_density_level",
      ).catch(() => null);
      if (savedDensity) density = savedDensity;
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
    openLedger,
    exploreSample,
    closeLedger,
    checkExistingLedger,
    getRecentLedgers,
    setAccent,
    setDensity,
  };
}

export const ledger = createLedgerStore();
