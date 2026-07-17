import { ledger } from "./ledger.svelte";

interface LedgerCollectionOptions<T> {
  /** Fetches the full list. Called once each time the ledger opens (and on demand
   *  via `load`). Errors are caught into `error`. */
  fetch: () => Promise<T[]>;
  /** Extra cleanup to run when the ledger closes, after the list is emptied —
   *  e.g. clearing a per-item cache. */
  onClose?: () => void;
}

/**
 * The shared lifecycle for a ledger-backed list: fetch when a ledger opens, clear
 * when it closes. Returns the standard kit — `items`, `isLoading`, `error`,
 * `count`, `load` — that the notes / maps / templates / scenes stores compose and
 * re-expose under their own names.
 */
export function createLedgerCollection<T>({ fetch, onClose }: LedgerCollectionOptions<T>) {
  let items = $state<T[]>([]);
  let isLoading = $state(false);
  let error = $state<string | null>(null);

  async function load() {
    isLoading = true;
    error = null;
    try {
      items = await fetch();
    } catch (e) {
      error = String(e);
    } finally {
      isLoading = false;
    }
  }

  $effect.root(() => {
    $effect(() => {
      if (ledger.isOpen) {
        load();
      } else {
        items = [];
        error = null;
        onClose?.();
      }
    });
  });

  return {
    get items() {
      return items;
    },
    get count() {
      return items.length;
    },
    get isLoading() {
      return isLoading;
    },
    get error() {
      return error;
    },
    /** Surface an error from a layered method (e.g. an on-demand read that isn't
     *  the list fetch). Clears on the next `load` or ledger close. */
    setError(message: string | null) {
      error = message;
    },
    load,
  };
}
