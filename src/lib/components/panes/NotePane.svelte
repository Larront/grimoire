<script lang="ts">
  import { tick, untrack } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { notes } from "$lib/stores/notes.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { searchPalette } from "$lib/stores/search.svelte";
  import { appPrefs } from "$lib/stores/app-prefs.svelte";
  import { linksTick } from "$lib/stores/links-tick.svelte";
  import { toastSuccess } from "$lib/toast";
  import { LoaderCircle } from "@lucide/svelte";
  import { parseFrontmatter, serializeFrontmatter } from "$lib/utils";
  import Editor from "$lib/components/editor/Editor.svelte";
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import type { RightRailState } from "$lib/stores/right-rail.svelte";
  import DetailPanel from "$lib/components/DetailPanel.svelte";
  import NoteDetails from "$lib/components/NoteDetails.svelte";
  import type { AliasCollision, BacklinkNote, OutboundLink } from "$lib/components/NoteDetails.svelte";

  interface Props {
    noteId: number;
    rename?: boolean;
    pane: 'left' | 'right';
    tabIndex: number;
    rail?: RightRailState;
  }
  let { noteId, rename, pane, tabIndex, rail }: Props = $props();

  let note = $derived(notes.notes.find((n) => n.id === noteId) ?? null);

  // ── Content loading ──────────────────────────────────────────────────────
  let body = $state<string | null>(null);
  let lastMarkdown = $state<string | null>(null);
  let lastFetchedId = $state<number | null>(null);
  let highlightQuery = $state("");

  $effect(() => {
    if (note && note.id !== lastFetchedId) {
      const targetId = note.id;
      lastFetchedId = targetId;
      body = null;
      // Capture and consume the pending search query for scroll-to-match
      highlightQuery = searchPalette.activeQuery;
      searchPalette.activeQuery = "";
      invoke<string>("read_note_content", { notePath: note.path }).then((c) => {
        if (lastFetchedId !== targetId) return;
        const parsed = parseFrontmatter(c);
        body = parsed.body;
      });
    }
  });

  // ── Title editing ─────────────────────────────────────────────────────────
  let draftTitle = $state("");
  let titleInput: HTMLInputElement | undefined = $state();
  let isSavingTitle = $state(false);

  // ── Rename confirmation dialog ────────────────────────────────────────────
  let renameDialogOpen = $state(false);
  let pendingRenameNote: { title: string; path: string } | null = $state(null);
  let pendingBacklinkCount = $state(0);

  // Keep draftTitle in sync when navigating to a different note
  $effect(() => {
    if (note && !isSavingTitle) draftTitle = note.title;
  });

  // Keep tab title in sync when note title changes
  $effect(() => {
    if (note) {
      const title = note.title;
      untrack(() => tabs.updateTabTitle('note', noteId, title));
    }
  });

  function parentDir(path: string): string {
    const i = path.lastIndexOf("/");
    return i === -1 ? "" : path.slice(0, i);
  }

  async function commitTitle() {
    if (!note) return;
    const trimmed = draftTitle.trim();
    if (!trimmed || trimmed === note.title) {
      draftTitle = note.title; // reset in case of whitespace-only edit
      return;
    }
    const dir = parentDir(note.path);
    const newPath = dir ? `${dir}/${trimmed}.md` : `${trimmed}.md`;

    if (appPrefs.confirmRenameLinks) {
      let count = 0;
      try {
        count = await invoke<number>("get_note_backlink_count", { notePath: note.path });
      } catch {
        count = 0;
      }
      if (count > 0) {
        pendingRenameNote = { title: trimmed, path: newPath };
        pendingBacklinkCount = count;
        renameDialogOpen = true;
        return; // dialog will call handleRenameAndUpdate or handleRenameOnly
      }
    }

    await doRename(trimmed, newPath, true);
  }

  async function doRename(title: string, newPath: string, updateLinks: boolean) {
    if (!note) return;
    isSavingTitle = true;
    try {
      if (updateLinks) {
        const result = await invoke<{ note: unknown; updated_count: number }>("rename_note", {
          note: { ...note, title, path: newPath },
        });
        if (result.updated_count > 0) {
          const n = result.updated_count;
          toastSuccess(`${n} ${n === 1 ? "note" : "notes"} updated`);
        }
      } else {
        await invoke("update_note", {
          note: { ...note, title, path: newPath },
        });
      }
      await notes.load();
    } catch (e) {
      console.error("title save failed:", e);
      draftTitle = note.title;
    } finally {
      isSavingTitle = false;
    }
  }

  async function handleRenameAndUpdate() {
    renameDialogOpen = false;
    if (!pendingRenameNote) return;
    await doRename(pendingRenameNote.title, pendingRenameNote.path, true);
    pendingRenameNote = null;
  }

  async function handleRenameOnly() {
    renameDialogOpen = false;
    if (!pendingRenameNote) return;
    await doRename(pendingRenameNote.title, pendingRenameNote.path, false);
    pendingRenameNote = null;
  }

  function handleRenameCancel() {
    renameDialogOpen = false;
    pendingRenameNote = null;
    if (note) draftTitle = note.title;
  }

  function handleTitleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
    if (e.key === "Escape") {
      if (note) draftTitle = note.title;
      (e.target as HTMLInputElement).blur();
    }
  }

  // ── Auto-focus on rename ─────────────────────────────────────────────────
  $effect(() => {
    if (rename) {
      tick().then(() => {
        titleInput?.focus();
        titleInput?.select();
        tabs.clearRenameFlag(pane, tabIndex);
      });
    }
  });

  async function handleSave(markdown: string) {
    lastMarkdown = markdown;
    if (!note || isSavingTitle) return;
    try {
      await invoke("write_note_content", {
        notePath: note.path,
        content: markdown,
      });
      linksTick.bump();
    } catch (e) {
      console.error("content save failed:", e);
    }
  }

  // ── Detail panel state ───────────────────────────────────────────────────
  let detailTags = $state<string[]>([]);
  let detailAllTags = $state<string[]>([]);
  let detailLoadedForPath = $state<string | null>(null);
  let detailTagsLoadError = $state(false);
  let detailSaveStatus = $state<'idle' | 'saved' | 'error'>('idle');
  let detailSaveStatusTimer: ReturnType<typeof setTimeout> | null = null;
  let detailAliases = $state<string[]>([]);
  let detailAliasesLoadError = $state(false);
  let detailAliasCollisions = $state<AliasCollision[]>([]);
  let detailBacklinks = $state<BacklinkNote[]>([]);
  let detailOutboundLinks = $state<OutboundLink[]>([]);

  $effect(() => {
    const n = note;
    if (!n) {
      detailTags = [];
      detailAliases = [];
      detailAliasCollisions = [];
      detailBacklinks = [];
      detailOutboundLinks = [];
      detailLoadedForPath = null;
      detailTagsLoadError = false;
      detailAliasesLoadError = false;
      return;
    }
    if (n.path === detailLoadedForPath) return;
    const targetPath = n.path;
    const nId = n.id;
    detailLoadedForPath = targetPath;
    detailTagsLoadError = false;
    detailAliasesLoadError = false;
    detailAliasCollisions = [];
    detailSaveStatus = 'idle';
    invoke<string[]>('read_note_tags', { notePath: targetPath })
      .then((loaded) => { if (detailLoadedForPath !== targetPath) return; detailTags = loaded; })
      .catch(() => { detailTags = []; detailTagsLoadError = true; });
    invoke<string[]>('get_note_aliases', { noteId: nId })
      .then((loaded) => { if (detailLoadedForPath !== targetPath) return; detailAliases = loaded ?? []; })
      .catch(() => { detailAliases = []; detailAliasesLoadError = true; });
    invoke<AliasCollision[]>('get_alias_collisions', { noteId: nId })
      .then((cols) => { if (detailLoadedForPath !== targetPath) return; detailAliasCollisions = cols ?? []; })
      .catch(() => { detailAliasCollisions = []; });
    loadDetailLinks(nId);
    refreshDetailAllTags();
  });

  $effect(() => {
    const tick = linksTick.value;
    if (tick === 0) return;
    const n = untrack(() => note);
    if (!n) return;
    loadDetailLinks(n.id);
  });

  function loadDetailLinks(nId: number) {
    invoke<BacklinkNote[]>('get_backlinks', { noteId: nId })
      .then((loaded) => { detailBacklinks = loaded ?? []; })
      .catch(() => { detailBacklinks = []; });
    invoke<OutboundLink[]>('get_outbound_links', { noteId: nId })
      .then((loaded) => { detailOutboundLinks = loaded ?? []; })
      .catch(() => { detailOutboundLinks = []; });
  }

  async function refreshDetailAllTags() {
    try { detailAllTags = (await invoke<string[]>('list_all_tags')) ?? []; }
    catch { detailAllTags = []; }
  }

  async function handleTagsChange(next: string[]) {
    const n = note;
    if (!n) return;
    if (detailSaveStatusTimer) clearTimeout(detailSaveStatusTimer);
    detailSaveStatus = 'idle';
    try {
      await invoke('write_note_tags', { notePath: n.path, tags: next });
      notes.load();
      refreshDetailAllTags();
      detailSaveStatus = 'saved';
      detailSaveStatusTimer = setTimeout(() => { detailSaveStatus = 'idle'; }, 1500);
    } catch {
      detailSaveStatus = 'error';
    }
  }

  async function retryDetailSave() {
    await handleTagsChange(detailTags);
  }

  async function handleAliasesChange(next: string[]) {
    const n = note;
    if (!n) return;
    try {
      await invoke('set_note_aliases', { noteId: n.id, aliases: next });
      const cols = await invoke<AliasCollision[]>('get_alias_collisions', { noteId: n.id });
      detailAliasCollisions = cols ?? [];
    } catch { /* silent */ }
  }

  function navigateToNote(id: number, title: string) {
    tabs.openTab({ type: 'note', id, title });
  }
</script>

{#snippet detailPanel(onclose: () => void)}
  <DetailPanel title="Details" {onclose} saveStatus={detailSaveStatus} onRetrySave={retryDetailSave}>
    <NoteDetails
      {note}
      bind:tags={detailTags}
      allTags={detailAllTags}
      bind:aliases={detailAliases}
      aliasCollisions={detailAliasCollisions}
      backlinks={detailBacklinks}
      outboundLinks={detailOutboundLinks}
      tagsLoadError={detailTagsLoadError}
      aliasesLoadError={detailAliasesLoadError}
      onTagsChange={handleTagsChange}
      onAliasesChange={handleAliasesChange}
      onNavigateNote={navigateToNote}
    />
  </DetailPanel>
{/snippet}

<!-- ── Rename confirmation dialog ──────────────────────────────────────────── -->
<AlertDialog.Root bind:open={renameDialogOpen}>
  <AlertDialog.Portal>
    <AlertDialog.Overlay />
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>Update linked notes?</AlertDialog.Title>
        <AlertDialog.Description>
          {pendingBacklinkCount}
          {pendingBacklinkCount === 1 ? "note links" : "notes link"} to this note.
          Update their wikilinks to the new name?
        </AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel onclick={handleRenameCancel}>Cancel</AlertDialog.Cancel>
        <button
          type="button"
          data-testid="rename-only-btn"
          onclick={handleRenameOnly}
          class="inline-flex items-center justify-center rounded-md text-sm font-medium
                 border border-border bg-background hover:bg-accent hover:text-accent-foreground
                 h-9 px-4 py-2 transition-colors"
        >Rename only</button>
        <AlertDialog.Action onclick={handleRenameAndUpdate} data-testid="rename-update-btn">
          Rename + Update
        </AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>

<div class="flex flex-1 min-h-0">
  <!-- Note content area -->
  <div class="flex-1 min-w-0">
    {#if notes.isLoading}
      <div class="flex flex-1 items-center justify-center">
        <LoaderCircle class="size-5 animate-spin text-muted-foreground" />
      </div>
    {:else if !note}
      <div class="flex flex-1 items-center justify-center text-muted-foreground">
        Note not found
      </div>
    {:else}
      <!-- Single scroll container: title scrolls with the editor; scrollbar sits at pane edge.
           @container lets the inner content respond to the pane's own width, so split panes
           get tighter margins than the wide single-pane layout. -->
      <div
        data-note-scroll
        class="@container h-[calc(100svh_-_var(--tab-bar-h)_-_1px)] overflow-y-auto"
      >
        <div class="w-full mx-auto px-6 pt-10 pb-20 @5xl:max-w-[70%] @5xl:px-10">
          <input
            bind:this={titleInput}
            bind:value={draftTitle}
            class="w-full bg-transparent border-none outline-none p-0
                   font-heading text-4xl leading-tight tracking-tight
                   text-foreground placeholder:text-muted-foreground/40 focus:ring-0"
            placeholder="Untitled"
            onblur={commitTitle}
            onkeydown={handleTitleKeydown}
          />
          <div
            class="mt-3 mb-8 h-px bg-linear-to-r from-primary/25 to-transparent"
          ></div>
          {#if body !== null}
            <Editor initialContent={body} onSave={handleSave} {highlightQuery} />
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <!-- Docked detail panel (only on desktop when rail is provided and not mobile) -->
  {#if rail && !rail.isMobile}
    <aside
      data-slot="right-rail"
      data-mobile="false"
      data-state={rail.open ? 'open' : 'closed'}
      class="hidden w-0 shrink-0 overflow-hidden transition-[width] duration-200 ease-linear data-[state=open]:w-[300px] lg:flex lg:flex-col"
    >
      <div class="flex h-full w-[300px] flex-col border-l border-background-border bg-background-subtle">
        {@render detailPanel(rail.toggle)}
      </div>
    </aside>
  {/if}
</div>

<!-- Mobile sheet overlay (always present when rail is mobile, regardless of note load state) -->
{#if rail?.isMobile}
  <Sheet.Root
    bind:open={() => rail.openMobile, (v) => rail.setOpenMobile(v)}
  >
    <Sheet.Content
      side="right"
      data-slot="right-rail"
      data-mobile="true"
      class="w-[300px] p-0 [&>button]:hidden"
      showCloseButton={false}
    >
      <Sheet.Header class="sr-only">
        <Sheet.Title>Details panel</Sheet.Title>
        <Sheet.Description>Document metadata and details.</Sheet.Description>
      </Sheet.Header>
      {@render detailPanel(() => rail?.setOpenMobile(false))}
    </Sheet.Content>
  </Sheet.Root>
{/if}
