import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type AccentPreset =
  | "accent-crimson"
  | "accent-arcane"
  | "accent-verdant"
  | "accent-ice"
  | "accent-amber";

export type DensityLevel = "cozy" | "balanced" | "dense";

interface OpenVaultResult {
  path: string;
  note_count: number;
  scene_count: number;
  map_count: number;
}

export interface RecentVault {
  path: string;
  name: string;
  note_count: number;
  scene_count: number;
  map_count: number;
  last_opened: string;
}

function createVaultStore() {
  let path = $state<string | null>(null);
  let isOpen = $state(false);
  let isLoading = $state(false);
  let error = $state<string | null>(null);
  let accent = $state<AccentPreset>("accent-crimson");
  let density = $state<DensityLevel>("balanced");

  async function openVault(selectedPath?: string): Promise<boolean> {
    isLoading = true;
    error = null;

    try {
      const vaultPath =
        selectedPath ??
        (await open({
          directory: true,
          title: "Open Vault Folder",
        }));

      if (!vaultPath || typeof vaultPath !== "string") {
        isLoading = false;
        return false;
      }

      const result = await invoke<OpenVaultResult>("open_vault", {
        path: vaultPath,
      });

      path = result.path;
      isOpen = true;

      // Record in recent vaults (fire-and-forget).
      // Item counts in this entry are set at open time and refreshed on the next open_vault call.
      // In-session counts are derived reactively from notes.noteCount, scenes.sceneCount,
      // and maps.mapCount — these update immediately after store.load() calls in the sidebar.
      const name = result.path.split(/[\\/]/).pop() ?? "Untitled";
      invoke("add_recent_vault", {
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

  function setDensity(level: DensityLevel): void {
    density = level;
    invoke("save_density_level", { level }).catch(console.error);
  }

  function setAccent(preset: AccentPreset): void {
    accent = preset;
    invoke("save_accent_preset", { preset }).catch(console.error);
  }

  async function getRecentVaults(): Promise<RecentVault[]> {
    try {
      return (await invoke<RecentVault[]>("get_recent_vaults")) ?? [];
    } catch {
      return [];
    }
  }

  async function closeVault(): Promise<void> {
    try {
      await invoke("close_vault");
    } catch (e) {
      // Log but do not block frontend close — we still clear local state
      console.warn("[vault] close_vault command failed:", e);
    }
    path = null;
    isOpen = false;
    accent = "accent-crimson";
    density = "balanced";
    error = null;
  }

  async function checkExistingVault(): Promise<void> {
    try {
      const existingPath = await invoke<string | null>("get_vault_path");
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
      // No vault open — normal on first launch
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
    openVault,
    closeVault,
    checkExistingVault,
    getRecentVaults,
    setAccent,
    setDensity,
  };
}

export const vault = createVaultStore();
