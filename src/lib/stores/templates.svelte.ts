import { api } from "$lib/api";
import { createLedgerCollection } from "./ledger-collection.svelte";
import { compareNames } from "$lib/utils/file-name";
import type { TemplateEntry } from "$lib/types/ledger";

function createTemplatesStore() {
  // Templates live in `.grimoire/`, which the Ledger Watcher does not follow, so a
  // template added or edited outside Grimoire is only seen on a fresh read. Every
  // surface that lists them calls `load` as it opens rather than trusting this copy.
  const base = createLedgerCollection<TemplateEntry>({
    fetch: async () =>
      ((await api.listTemplates()) ?? []).sort((a, b) =>
        compareNames(a.display_name, b.display_name),
      ),
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
