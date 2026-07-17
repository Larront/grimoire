import { api } from "$lib/api";
import { createLedgerCollection } from "./ledger-collection.svelte";
import type { TemplateEntry } from "$lib/types/ledger";

function createTemplatesStore() {
  const base = createLedgerCollection<TemplateEntry>({
    fetch: async () => (await api.listTemplates()) ?? [],
  });

  return {
    get templates() {
      return base.items;
    },
    // Present for shape-consistency with the other ledger-backed lists; unused for now.
    get templateCount() {
      return base.count;
    },
    get isLoading() {
      return base.isLoading;
    },
    get error() {
      return base.error;
    },
    load: base.load,
  };
}

export const templates = createTemplatesStore();
