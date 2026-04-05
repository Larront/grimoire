import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

function createVaultStore() {
  let path = $state<string | null>(null);
  let isOpen = $state(false);
  let isLoading = $state(false);
  let error = $state<string | null>(null);

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

      await invoke("open_vault", { path: vaultPath });
      path = vaultPath;
      isOpen = true;
      return true;
    } catch (e) {
      error = String(e);
      console.log(error);
      return false;
    } finally {
      isLoading = false;
    }
  }

  async function closeVault(): Promise<void> {
    path = null;
    isOpen = false;
    error = null;
  }

  async function checkExistingVault(): Promise<void> {
    try {
      const existingPath = await invoke<string | null>("get_vault_path");
      if (existingPath) {
        path = existingPath;
        isOpen = true;
      }
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
    openVault,
    closeVault,
    checkExistingVault,
  };
}

export const vault = createVaultStore();
