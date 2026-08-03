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

  /**
   * Which fetch is the current one. Switching ledgers starts a second read while
   * the first is still in flight, and without this the slower one wins and fills
   * the list with the ledger the GM just left.
   */
  let generation = 0;

  async function load() {
    const mine = ++generation;
    isLoading = true;
    error = null;
    try {
      const fetched = await fetch();
      if (mine !== generation) return;
      items = fetched;
    } catch (e) {
      if (mine !== generation) return;
      error = String(e);
    } finally {
      if (mine === generation) isLoading = false;
    }
  }

  $effect.root(() => {
    $effect(() => {
      // Keyed on the *path*, not on `isOpen`: opening a second ledger from inside
      // the first never lowers that flag, so a collection watching it would keep
      // serving the ledger the GM left — a whole sidebar of the wrong vault's
      // notes. The tabs store already keys on the path; this is the same rule.
      if (ledger.isOpen && ledger.path) {
        load();
      } else {
        generation++;
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
