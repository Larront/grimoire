// The save-status machine every [[Details Source]] reports through, and the one
// the `DetailPanel` shell renders as `Saved` / `Save failed · Retry`.
//
// It exists because all three sources need the identical shape — flash "saved"
// for a moment, hold "error" with a retry, and start clean on the next attempt —
// and hand-rolling it a third time was how the second copy already drifted from
// the first (#210).
//
// Two contracts a caller has to know:
//
//   * **`run` never rejects.** A failed attempt lands as `"error"` and nothing
//     more. Save paths are reached from bare `onblur` handlers that await them
//     and have nowhere to put a rejection (#203), so the machine is the end of
//     the line for a save's failure — the raw error is already logged by the
//     Command Wrapper's quiet surface.
//   * **`retry` replays the attempt that failed**, over the values that attempt
//     captured — not whatever the body holds now. A caller wanting the current
//     values calls `run` again with them, which supersedes the failed attempt.
//
// Must be created during component init (it registers an `$effect` for
// teardown) — which every Details Source already requires of itself.

export type SaveStatus = "idle" | "saved" | "error";

/** How long a successful save's "Saved" flash stays up before returning to idle. */
const SAVED_FLASH_MS = 1500;

export function createSaveStatus() {
  let status = $state<SaveStatus>("idle");

  // Non-reactive. `closed` is the teardown latch: the flash timer is cleared
  // below, but an attempt still in flight when the owner goes away would
  // otherwise resolve into `$state` nobody reads any more.
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastFailed: (() => Promise<void>) | null = null;
  let closed = false;

  $effect(() => () => {
    closed = true;
    clearFlash();
  });

  function clearFlash() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  /** Run a save attempt and report it. Resolves once the status has settled. */
  async function run(attempt: () => Promise<void>): Promise<void> {
    if (closed) return;
    clearFlash();
    status = "idle";
    try {
      await attempt();
      if (closed) return;
      lastFailed = null;
      status = "saved";
      timer = setTimeout(() => {
        status = "idle";
        timer = null;
      }, SAVED_FLASH_MS);
    } catch {
      if (closed) return;
      lastFailed = attempt;
      status = "error";
    }
  }

  /** Replay the attempt that failed. A no-op when nothing has failed. */
  async function retry(): Promise<void> {
    const attempt = lastFailed;
    if (!attempt) return;
    await run(attempt);
  }

  /** Forget everything — for a source whose selection moved to another entity. */
  function reset(): void {
    clearFlash();
    lastFailed = null;
    status = "idle";
  }

  return {
    get status() {
      return status;
    },
    run,
    retry,
    reset,
  };
}

export type SaveStatusMachine = ReturnType<typeof createSaveStatus>;
