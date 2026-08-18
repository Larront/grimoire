// Details Source for note panes (see CONTEXT.md — "Details Source").
// Owns everything between the NoteDetails body and the backend: the fetch
// fan-out (tags, aliases, collisions, backlinks, outbound links, allTags),
// the refresh invariants ("alias save → re-check collisions", "any note save
// → reload backlinks via linksTick", "a bulk external rebuild → refetch"), and
// the save-status machine rendered by the DetailPanel shell. The body never
// fetches; the pane never choreographs.
//
// Must be instantiated during component init (it registers $effects) — or
// inside $effect.root in tests.
import { api } from "$lib/api";
import { untrack } from "svelte";
import { notes } from "$lib/stores/notes.svelte";
import { linksTick } from "$lib/stores/links-tick.svelte";
import { onLedgerEvents } from "$lib/ledger/events";
import { createSaveStatus } from "./save-status.svelte";
import { staleGuard } from "./stale-guard";
import type { Note } from "$lib/types/ledger";
import type {
  AliasCollision,
  BacklinkNote,
  OutboundLink,
} from "$lib/components/NoteDetails.svelte";

export type { SaveStatus } from "./save-status.svelte";

export function createNoteDetailsSource(getNote: () => Note | null) {
  let tags = $state<string[]>([]);
  let allTags = $state<string[]>([]);
  let aliases = $state<string[]>([]);
  let aliasCollisions = $state<AliasCollision[]>([]);
  let backlinks = $state<BacklinkNote[]>([]);
  let outboundLinks = $state<OutboundLink[]>([]);
  let tagsLoadError = $state(false);
  let aliasesLoadError = $state(false);

  const saves = createSaveStatus();

  // Non-reactive: guards stale async responses when the note switches quickly.
  let loadedForPath: string | null = null;

  /** This source's key is the note path — see `stale-guard.ts` for why. */
  const guardOn = (targetPath: string) => staleGuard(targetPath, () => loadedForPath);

  // Keyed like the rest of the fan-out: reached both from `loadAll` and from
  // the linksTick effect, and in either case A's links must not land on B.
  function loadLinks(n: Note) {
    const whenCurrent = guardOn(n.path);
    const noteId = n.id;
    api.silent.getBacklinks(noteId)
      .then((loaded) => whenCurrent(() => { backlinks = loaded ?? []; }))
      .catch(() => whenCurrent(() => { backlinks = []; }));
    api.silent.getOutboundLinks(noteId)
      .then((loaded) => whenCurrent(() => { outboundLinks = loaded ?? []; }))
      .catch(() => whenCurrent(() => { outboundLinks = []; }));
  }

  async function refreshAllTags() {
    try { allTags = (await api.silent.listAllTags()) ?? []; }
    catch { allTags = []; }
  }

  // Fetch the whole fan-out for `n`. Split out from the note-change $effect so a
  // wholesale refetch (bulk external rebuild — ledger:rebuilt) can rerun it for
  // the *current* note, whose path is unchanged and so wouldn't retrigger below.
  function loadAll(n: Note) {
    const targetPath = n.path;
    const noteId = n.id;
    loadedForPath = targetPath;
    tagsLoadError = false;
    aliasesLoadError = false;
    aliasCollisions = [];
    saves.reset();
    const whenCurrent = guardOn(targetPath);
    api.silent.readNoteTags(targetPath)
      .then((loaded) => whenCurrent(() => { tags = loaded; }))
      .catch(() => whenCurrent(() => { tags = []; tagsLoadError = true; }));
    api.silent.getNoteAliases(noteId)
      .then((loaded) => whenCurrent(() => { aliases = loaded ?? []; }))
      .catch(() => whenCurrent(() => { aliases = []; aliasesLoadError = true; }));
    api.silent.getAliasCollisions(noteId)
      .then((cols) => whenCurrent(() => { aliasCollisions = cols ?? []; }))
      .catch(() => whenCurrent(() => { aliasCollisions = []; }));
    loadLinks(n);
    refreshAllTags();
  }

  // Reload the fan-out whenever the note (keyed by path) changes.
  $effect(() => {
    const n = getNote();
    if (!n) {
      tags = [];
      aliases = [];
      aliasCollisions = [];
      backlinks = [];
      outboundLinks = [];
      loadedForPath = null;
      tagsLoadError = false;
      aliasesLoadError = false;
      return;
    }
    if (n.path === loadedForPath) return;
    loadAll(n);
  });

  // Any successful note write (anywhere) may change this note's backlinks. The
  // bump is the Command Wrapper's, not a caller's — see links-tick.svelte.ts.
  $effect(() => {
    const tick = linksTick.value;
    if (tick === 0) return;
    const n = untrack(() => getNote());
    if (!n) return;
    loadLinks(n);
  });

  // A bulk external change rebuilt the ledger under this note's feet. Its path
  // is unchanged, so the effect above won't refire — subscribe to the Ledger
  // Watcher directly rather than waiting for a pane to relay it (#212).
  $effect(() => onLedgerEvents({ "ledger:rebuilt": () => reload() }));

  async function saveTags(next: string[]) {
    const n = untrack(() => getNote());
    if (!n) return;
    await saves.run(async () => {
      await api.silent.writeNoteTags(n.path, next);
      notes.load();
      refreshAllTags();
    });
  }

  async function saveAliases(next: string[]) {
    const n = untrack(() => getNote());
    if (!n) return;
    await saves.run(async () => {
      await api.silent.setNoteAliases(n.id, next);
      // Invariant: an alias save can create or resolve collisions — re-check.
      const cols = await api.silent.getAliasCollisions(n.id);
      aliasCollisions = cols ?? [];
    });
  }

  // Force a wholesale refetch of the current note's details, for the
  // ledger:rebuilt subscription above: the note's own path didn't change, so
  // the path-keyed $effect wouldn't otherwise refire. Internal — a pane used to
  // have to call this, which is the relaying #212 removed.
  function reload() {
    const n = untrack(() => getNote());
    if (n) loadAll(n);
  }

  return {
    get tags() { return tags; },
    set tags(v: string[]) { tags = v; },
    get aliases() { return aliases; },
    set aliases(v: string[]) { aliases = v; },
    get allTags() { return allTags; },
    get aliasCollisions() { return aliasCollisions; },
    get backlinks() { return backlinks; },
    get outboundLinks() { return outboundLinks; },
    get tagsLoadError() { return tagsLoadError; },
    get aliasesLoadError() { return aliasesLoadError; },
    get saveStatus() { return saves.status; },
    saveTags,
    saveAliases,
    retrySave: saves.retry,
  };
}

export type NoteDetailsSource = ReturnType<typeof createNoteDetailsSource>;
