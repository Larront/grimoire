// Details Source for note panes (see CONTEXT.md — "Details Source").
// Owns everything between the NoteDetails body and the backend: the fetch
// fan-out (tags, aliases, collisions, backlinks, outbound links, allTags),
// the refresh invariants ("alias save → re-check collisions", "any note save
// → reload backlinks via linksTick"), and the save-status machine rendered by
// the DetailPanel shell. The body never fetches; the pane never choreographs.
//
// Must be instantiated during component init (it registers $effects) — or
// inside $effect.root in tests.
import { invoke } from "@tauri-apps/api/core";
import { untrack } from "svelte";
import { notes } from "$lib/stores/notes.svelte";
import { linksTick } from "$lib/stores/links-tick.svelte";
import type { Note } from "$lib/types/ledger";
import type {
  AliasCollision,
  BacklinkNote,
  OutboundLink,
} from "$lib/components/NoteDetails.svelte";

export type SaveStatus = "idle" | "saved" | "error";

export function createNoteDetailsSource(getNote: () => Note | null) {
  let tags = $state<string[]>([]);
  let allTags = $state<string[]>([]);
  let aliases = $state<string[]>([]);
  let aliasCollisions = $state<AliasCollision[]>([]);
  let backlinks = $state<BacklinkNote[]>([]);
  let outboundLinks = $state<OutboundLink[]>([]);
  let tagsLoadError = $state(false);
  let aliasesLoadError = $state(false);
  let saveStatus = $state<SaveStatus>("idle");

  // Non-reactive: guards stale async responses when the note switches quickly.
  let loadedForPath: string | null = null;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFailedSave: (() => Promise<void>) | null = null;

  function loadLinks(noteId: number) {
    invoke<BacklinkNote[]>("get_backlinks", { noteId })
      .then((loaded) => { backlinks = loaded ?? []; })
      .catch(() => { backlinks = []; });
    invoke<OutboundLink[]>("get_outbound_links", { noteId })
      .then((loaded) => { outboundLinks = loaded ?? []; })
      .catch(() => { outboundLinks = []; });
  }

  async function refreshAllTags() {
    try { allTags = (await invoke<string[]>("list_all_tags")) ?? []; }
    catch { allTags = []; }
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
    const targetPath = n.path;
    const noteId = n.id;
    loadedForPath = targetPath;
    tagsLoadError = false;
    aliasesLoadError = false;
    aliasCollisions = [];
    saveStatus = "idle";
    invoke<string[]>("read_note_tags", { notePath: targetPath })
      .then((loaded) => { if (loadedForPath !== targetPath) return; tags = loaded; })
      .catch(() => { tags = []; tagsLoadError = true; });
    invoke<string[]>("get_note_aliases", { noteId })
      .then((loaded) => { if (loadedForPath !== targetPath) return; aliases = loaded ?? []; })
      .catch(() => { aliases = []; aliasesLoadError = true; });
    invoke<AliasCollision[]>("get_alias_collisions", { noteId })
      .then((cols) => { if (loadedForPath !== targetPath) return; aliasCollisions = cols ?? []; })
      .catch(() => { aliasCollisions = []; });
    loadLinks(noteId);
    refreshAllTags();
  });

  // Any successful note save (anywhere) may change this note's backlinks.
  $effect(() => {
    const tick = linksTick.value;
    if (tick === 0) return;
    const n = untrack(() => getNote());
    if (!n) return;
    loadLinks(n.id);
  });

  function beginSave() {
    if (statusTimer) clearTimeout(statusTimer);
    saveStatus = "idle";
  }

  function saveSucceeded() {
    lastFailedSave = null;
    saveStatus = "saved";
    statusTimer = setTimeout(() => { saveStatus = "idle"; }, 1500);
  }

  async function saveTags(next: string[]) {
    const n = untrack(() => getNote());
    if (!n) return;
    beginSave();
    try {
      await invoke("write_note_tags", { notePath: n.path, tags: next });
      notes.load();
      refreshAllTags();
      saveSucceeded();
    } catch {
      saveStatus = "error";
      lastFailedSave = () => saveTags(untrack(() => tags));
    }
  }

  async function saveAliases(next: string[]) {
    const n = untrack(() => getNote());
    if (!n) return;
    beginSave();
    try {
      await invoke("set_note_aliases", { noteId: n.id, aliases: next });
      // Invariant: an alias save can create or resolve collisions — re-check.
      const cols = await invoke<AliasCollision[]>("get_alias_collisions", { noteId: n.id });
      aliasCollisions = cols ?? [];
      saveSucceeded();
    } catch {
      saveStatus = "error";
      lastFailedSave = () => saveAliases(untrack(() => aliases));
    }
  }

  async function retrySave() {
    await lastFailedSave?.();
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
    get saveStatus() { return saveStatus; },
    saveTags,
    saveAliases,
    retrySave,
  };
}

export type NoteDetailsSource = ReturnType<typeof createNoteDetailsSource>;
