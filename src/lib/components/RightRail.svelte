<script lang="ts">
  import { untrack } from 'svelte';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import type { RightRailState } from '$lib/stores/right-rail.svelte.js';
  import { invoke } from '@tauri-apps/api/core';
  import { tabs } from '$lib/stores/tabs.svelte';
  import { notes } from '$lib/stores/notes.svelte';
  import { linksTick } from '$lib/stores/links-tick.svelte';
  import TagChipEditor from './TagChipEditor.svelte';
  import AliasChipEditor from './AliasChipEditor.svelte';
  import { formatBreadcrumb, formatRelativeTime } from '$lib/utils/note-meta';
  import { PanelRight, Check, TriangleAlert } from '@lucide/svelte';

  const { rail, visible = false }: { rail: RightRailState; visible: boolean } = $props();

  $effect(() => {
    if (!visible) rail.setOpenMobile(false);
  });

  const activeNote = $derived.by(() => {
    const t = tabs.activeTab;
    if (!t || t.type !== 'note') return null;
    return notes.notes.find((n) => n.id === t.id) ?? null;
  });

  const isOpen = $derived(rail.open && visible);

  interface AliasCollision {
    alias: string;
    other_note_id: number;
    other_note_title: string;
  }

  interface BacklinkNote {
    id: number;
    path: string;
    title: string;
  }

  interface OutboundLink {
    target_path: string;
    resolved_id: number | null;
    resolved_title: string | null;
    resolved_path: string | null;
  }

  const LINK_CAP = 5;

  let tags = $state<string[]>([]);
  let allTags = $state<string[]>([]);
  let loadedForPath = $state<string | null>(null);
  let tagsLoadError = $state(false);
  let saveStatus = $state<'idle' | 'saved' | 'error'>('idle');
  let saveStatusTimer: ReturnType<typeof setTimeout> | null = null;

  let aliases = $state<string[]>([]);
  let aliasesLoadError = $state(false);
  let aliasCollisions = $state<AliasCollision[]>([]);

  let backlinks = $state<BacklinkNote[]>([]);
  let backlinksExpanded = $state(false);
  let linksLoadedForId = $state<number | null>(null);

  let outboundLinks = $state<OutboundLink[]>([]);
  let outboundExpanded = $state(false);

  const displayedBacklinks = $derived(backlinksExpanded ? backlinks : backlinks.slice(0, LINK_CAP));
  const hiddenBacklinksCount = $derived(backlinks.length - LINK_CAP);
  const displayedOutbound = $derived(outboundExpanded ? outboundLinks : outboundLinks.slice(0, LINK_CAP));
  const hiddenOutboundCount = $derived(outboundLinks.length - LINK_CAP);

  function folderLabel(path: string): string {
    const parts = path.split('/');
    parts.pop();
    return parts.join(' / ');
  }

  async function refreshAllTags() {
    try {
      allTags = (await invoke<string[]>('list_all_tags')) ?? [];
    } catch (e) {
      console.error('list_all_tags failed:', e);
      allTags = [];
    }
  }

  function loadLinks(noteId: number) {
    invoke<BacklinkNote[]>('get_backlinks', { noteId })
      .then((loaded) => { backlinks = loaded ?? []; })
      .catch(() => { backlinks = []; });
    invoke<OutboundLink[]>('get_outbound_links', { noteId })
      .then((loaded) => { outboundLinks = loaded ?? []; })
      .catch(() => { outboundLinks = []; });
  }

  $effect(() => {
    const note = activeNote;
    if (!note) {
      tags = [];
      aliases = [];
      aliasCollisions = [];
      backlinks = [];
      outboundLinks = [];
      loadedForPath = null;
      linksLoadedForId = null;
      tagsLoadError = false;
      aliasesLoadError = false;
      return;
    }
    if (note.path === loadedForPath) return;
    const targetPath = note.path;
    const noteId = note.id;
    loadedForPath = targetPath;
    tagsLoadError = false;
    aliasesLoadError = false;
    aliasCollisions = [];
    saveStatus = 'idle';
    // Reset expand state when switching notes
    if (noteId !== linksLoadedForId) {
      backlinksExpanded = false;
      outboundExpanded = false;
      linksLoadedForId = noteId;
    }
    invoke<string[]>('read_note_tags', { notePath: targetPath })
      .then((loaded) => {
        if (loadedForPath !== targetPath) return;
        tags = loaded;
      })
      .catch((e) => {
        console.error('read_note_tags failed:', e);
        tags = [];
        tagsLoadError = true;
      });
    invoke<string[]>('get_note_aliases', { noteId })
      .then((loaded) => {
        if (loadedForPath !== targetPath) return;
        aliases = loaded ?? [];
      })
      .catch((e) => {
        console.error('get_note_aliases failed:', e);
        aliases = [];
        aliasesLoadError = true;
      });
    invoke<AliasCollision[]>('get_alias_collisions', { noteId })
      .then((cols) => {
        if (loadedForPath !== targetPath) return;
        aliasCollisions = cols ?? [];
      })
      .catch(() => { aliasCollisions = []; });
    loadLinks(noteId);
    refreshAllTags();
  });

  // Reload links when NotePane saves content (outbound links may have changed).
  $effect(() => {
    const tick = linksTick.value;
    if (tick === 0) return; // skip initial mount — main effect handles it
    const note = untrack(() => activeNote);
    if (!note) return;
    loadLinks(note.id);
  });

  function navigateToNote(id: number, title: string) {
    tabs.openTab({ type: 'note', id, title });
  }

  async function persistTags(next: string[]) {
    const note = activeNote;
    if (!note) return;
    if (saveStatusTimer) clearTimeout(saveStatusTimer);
    saveStatus = 'idle';
    try {
      await invoke('write_note_tags', { notePath: note.path, tags: next });
      notes.load();
      refreshAllTags();
      saveStatus = 'saved';
      saveStatusTimer = setTimeout(() => { saveStatus = 'idle'; }, 1500);
    } catch (e) {
      console.error('write_note_tags failed:', e);
      saveStatus = 'error';
    }
  }

  async function retryTags() {
    await persistTags(tags);
  }

  async function persistAliases(next: string[]) {
    const note = activeNote;
    if (!note) return;
    try {
      await invoke('set_note_aliases', { noteId: note.id, aliases: next });
      const cols = await invoke<AliasCollision[]>('get_alias_collisions', { noteId: note.id });
      aliasCollisions = cols ?? [];
    } catch (e) {
      console.error('set_note_aliases failed:', e);
    }
  }
</script>

{#snippet railContent()}
  <div class="flex h-full flex-col">
    <div class="flex h-(--tab-bar-h) shrink-0 items-center gap-2 border-b border-sidebar-border px-(--pad-x)">
      <span class="text-(--font-body) font-medium text-foreground">Details</span>
      <button
        onclick={rail.toggle}
        class="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 ease-out hover:bg-accent hover:text-foreground"
        aria-label="Close details panel"
      >
        <PanelRight class="size-4" />
      </button>
    </div>
    <div class="flex-1 overflow-y-auto p-(--pad-x) text-(--font-body) text-muted-foreground">
      {#if activeNote}
        <section data-section="tags" class="space-y-2">
          <div class="flex items-center justify-between">
            <div class="font-mono text-[10.5px] uppercase tracking-[0.1em] text-foreground-faint">Tags</div>
            {#if saveStatus === 'saved'}
              <span class="flex items-center gap-1 font-mono text-[10px] text-success">
                <Check class="size-3" />Saved
              </span>
            {:else if saveStatus === 'error'}
              <button
                onclick={retryTags}
                class="font-mono text-[10px] text-error hover:underline"
              >Save failed · Retry</button>
            {/if}
          </div>
          {#if tagsLoadError}
            <p class="font-mono text-[10px] text-error">Tags unavailable</p>
          {:else}
            <TagChipEditor bind:tags suggestions={allTags} onchange={persistTags} />
            {#if tags.length === 0}
              <p class="font-mono text-[10px] text-foreground-faint">Enter to add · Backspace to remove</p>
            {/if}
          {/if}
        </section>
        <section data-section="aliases" class="space-y-2 border-t border-sidebar-border pt-3 mt-3">
          <div class="font-mono text-[10.5px] uppercase tracking-[0.1em] text-foreground-faint">Aliases</div>
          {#if aliasesLoadError}
            <p class="font-mono text-[10px] text-error">Aliases unavailable</p>
          {:else}
            <AliasChipEditor bind:aliases onchange={persistAliases} />
            {#if aliases.length === 0}
              <p class="font-mono text-[10px] text-foreground-faint">Enter or comma to add · Backspace to remove</p>
            {/if}
          {/if}
          {#each aliasCollisions as col (col.alias + col.other_note_id)}
            <p
              data-slot="alias-collision-warning"
              class="flex items-start gap-1 font-mono text-[10px] text-warning leading-[1.4]"
            >
              <TriangleAlert class="size-3 mt-px shrink-0" />
              <span>'{col.alias}' is also used by <span class="font-medium">{col.other_note_title}</span></span>
            </p>
          {/each}
        </section>
        <!-- ── Backlinks ──────────────────────────────────────────────── -->
        <section data-section="backlinks" class="space-y-1 border-t border-sidebar-border pt-3 mt-3">
          <div class="font-mono text-[10.5px] uppercase tracking-[0.1em] text-foreground-faint">Backlinks</div>
          {#if backlinks.length === 0}
            <p class="font-mono text-[10px] text-foreground-faint italic">No backlinks yet</p>
          {:else}
            <div class="space-y-0.5">
              {#each displayedBacklinks as link (link.id)}
                {@const folder = folderLabel(link.path)}
                <button
                  data-slot="backlink-row"
                  onclick={() => navigateToNote(link.id, link.title)}
                  class="w-full text-left rounded px-1 py-0.5 hover:bg-accent transition-colors duration-100"
                >
                  <div class="font-heading text-[11px] text-foreground leading-snug truncate">{link.title}</div>
                  {#if folder}
                    <div data-slot="link-folder" class="font-sans text-[10px] text-foreground-muted truncate">{folder}</div>
                  {/if}
                </button>
              {/each}
              {#if hiddenBacklinksCount > 0 && !backlinksExpanded}
                <button
                  data-slot="backlinks-expand"
                  onclick={() => { backlinksExpanded = true; }}
                  class="w-full text-left font-mono text-[10px] text-muted-foreground px-1 py-0.5 hover:text-foreground transition-colors duration-100"
                >Show {hiddenBacklinksCount} more</button>
              {/if}
            </div>
          {/if}
        </section>

        <!-- ── Outbound Links ─────────────────────────────────────────── -->
        <section data-section="outbound" class="space-y-1 border-t border-sidebar-border pt-3 mt-3">
          <div class="font-mono text-[10.5px] uppercase tracking-[0.1em] text-foreground-faint">Outbound Links</div>
          {#if outboundLinks.length === 0}
            <p class="font-mono text-[10px] text-foreground-faint italic">No outbound links</p>
          {:else}
            <div class="space-y-0.5">
              {#each displayedOutbound as link (link.target_path)}
                {#if link.resolved_id !== null}
                  {@const folder = link.resolved_path ? folderLabel(link.resolved_path) : ''}
                  <button
                    data-slot="outbound-row"
                    onclick={() => navigateToNote(link.resolved_id!, link.resolved_title!)}
                    class="w-full text-left rounded px-1 py-0.5 hover:bg-accent transition-colors duration-100"
                  >
                    <div class="font-heading text-[11px] text-foreground leading-snug truncate">{link.resolved_title}</div>
                    {#if folder}
                      <div data-slot="link-folder" class="font-sans text-[10px] text-foreground-muted truncate">{folder}</div>
                    {/if}
                  </button>
                {:else}
                  <div
                    data-slot="outbound-broken"
                    class="rounded px-1 py-0.5 opacity-50 cursor-default"
                  >
                    <div class="font-heading text-[11px] text-foreground leading-snug truncate">{link.target_path}</div>
                    <div class="font-mono text-[10px] text-foreground-faint italic">Not yet created</div>
                  </div>
                {/if}
              {/each}
              {#if hiddenOutboundCount > 0 && !outboundExpanded}
                <button
                  data-slot="outbound-expand"
                  onclick={() => { outboundExpanded = true; }}
                  class="w-full text-left font-mono text-[10px] text-muted-foreground px-1 py-0.5 hover:text-foreground transition-colors duration-100"
                >Show {hiddenOutboundCount} more</button>
              {/if}
            </div>
          {/if}
        </section>

        <section data-section="folder" class="space-y-1 border-t border-sidebar-border pt-3 mt-3">
          <div class="font-mono text-[10.5px] uppercase tracking-[0.1em] text-foreground-faint">Folder</div>
          <div
            class="font-mono text-[10px] leading-[1.4] text-muted-foreground truncate"
            title={activeNote.path}
          >
            {formatBreadcrumb(activeNote.path)}
          </div>
        </section>
        <section data-section="modified" class="space-y-1 border-t border-sidebar-border pt-3 mt-3">
          <div class="font-mono text-[10.5px] uppercase tracking-[0.1em] text-foreground-faint">Modified</div>
          <div class="font-mono text-[10px] leading-[1.4] text-muted-foreground">
            {formatRelativeTime(activeNote.modified_at)}
          </div>
        </section>
      {/if}
    </div>
  </div>
{/snippet}

{#if rail.isMobile}
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
      {@render railContent()}
    </Sheet.Content>
  </Sheet.Root>
{:else}
  <aside
    data-slot="right-rail"
    data-mobile="false"
    data-state={isOpen ? 'open' : 'closed'}
    class="hidden w-0 shrink-0 overflow-hidden transition-[width] duration-200 ease-linear data-[state=open]:w-[300px] lg:flex lg:flex-col"
  >
    <div class="flex h-full w-[300px] flex-col border-l border-sidebar-border bg-sidebar">
      {@render railContent()}
    </div>
  </aside>
{/if}
