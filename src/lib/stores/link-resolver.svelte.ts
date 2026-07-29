// The Link Resolver (see CONTEXT.md) — the single shared answer to "does this
// wikilink target resolve?". The rule is: the target matches a note's `path`, else
// it resolves through a Note Alias lookup; anything else is a Stub Note. That rule
// was written three times (the broken-link decoration, the click handler, and the
// timeline block's own resolution map) and is written once here.
//
// A **ledger-level** service, deliberately not note-block machinery: two of its
// three callers are plain-editor code and know nothing about blocks. It imports
// only the notes store and the Command Wrapper.
//
// It exposes **two entry points over one rule**, and the asymmetry is load-bearing:
//
//   isKnown(target)  — a cached synchronous read, for *drawing* a link. The last
//                      known answer, defaulting to **known**, so a real link never
//                      flashes as a faded stub while a check is in flight. Pure:
//                      it asks nothing and waits for nothing. `prime` fills it.
//   resolve(target)  — an authoritative asynchronous check, before *acting* on a
//                      link. The acting path chooses between navigating and
//                      creating a file on disk, so a stale cached answer here
//                      would write a note the GM never asked for. It costs
//                      nothing: the click handler already awaits the backend.
//
// One cache for the whole app, invalidated **wholesale** whenever the notes store
// changes — a create or a rename can turn a broken link live, and dropping the lot
// is both cheaper and harder to get wrong than any per-entry rule. Invalidation is
// detected by list identity rather than by a `$effect` on purpose: an effect would
// race its own consumers (a consumer priming in the same flush could have its
// answers cleared out from under it, and nothing would re-prime).

import { api } from "$lib/api";
import { notes } from "./notes.svelte";
import { stripWikiFragment } from "$lib/editor/wiki-target";
import { SvelteMap } from "svelte/reactivity";

/** What a resolved target is: enough to navigate to it. */
export interface ResolvedNote {
  id: number;
  title: string;
  path: string;
}

function createLinkResolver() {
  // Reactive so a surface drawing links with `isKnown` repaints when an answer
  // lands. Keyed by fragment-stripped target: [[A#one]] and [[A#two]] are the
  // same question.
  const known = new SvelteMap<string, boolean>();
  // The notes list this cache's answers were computed against, and a counter
  // bumped each time we drop them. A prime that started before an invalidation
  // discards its results rather than writing answers about a vanished world.
  let cachedAgainst: unknown = null;
  let generation = 0;

  /** Drop every cached answer if the notes store has moved on since we last looked. */
  function syncToNotes(): void {
    const list = notes.notes;
    if (list === cachedAgainst) return;
    cachedAgainst = list;
    known.clear();
    generation++;
  }

  function pathMatch(target: string): ResolvedNote | null {
    const note = notes.notes.find((n) => n.path === target);
    return note ? { id: note.id, title: note.title, path: note.path } : null;
  }

  /**
   * The last known answer for a target, for *drawing* it. Defaults to **known**,
   * so a link whose check hasn't landed yet renders as a real link rather than
   * briefly as a faded, unclickable stub. Synchronous and side-effect-free.
   */
  function isKnown(target: string): boolean {
    return known.get(stripWikiFragment(target)) ?? true;
  }

  /**
   * A fresh, authoritative check, for *acting* on a target: returns the note it
   * resolves to, or `null` if it resolves to nothing and acting means creating it.
   * Never consults the cache — it feeds it. Rethrows on backend failure so the
   * caller aborts; a failed check must not read as "missing" and create a file.
   *
   * `silent` routes through `api.silent` for background lookups that own their own
   * error handling (the hover preview), per ADR-0010.
   */
  async function resolve(
    target: string,
    { silent = false }: { silent?: boolean } = {},
  ): Promise<ResolvedNote | null> {
    syncToNotes();
    const stripped = stripWikiFragment(target);

    const direct = pathMatch(stripped);
    if (direct) {
      known.set(stripped, true);
      return direct;
    }

    const gen = generation;
    const resolved = await (silent ? api.silent : api).resolveNoteTarget(stripped);
    if (generation === gen) known.set(stripped, resolved != null);
    return resolved;
  }

  /**
   * Warm the cache for the targets a surface is about to draw, so `isKnown` can
   * answer for them. Call it from an effect that reads `notes.notes`, so a create
   * or rename re-primes and a previously-broken link goes live without a reload.
   *
   * Fire-and-forget: a target whose lookup fails is left unanswered, and so keeps
   * the default (known) rather than being libelled as broken.
   */
  async function prime(targets: Iterable<string>): Promise<void> {
    syncToNotes();
    const gen = generation;

    for (const raw of targets) {
      const stripped = stripWikiFragment(raw);
      if (known.has(stripped)) continue;
      if (pathMatch(stripped)) {
        known.set(stripped, true);
        continue;
      }
      let answer: boolean;
      try {
        answer = (await api.silent.resolveNoteTarget(stripped)) != null;
      } catch {
        continue; // no ledger open, or the lookup failed — leave it at its default
      }
      // A newer generation owns the cache now; our answers describe a stale world.
      if (generation !== gen) return;
      known.set(stripped, answer);
    }
  }

  return { isKnown, resolve, prime };
}

export const linkResolver = createLinkResolver();
