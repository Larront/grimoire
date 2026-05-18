<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { Search, Tag, FileText, Map, Clapperboard } from "@lucide/svelte";
  import * as Command from "$lib/components/ui/command";
  import * as Dialog from "$lib/components/ui/dialog";
  import TagChipEditor from "./TagChipEditor.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { searchPalette } from "$lib/stores/search.svelte";

  interface NoteSearchResult {
    id: number;
    title: string;
    path: string;
    excerpt: string | null;
    match_count: number;
  }

  interface MapSearchResult {
    id: number;
    title: string;
  }

  interface SceneSearchResult {
    id: number;
    name: string;
  }

  interface SearchAllResult {
    notes: NoteSearchResult[];
    maps: MapSearchResult[];
    scenes: SceneSearchResult[];
  }

  let addTagOpen = $state(false);
  let tags = $state<string[]>([]);
  let allTags = $state<string[]>([]);
  let loadedForPath = $state<string | null>(null);
  let searchQuery = $state("");
  let noteResults = $state<NoteSearchResult[]>([]);
  let mapResults = $state<MapSearchResult[]>([]);
  let sceneResults = $state<SceneSearchResult[]>([]);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const isMac = $derived(
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform),
  );

  const activeTabIsNote = $derived(tabs.activeTab?.type === "note");

  const activeNote = $derived.by(() => {
    const t = tabs.activeTab;
    if (!t || t.type !== "note") return null;
    return notes.notes.find((n) => n.id === t.id) ?? null;
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "k" && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      searchPalette.open = true;
    }
  }

  function openAddTag() {
    searchPalette.open = false;
    addTagOpen = true;
  }

  function openNote(result: NoteSearchResult) {
    searchPalette.activeQuery = searchQuery;
    searchPalette.open = false;
    tabs.openTab({ type: "note", id: result.id, title: result.title });
  }

  function openMap(result: MapSearchResult) {
    searchPalette.open = false;
    tabs.openTab({ type: "map", id: result.id, title: result.title });
  }

  function openScene(result: SceneSearchResult) {
    searchPalette.open = false;
    tabs.openTab({ type: "scene", id: result.id, title: result.name });
  }

  function splitExcerpt(
    text: string,
    query: string,
  ): Array<{ text: string; isMatch: boolean }> {
    const terms = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    if (!terms.length) return [{ text, isMatch: false }];

    const lower = text.toLowerCase();
    let firstMatch: { start: number; end: number } | null = null;
    for (const term of terms) {
      const idx = lower.indexOf(term);
      if (idx !== -1 && (!firstMatch || idx < firstMatch.start)) {
        firstMatch = { start: idx, end: idx + term.length };
      }
    }

    if (!firstMatch) return [{ text, isMatch: false }];

    return [
      { text: text.slice(0, firstMatch.start), isMatch: false },
      { text: text.slice(firstMatch.start, firstMatch.end), isMatch: true },
      { text: text.slice(firstMatch.end), isMatch: false },
    ].filter((p) => p.text.length > 0);
  }

  $effect(() => {
    const q = searchQuery;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (q.length < 2) {
      noteResults = [];
      mapResults = [];
      sceneResults = [];
      return;
    }
    debounceTimer = setTimeout(async () => {
      try {
        const res = await invoke<SearchAllResult>("search_all", { query: q });
        noteResults = res?.notes ?? [];
        mapResults = res?.maps ?? [];
        sceneResults = res?.scenes ?? [];
      } catch {
        noteResults = [];
        mapResults = [];
        sceneResults = [];
      }
    }, 80);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  });

  $effect(() => {
    if (!searchPalette.open) {
      searchQuery = "";
      noteResults = [];
      mapResults = [];
      sceneResults = [];
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    }
  });

  $effect(() => {
    if (!addTagOpen) {
      loadedForPath = null;
      tags = [];
      return;
    }
    const note = activeNote;
    if (!note) return;
    const path = note.path;
    if (path === loadedForPath) return;
    loadedForPath = path;
    invoke<string[]>("read_note_tags", { notePath: path })
      .then((loaded) => {
        if (loadedForPath === path) tags = loaded;
      })
      .catch(() => {
        tags = [];
      });
    invoke<string[]>("list_all_tags")
      .then((t) => {
        allTags = t ?? [];
      })
      .catch(() => {
        allTags = [];
      });
  });

  async function onTagsChange(next: string[]) {
    const note = activeNote;
    if (!note) return;
    try {
      await invoke("write_note_tags", { notePath: note.path, tags: next });
    } catch (e) {
      console.error("write_note_tags failed:", e);
    }
    addTagOpen = false;
  }
</script>

<svelte:window onkeydown={onKeydown} />

<Command.Dialog bind:open={searchPalette.open}>
  <Command.Input placeholder="Type a command or search..." bind:value={searchQuery} />
  <Command.List>
    <Command.Empty>No results found.</Command.Empty>
    {#if activeTabIsNote}
      <Command.Group heading="Actions">
        <Command.Item data-testid="cmd-add-tag" onSelect={openAddTag}>
          <Tag class="size-4 shrink-0 text-muted-foreground" />
          Add tag
        </Command.Item>
      </Command.Group>
    {/if}
    {#if noteResults.length > 0}
      <Command.Group heading="Notes">
        {#each noteResults as result (result.id)}
          <Command.Item
            data-testid="cmd-note-result"
            value={result.title}
            onSelect={() => openNote(result)}
            class="flex items-start gap-2 py-2"
          >
            <FileText class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div class="min-w-0 flex-1">
              <div class="font-heading text-sm">{result.title}</div>
              {#if result.excerpt}
                <div
                  data-testid="note-excerpt"
                  class="mt-0.5 truncate text-xs text-muted-foreground"
                >
                  {#each splitExcerpt(result.excerpt, searchQuery) as part}
                    {#if part.isMatch}
                      <span class="font-medium text-primary">{part.text}</span>
                    {:else}
                      {part.text}
                    {/if}
                  {/each}
                </div>
              {/if}
            </div>
            {#if result.match_count > 1}
              <span
                data-testid="match-count-chip"
                class="ml-auto shrink-0 text-xs text-muted-foreground"
              >
                {result.match_count} matches
              </span>
            {/if}
          </Command.Item>
        {/each}
      </Command.Group>
    {/if}
    {#if mapResults.length > 0}
      <Command.Group heading="Maps">
        {#each mapResults as result (result.id)}
          <Command.Item
            data-testid="cmd-map-result"
            value={result.title}
            onSelect={() => openMap(result)}
            class="flex items-center gap-2"
          >
            <Map class="size-4 shrink-0 text-muted-foreground" />
            <span class="font-heading text-sm">{result.title}</span>
          </Command.Item>
        {/each}
      </Command.Group>
    {/if}
    {#if sceneResults.length > 0}
      <Command.Group heading="Scenes">
        {#each sceneResults as result (result.id)}
          <Command.Item
            data-testid="cmd-scene-result"
            value={result.name}
            onSelect={() => openScene(result)}
            class="flex items-center gap-2"
          >
            <Clapperboard class="size-4 shrink-0 text-muted-foreground" />
            <span class="font-heading text-sm">{result.name}</span>
          </Command.Item>
        {/each}
      </Command.Group>
    {/if}
  </Command.List>
</Command.Dialog>

<Dialog.Root bind:open={addTagOpen}>
  <Dialog.Content showCloseButton={false}>
    <Dialog.Header class="sr-only">
      <Dialog.Title>Add tag</Dialog.Title>
      <Dialog.Description>Add a tag to the active note.</Dialog.Description>
    </Dialog.Header>
    <div data-testid="add-tag-picker" class="space-y-3">
      <p class="text-sm font-medium">
        Add tag{activeNote ? ` to "${activeNote.title}"` : ""}
      </p>
      <TagChipEditor bind:tags suggestions={allTags} onchange={onTagsChange} />
    </div>
  </Dialog.Content>
</Dialog.Root>

<div
  data-testid="app-search-bar"
  role="button"
  tabindex="0"
  aria-label="Open search"
  class="relative flex items-center justify-between gap-3 mx-3 mb-1 mt-2 h-(--row-h) px-(--pad-x)
         bg-muted text-muted-foreground rounded-lg text-(--font-ui) font-normal
         cursor-pointer whitespace-nowrap select-none
         hover:bg-sidebar-accent hover:text-foreground transition-colors duration-100"
  onclick={() => (searchPalette.open = true)}
  onkeydown={(e) => e.key === "Enter" && (searchPalette.open = true)}
>
  <span class="flex items-center gap-1.5">
    <Search class="w-3.5 h-3.5 shrink-0" />
    Search vault…
  </span>
  <kbd
    class="pointer-events-none inline-flex h-4 select-none items-center gap-0.5
           rounded border border-border bg-sidebar px-1 font-mono text-[10px] opacity-60"
  >
    <span>{isMac ? "⌘" : "Ctrl"} + K</span>
  </kbd>
</div>
