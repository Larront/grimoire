<script lang="ts">
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import type { RightRailState } from '$lib/stores/right-rail.svelte.js';
  import { invoke } from '@tauri-apps/api/core';
  import { tabs } from '$lib/stores/tabs.svelte';
  import { notes } from '$lib/stores/notes.svelte';
  import TagChipEditor from './TagChipEditor.svelte';
  import { formatBreadcrumb, formatRelativeTime } from '$lib/utils/note-meta';
  import { PanelRight, Check } from '@lucide/svelte';

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

  let tags = $state<string[]>([]);
  let allTags = $state<string[]>([]);
  let loadedForPath = $state<string | null>(null);
  let tagsLoadError = $state(false);
  let saveStatus = $state<'idle' | 'saved' | 'error'>('idle');
  let saveStatusTimer: ReturnType<typeof setTimeout> | null = null;

  async function refreshAllTags() {
    try {
      allTags = (await invoke<string[]>('list_all_tags')) ?? [];
    } catch (e) {
      console.error('list_all_tags failed:', e);
      allTags = [];
    }
  }

  $effect(() => {
    const note = activeNote;
    if (!note) {
      tags = [];
      loadedForPath = null;
      tagsLoadError = false;
      return;
    }
    if (note.path === loadedForPath) return;
    const targetPath = note.path;
    loadedForPath = targetPath;
    tagsLoadError = false;
    saveStatus = 'idle';
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
    refreshAllTags();
  });

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
