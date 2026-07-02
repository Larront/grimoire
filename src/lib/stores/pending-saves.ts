/**
 * Registry of pending editor saves. Editors register a flush callback while
 * mounted; anything that tears the editing context down from the outside —
 * a ledger switch, the sample-world swap, window close — awaits `flushAll()`
 * first so the 500ms save debounce can never drop edits (issue #106).
 * Editor unmounts (tab close, note navigation) flush themselves in onDestroy.
 */
type Flush = () => Promise<void>;

const flushes = new Set<Flush>();

export const pendingSaves = {
  /** Register a flush callback; returns its unregister function. */
  register(flush: Flush): () => void {
    flushes.add(flush);
    return () => {
      flushes.delete(flush);
    };
  },

  /**
   * Flush every registered editor. Never rejects — a failed save already
   * logs/toasts through the command wrapper, and blocking a window close or
   * ledger switch forever on a broken save would trap the user.
   */
  async flushAll(): Promise<void> {
    await Promise.allSettled([...flushes].map((flush) => flush()));
  },
};
