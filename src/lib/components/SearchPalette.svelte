<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { setMode, userPrefersMode } from "mode-watcher";
  import { toastError, toastSuccess } from "$lib/toast";
  import {
    Tag,
    FileText,
    Map,
    Clapperboard,
    FilePlus,
    Settings,
    Sun,
    FolderOpen,
    RefreshCw,
    BookTemplate,
    LayoutTemplate,
    FileDown,
  } from "@lucide/svelte";
  import * as Command from "$lib/components/ui/command";
  import * as Dialog from "$lib/components/ui/dialog";
  import TagChipEditor from "./TagChipEditor.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { templates } from "$lib/stores/templates.svelte";
  import type { TemplateEntry } from "$lib/types/vault";
  import { maps } from "$lib/stores/maps.svelte";
  import { scenes } from "$lib/stores/scenes.svelte";
  import { vault } from "$lib/stores/vault.svelte";
  import { searchPalette } from "$lib/stores/search.svelte";
  import type { Note, Map as VaultMap } from "$lib/types/vault";

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

  interface TagFacet {
    name: string;
    note_count: number;
  }

  interface SearchAllResult {
    notes: NoteSearchResult[];
    maps: MapSearchResult[];
    scenes: SceneSearchResult[];
    tags?: TagFacet[];
  }

  interface RecentEntityResult {
    entity_kind: string;
    entity_id: number;
    title: string;
    accessed_at: string;
  }

  let addTagOpen = $state(false);
  let tags = $state<string[]>([]);
  let allTags = $state<string[]>([]);
  let loadedForPath = $state<string | null>(null);
  let searchQuery = $state("");
  let templatePickerMode = $state(false);
  let templateList = $state<TemplateEntry[]>([]);
  let noteResults = $state<NoteSearchResult[]>([]);
  let mapResults = $state<MapSearchResult[]>([]);
  let sceneResults = $state<SceneSearchResult[]>([]);
  let tagResults = $state<TagFacet[]>([]);
  let recentEntities = $state<RecentEntityResult[]>([]);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingModifier = $state<"ctrl" | "shift" | null>(null);

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "k" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      searchPalette.open = true;
    }
  }

  $effect(() => {
    function captureEnterModifier(e: KeyboardEvent) {
      if (e.key === "Enter" && searchPalette.open) {
        if (e.ctrlKey || e.metaKey) pendingModifier = "ctrl";
        else if (e.shiftKey) pendingModifier = "shift";
        else pendingModifier = null;
      }
    }
    window.addEventListener("keydown", captureEnterModifier, { capture: true });
    return () => window.removeEventListener("keydown", captureEnterModifier, { capture: true });
  });

  const activeTabIsNote = $derived(tabs.activeTab?.type === "note");

  const activeTagFilters = $derived(
    searchQuery
      .trim()
      .split(/\s+/)
      .filter((t) => t.startsWith("tag:") && t.length > 4)
      .map((t) => t.slice(4).toLowerCase()),
  );

  const freeSearchText = $derived(
    searchQuery
      .trim()
      .split(/\s+/)
      .filter((t) => !(t.startsWith("tag:") && t.length > 4))
      .join(" "),
  );

  const visibleTagResults = $derived(
    tagResults.filter(
      (t) => !activeTagFilters.includes(t.name.toLowerCase()),
    ),
  );

  const activeNote = $derived.by(() => {
    const t = tabs.activeTab;
    if (!t || t.type !== "note") return null;
    return notes.notes.find((n) => n.id === t.id) ?? null;
  });

  function openAddTag() {
    searchPalette.open = false;
    addTagOpen = true;
  }

  async function cmdCreateNote() {
    searchPalette.open = false;
    try {
      const newNote = await invoke<Note>("create_note", {
        noteTitle: "Untitled",
        notePath: "Untitled.md",
        noteParentPath: null,
      });
      await notes.load();
      tabs.openTab({ type: "note", id: newNote.id, title: "Untitled", rename: true });
    } catch (e) {
      console.error("create_note failed:", e);
    }
  }

  async function cmdCreateScene() {
    searchPalette.open = false;
    try {
      const newScene = await invoke<{ id: number; name: string }>("create_scene", {
        name: "Untitled Scene",
      });
      await scenes.load();
      tabs.openTab({ type: "scene", id: newScene.id, title: newScene.name });
    } catch (e) {
      console.error("create_scene failed:", e);
    }
  }

  async function cmdCreateMap() {
    searchPalette.open = false;
    try {
      const newMap = await invoke<VaultMap>("create_map_empty", {
        title: "Untitled Map",
      });
      await maps.load();
      tabs.openTab({ type: "map", id: newMap.id, title: "Untitled Map" });
    } catch (e) {
      console.error("create_map_empty failed:", e);
    }
  }

  function cmdOpenSettings() {
    searchPalette.open = false;
    searchPalette.settingsOpen = true;
  }

  function cmdToggleTheme() {
    const cur = userPrefersMode.current;
    if (cur === "light") setMode("dark");
    else if (cur === "dark") setMode("system");
    else setMode("light");
    searchPalette.open = false;
  }

  function cmdSwitchVault() {
    searchPalette.open = false;
    vault.openVault();
  }

  async function cmdRebuildIndex() {
    searchPalette.open = false;
    try {
      await invoke("rebuild_search_index");
      toastSuccess("Search index rebuilt");
    } catch (e) {
      console.error("rebuild_search_index failed:", e);
      toastError("Failed to rebuild search index");
    }
  }

  async function cmdCreateTemplate() {
    searchPalette.open = false;
    try {
      const entry = await invoke<TemplateEntry>("create_template");
      await templates.load();
      tabs.openTab({ type: "template", id: 0, title: entry.display_name, badge: "Template", templatePath: entry.path });
    } catch (e) {
      console.error("create_template failed:", e);
    }
  }

  async function cmdCreateNoteFromTemplate() {
    try {
      const list = await invoke<TemplateEntry[]>("list_templates");
      templateList = list ?? [];
      templatePickerMode = true;
      searchQuery = "";
    } catch (e) {
      console.error("list_templates failed:", e);
    }
  }

  async function selectTemplate(template: TemplateEntry) {
    templatePickerMode = false;
    searchPalette.open = false;
    try {
      const newNote = await invoke<Note>("create_note_from_template", {
        templatePath: template.path,
        noteParentPath: null,
      });
      await notes.load();
      tabs.openTab({ type: "note", id: newNote.id, title: "Untitled", rename: true });
    } catch (e) {
      console.error("create_note_from_template failed:", e);
    }
  }

  async function cmdSaveNoteAsTemplate() {
    const note = activeNote;
    if (!note) return;
    searchPalette.open = false;
    try {
      await invoke<TemplateEntry>("save_note_as_template", { notePath: note.path });
      await templates.load();
    } catch (e) {
      console.error("save_note_as_template failed:", e);
    }
  }

  const ALL_COMMANDS = [
    { label: "Create new note", testid: "cmd-create-note", noteOnly: false, icon: FilePlus, action: cmdCreateNote },
    { label: "Create new scene", testid: "cmd-create-scene", noteOnly: false, icon: Clapperboard, action: cmdCreateScene },
    // Add tag is note-context-sensitive; placed 3rd so it's in the visible cap when a note is active
    { label: "Add tag to current note", testid: "cmd-add-tag", noteOnly: true, icon: Tag, action: openAddTag },
    { label: "Create note from template", testid: "cmd-create-note-from-template", noteOnly: false, icon: BookTemplate, action: cmdCreateNoteFromTemplate },
    { label: "Create new template", testid: "cmd-create-template", noteOnly: false, icon: LayoutTemplate, action: cmdCreateTemplate },
    { label: "Save note as template", testid: "cmd-save-note-as-template", noteOnly: true, icon: FileDown, action: cmdSaveNoteAsTemplate },
    { label: "Create new map", testid: "cmd-create-map", noteOnly: false, icon: Map, action: cmdCreateMap },
    { label: "Open Settings", testid: "cmd-open-settings", noteOnly: false, icon: Settings, action: cmdOpenSettings },
    { label: "Toggle theme", testid: "cmd-toggle-theme", noteOnly: false, icon: Sun, action: cmdToggleTheme },
    { label: "Switch vault…", testid: "cmd-switch-vault", noteOnly: false, icon: FolderOpen, action: cmdSwitchVault },
    { label: "Rebuild search index", testid: "cmd-rebuild-index", noteOnly: false, icon: RefreshCw, action: cmdRebuildIndex },
  ];

  const visibleRecent = $derived(searchQuery.length === 0 ? recentEntities.slice(0, 5) : []);

  function iconForKind(kind: string) {
    if (kind === "note") return FileText;
    if (kind === "map") return Map;
    return Clapperboard;
  }

  function relativeTime(isoString: string): string {
    const now = new Date();
    const then = new Date(isoString);
    const diffMs = now.getTime() - then.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60) {
      return diffMin <= 0 ? "just now" : `${diffMin}m ago`;
    }
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const thenDate = new Date(then.getFullYear(), then.getMonth(), then.getDate());
    if (thenDate.getTime() === today.getTime()) return "today";
    if (thenDate.getTime() === yesterday.getTime()) return "yesterday";
    return `${Math.floor(diffMs / 86400000)}d ago`;
  }

  const allMatchedCommands = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    const eligible = ALL_COMMANDS.filter((c) => !c.noteOnly || activeTabIsNote);
    return q ? eligible.filter((c) => c.label.toLowerCase().includes(q)) : eligible;
  });

  const DEFAULT_CAPS = { commands: 3, tags: 5, notes: 6, maps: 3, scenes: 3 } as const;

  let expandedGroups = $state(new Set<string>());

  $effect(() => {
    const _q = searchQuery;
    expandedGroups = new Set();
  });

  function expandGroup(group: string) {
    expandedGroups = new Set([...expandedGroups, group]);
  }

  const activeGroupCount = $derived(
    (visibleTagResults.length > 0 ? 1 : 0) +
    (noteResults.length > 0 ? 1 : 0) +
    (mapResults.length > 0 ? 1 : 0) +
    (sceneResults.length > 0 ? 1 : 0),
  );

  const commandsCap = $derived(expandedGroups.has("commands") ? Infinity : DEFAULT_CAPS.commands);
  const visibleCommands = $derived(allMatchedCommands.slice(0, commandsCap));
  const commandsShowMore = $derived(allMatchedCommands.length - visibleCommands.length);

  const tagsCap = $derived(expandedGroups.has("tags") ? Infinity : DEFAULT_CAPS.tags);
  const visibleTags = $derived(visibleTagResults.slice(0, tagsCap));
  const tagsShowMore = $derived(visibleTagResults.length - visibleTags.length);

  const notesCap = $derived.by(() => {
    if (expandedGroups.has("notes")) return Infinity;
    if (activeGroupCount === 1 && noteResults.length > 0) return 15;
    return DEFAULT_CAPS.notes;
  });
  const visibleNotes = $derived(noteResults.slice(0, notesCap));
  const notesShowMore = $derived(noteResults.length - visibleNotes.length);

  const mapsCap = $derived(expandedGroups.has("maps") ? Infinity : DEFAULT_CAPS.maps);
  const visibleMaps = $derived(mapResults.slice(0, mapsCap));
  const mapsShowMore = $derived(mapResults.length - visibleMaps.length);

  const scenesCap = $derived(expandedGroups.has("scenes") ? Infinity : DEFAULT_CAPS.scenes);
  const visibleScenes = $derived(sceneResults.slice(0, scenesCap));
  const scenesShowMore = $derived(sceneResults.length - visibleScenes.length);

  function openNote(result: NoteSearchResult) {
    const mod = pendingModifier;
    pendingModifier = null;
    invoke("record_recent", { kind: "note", id: result.id, title: result.title }).catch(() => {});
    searchPalette.activeQuery = searchQuery;
    searchPalette.open = false;
    const tab = { type: "note" as const, id: result.id, title: result.title };
    if (mod === "ctrl") tabs.openTabForceNew(tab);
    else if (mod === "shift") tabs.openTabOpposite(tab);
    else tabs.openTab(tab);
  }

  function openMap(result: MapSearchResult) {
    const mod = pendingModifier;
    pendingModifier = null;
    invoke("record_recent", { kind: "map", id: result.id, title: result.title }).catch(() => {});
    searchPalette.open = false;
    const tab = { type: "map" as const, id: result.id, title: result.title };
    if (mod === "ctrl") tabs.openTabForceNew(tab);
    else if (mod === "shift") tabs.openTabOpposite(tab);
    else tabs.openTab(tab);
  }

  function openScene(result: SceneSearchResult) {
    const mod = pendingModifier;
    pendingModifier = null;
    invoke("record_recent", { kind: "scene", id: result.id, title: result.name }).catch(() => {});
    searchPalette.open = false;
    const tab = { type: "scene" as const, id: result.id, title: result.name };
    if (mod === "ctrl") tabs.openTabForceNew(tab);
    else if (mod === "shift") tabs.openTabOpposite(tab);
    else tabs.openTab(tab);
  }

  function openRecent(entity: RecentEntityResult) {
    const mod = pendingModifier;
    pendingModifier = null;
    invoke("record_recent", { kind: entity.entity_kind, id: entity.entity_id, title: entity.title }).catch(() => {});
    searchPalette.open = false;
    const tab = {
      type: entity.entity_kind as "note" | "map" | "scene",
      id: entity.entity_id,
      title: entity.title,
    };
    if (mod === "ctrl") tabs.openTabForceNew(tab);
    else if (mod === "shift") tabs.openTabOpposite(tab);
    else tabs.openTab(tab);
  }

  function onSelectTag(tag: string) {
    const tokens = searchQuery.trim().split(/\s+/).filter((t) => t.length > 0);
    const tagTokens = tokens.filter((t) => t.startsWith("tag:") && t.length > 4);
    const freeTokens = tokens.filter((t) => !(t.startsWith("tag:") && t.length > 4));
    if (tagTokens.length > 0) {
      searchQuery = [...tagTokens, `tag:${tag}`, ...freeTokens].join(" ");
    } else {
      searchQuery = `tag:${tag}`;
    }
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
        tagResults = res?.tags ?? [];
      } catch {
        noteResults = [];
        mapResults = [];
        sceneResults = [];
        tagResults = [];
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
      tagResults = [];
      recentEntities = [];
      pendingModifier = null;
      templatePickerMode = false;
      templateList = [];
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    }
  });

  $effect(() => {
    if (searchPalette.open) {
      invoke<RecentEntityResult[]>("get_recent_entities")
        .then((res) => { recentEntities = res ?? []; })
        .catch(() => { recentEntities = []; });
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

{#snippet showMoreRow(group: string, count: number)}
  {#if count > 0}
    <Command.Item
      data-testid="cmd-show-more-{group}"
      value="__show-more-{group}__"
      onSelect={() => expandGroup(group)}
      class="flex items-center gap-2 text-xs text-muted-foreground"
    >
      Show {count} more in {group[0].toUpperCase() + group.slice(1)}
    </Command.Item>
  {/if}
{/snippet}

<Command.Dialog bind:open={searchPalette.open} shouldFilter={false}>
  <Command.Input placeholder="Type a command or search..." bind:value={searchQuery} />
  <Command.List>
    <Command.Empty>No results found.</Command.Empty>
    {#if templatePickerMode}
      <Command.Group heading="Choose a template">
        {#each templateList as template (template.path)}
          <Command.Item
            data-testid="cmd-template-result"
            value={template.display_name}
            onSelect={() => selectTemplate(template)}
            class="flex items-center gap-2"
          >
            <BookTemplate class="size-4 shrink-0 text-muted-foreground" />
            <span class="text-sm font-medium">{template.display_name}</span>
          </Command.Item>
        {/each}
      </Command.Group>
    {:else}
      {#if visibleRecent.length > 0}
        <Command.Group heading="Recent">
          {#each visibleRecent as entity (entity.entity_kind + ":" + entity.entity_id)}
            {@const Icon = iconForKind(entity.entity_kind)}
            <Command.Item
              data-testid="cmd-recent-result"
              value={entity.entity_kind + ":" + entity.entity_id}
              onSelect={() => openRecent(entity)}
              class="flex items-center gap-2"
            >
              <Icon class="size-4 shrink-0 text-muted-foreground" />
              <span class="font-heading text-sm flex-1 truncate">{entity.title}</span>
              <span
                data-testid="recent-time-hint"
                class="shrink-0 text-xs text-muted-foreground"
              >{relativeTime(entity.accessed_at)}</span>
              <span
                data-testid="recent-kind-chip"
                class="shrink-0 rounded border border-border px-1 text-xs text-muted-foreground capitalize"
              >{entity.entity_kind}</span>
            </Command.Item>
          {/each}
        </Command.Group>
      {/if}
      {#if visibleCommands.length > 0}
        <Command.Group heading="Commands">
          {#each visibleCommands as cmd (cmd.testid)}
            {@const Icon = cmd.icon}
            <Command.Item
              data-testid={cmd.testid}
              value={cmd.label}
              onSelect={cmd.action}
              class="flex items-center gap-2"
            >
              <Icon class="size-4 shrink-0 text-muted-foreground" />
              <span class="text-sm font-medium">{cmd.label}</span>
            </Command.Item>
          {/each}
          {@render showMoreRow("commands", commandsShowMore)}
        </Command.Group>
      {/if}
      {#if visibleTagResults.length > 0}
        <Command.Group heading="Tags">
          {#each visibleTags as tag (tag.name)}
            <Command.Item
              data-testid="cmd-tag-result"
              value={tag.name}
              onSelect={() => onSelectTag(tag.name)}
              class="flex items-center gap-2"
            >
              <Tag class="size-4 shrink-0 text-muted-foreground" />
              <span class="font-mono text-xs">{tag.name}</span>
              <span
                data-testid="tag-count-chip"
                class="ml-auto shrink-0 text-xs text-muted-foreground"
              >
                {tag.note_count} notes
              </span>
            </Command.Item>
          {/each}
          {@render showMoreRow("tags", tagsShowMore)}
        </Command.Group>
      {/if}
      {#if noteResults.length > 0}
        <Command.Group heading="Notes">
          {#each visibleNotes as result (result.id)}
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
                    {#each splitExcerpt(result.excerpt, freeSearchText) as part}
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
          {@render showMoreRow("notes", notesShowMore)}
        </Command.Group>
      {/if}
      {#if mapResults.length > 0}
        <Command.Group heading="Maps">
          {#each visibleMaps as result (result.id)}
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
          {@render showMoreRow("maps", mapsShowMore)}
        </Command.Group>
      {/if}
      {#if sceneResults.length > 0}
        <Command.Group heading="Scenes">
          {#each visibleScenes as result (result.id)}
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
          {@render showMoreRow("scenes", scenesShowMore)}
        </Command.Group>
      {/if}
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
