// The [[Ledger Watcher]]'s frontend event contract (ADR-0013). The backend emits
// every one of these from one place in Rust (`ledger_watch.rs`); this is the one
// place the frontend spells them, and the one place that says what each means.
//
// Before this module the names lived as loose strings in two components with
// different overlapping subsets, which is why a [[Details Source]] could not
// subscribe to `ledger:rebuilt` itself and had to have `NotePane` relay it —
// a pane choreographing, which CONTEXT.md says panes do not do (#212).
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { UnlinkedPin } from "$lib/stores/ledger.svelte";

/** Every Ledger Watcher event, mapped to the payload it carries. */
export interface LedgerEvents {
  /** A note's file was rewritten on disk outside Grimoire. Its row and derived
   *  indexes are already reconciled; an open buffer decides its own policy. */
  "note:content-changed": { path: string };
  /** A note's file was deleted outside Grimoire and its row is gone. */
  "note:removed": { path: string };
  /** A note's file moved outside Grimoire. The row was re-keyed in place, so
   *  the note keeps its id — open panes follow it rather than losing it. */
  "note:moved": { from: string; to: string };
  /** The set of notes on disk changed (created, removed, renamed): the Files
   *  tree is stale. Carries no payload — the tree is rebuilt wholesale. */
  "ledger:tree-changed": null;
  /** A bulk external change (git checkout, cloud sync) exceeded the per-file
   *  threshold, so the backend rebuilt the whole ledger under one coarse event.
   *  Anything derived from the ledger should refetch wholesale. */
  "ledger:rebuilt": null;
  /** A rebuild re-created note rows, costing them their ids and unlinking every
   *  pin that held one (#224). Rides alongside `ledger:rebuilt` rather than in
   *  its payload — mid-session there is no command result to report through. */
  "pins:unlinked": UnlinkedPin[];
  /** An external move left other notes holding wikilinks to the old path. Only
   *  emitted when the count is non-zero, so a subscriber offering the heal fires
   *  only when there is something to heal. The count is display-only —
   *  `applyBacklinkRewrite` recomputes the real set (ADR-0014). */
  "note:external-move-links-stale": { from: string; to: string; count: number };
}

export type LedgerEventName = keyof LedgerEvents;

type LedgerEventHandlers = {
  [K in LedgerEventName]?: (payload: LedgerEvents[K]) => void;
};

/**
 * Subscribe to Ledger Watcher events.
 *
 * Returns an unsubscribe function fit for an `onMount` return or an `$effect`
 * teardown. It is safe to call before Tauri's `listen` promises have resolved —
 * the listeners are detached as soon as they exist, which the hand-rolled
 * `Promise.all(...).then(fns => fns.forEach(fn => fn()))` at each old call site
 * only did if teardown happened to lose the race.
 *
 * A no-op outside Tauri (`bun run dev`, jsdom tests), so callers no longer
 * repeat the `__TAURI_INTERNALS__` guard.
 */
export function onLedgerEvents(handlers: LedgerEventHandlers): () => void {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return () => {};
  }

  let stopped = false;
  const stops: UnlistenFn[] = [];

  for (const [name, handler] of Object.entries(handlers)) {
    if (!handler) continue;
    const forward = handler as (payload: unknown) => void;
    void listen(name, (event) => forward(event.payload)).then((stop) => {
      if (stopped) stop();
      else stops.push(stop);
    });
  }

  return () => {
    stopped = true;
    stops.forEach((stop) => stop());
    stops.length = 0;
  };
}
