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
      // Keyed on the *open*, not on `isOpen` or the path. Opening a second ledger
      // from inside the first never lowers the flag, so a collection watching it
      // would keep serving the ledger the GM left. And re-exploring the Example
      // World reopens the same path over a reset database, so a collection
      // watching the path would keep serving rows that no longer exist.
      ledger.openGeneration;
      if (ledger.isOpen && ledger.path) {
        // Emptied first: until the new world's list lands, the old one's rows would
        // answer for it — a restored tab found the left world's note with its own id
        // and reported its file unreadable (2026-10 design review).
        items = [];
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
