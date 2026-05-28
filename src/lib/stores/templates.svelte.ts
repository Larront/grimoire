import { invoke } from "@tauri-apps/api/core";
import { ledger } from "./ledger.svelte";
import type { TemplateEntry } from "$lib/types/ledger";

function createTemplatesStore() {
  let templatesList = $state<TemplateEntry[]>([]);
  let isLoading = $state(false);

  async function load() {
    isLoading = true;
    try {
      templatesList = (await invoke<TemplateEntry[]>("list_templates")) ?? [];
    } catch (e) {
      console.error("list_templates failed:", e);
    } finally {
      isLoading = false;
    }
  }

  $effect.root(() => {
    $effect(() => {
      if (ledger.isOpen) {
        load();
      } else {
        templatesList = [];
      }
    });
  });

  return {
    get templates() {
      return templatesList;
    },
    get isLoading() {
      return isLoading;
    },
    load,
  };
}

export const templates = createTemplatesStore();
