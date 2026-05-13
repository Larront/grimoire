<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import { setContext, type ComponentProps } from "svelte";
  import AppSearch from "../AppSearch.svelte";
  import {
    FilePlus,
    FolderPlus,
    MapPinPlus,
    ChevronDown,
    LayoutList,
    Star,
    Music2,
    Volume2,
  } from "@lucide/svelte";
  import { Button, buttonVariants } from "../ui/button";
  import type { FileNode, Note, Map as VaultMap } from "$lib/types/vault";
  import { vault } from "$lib/stores/vault.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { maps } from "$lib/stores/maps.svelte";
  import { scenes } from "$lib/stores/scenes.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import { slide } from "svelte/transition";
  import FileTree from "./FileTree.svelte";
  import MiniPlayer from "./MiniPlayer.svelte";
  import VaultSelector from "./VaultSelector.svelte";

  let {
    ref = $bindable(null),
    ...restProps
  }: ComponentProps<typeof Sidebar.Root> = $props();

  let tree = $state<FileNode | null>(null);
  let treeLoading = $state(false);
  let noteMap = $state(new Map<number, Note>());

  setContext<Map<number, Note>>("noteMap", noteMap);

  // Favorite scenes from real data
  const favoriteScenes = $derived(scenes.scenes.filter((s) => s.favorited));

  const activeSceneDisplayId = $derived(audioEngine.loadingSceneId ?? audioEngine.activeSceneId);

  async function refresh() {
    if (!vault.isOpen) return;
    try {
      tree = await invoke<FileNode>("get_file_tree");
    } catch (e) {
      console.error("FileTree refresh failed:", e);
    }
  }

  $effect(() => {
    noteMap.clear();
    for (const n of notes.notes) noteMap.set(n.id, n);
  });

  $effect(() => {
    if (!vault.isOpen) {
      tree = null;
      noteMap.clear();
    }
  });

  $effect(() => {
    notes.notes;
    maps.maps;
    if (vault.isOpen) {
      treeLoading = true;
      invoke<FileNode>("get_file_tree")
        .then((result) => (tree = result))
        .catch((e) => console.error("FileTree tree sync failed:", e))
        .finally(() => (treeLoading = false));
    }
  });

  async function handleNewMap(parentNode: FileNode | null = null) {
    try {
      const newMap = await invoke<VaultMap>("create_map_empty", {
        title: "Untitled Map",
      });
      await maps.load();
      refresh();
      tabs.openTab({ type: 'map', id: newMap.id, title: 'Untitled Map' });
    } catch (e) {
      console.error("create map failed:", e);
    }
  }

  async function handleNewNote(parentNode: FileNode | null) {
    try {
      const newNote = await invoke<Note>("create_note", {
        noteTitle: "Untitled",
        notePath: `${parentNode ? parentNode.path + "/Untitled.md" : "Untitled.md"}`,
        noteParentPath: parentNode ? parentNode.path : null,
      });
      await notes.load();
      refresh();
      tabs.openTab({ type: 'note', id: newNote.id, title: 'Untitled', rename: true });
    } catch (e) {
      console.error("create note failed:", e);
    }
  }

  async function handleNewFolder(parentNode: FileNode | null) {
    try {
      await invoke("create_folder", {
        folderPath: `${parentNode ? parentNode.path + "/New Folder" : "New Folder"}`,
      });
      refresh();
    } catch (e) {
      console.error("create folder failed:", e);
    }
  }
</script>

<Sidebar.Root bind:ref {...restProps}>
  <Sidebar.Header>
    <div class="flex items-center justify-center px-1">
      <span
        class="font-heading text-3xl mt-3 tracking-tight text-primary select-none"
        >Grimoire</span
      >
    </div>
  </Sidebar.Header>

  <Sidebar.Content>
    <Sidebar.Group>
      <Sidebar.GroupContent>
        <AppSearch />
        <div
          class="flex items-center justify-between mx-3 mt-1.5 px-1.5 py-1 rounded-lg bg-muted/50"
        >
          <Tooltip.Root delayDuration={600}>
            <Tooltip.Trigger
              class="{buttonVariants({
                variant: 'ghost',
                size: 'icon-sm',
              })} text-primary/70 hover:text-primary"
              aria-label="New Note"
              onclick={() => handleNewNote(null)}
            >
              <FilePlus strokeWidth={1.5} />
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom">New Note</Tooltip.Content>
          </Tooltip.Root>

          <Tooltip.Root delayDuration={600}>
            <Tooltip.Trigger
              class="{buttonVariants({
                variant: 'ghost',
                size: 'icon-sm',
              })} text-primary/70 hover:text-primary"
              aria-label="New Folder"
              onclick={() => handleNewFolder(null)}
            >
              <FolderPlus strokeWidth={1.5} />
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom">New Folder</Tooltip.Content>
          </Tooltip.Root>

          <Tooltip.Root delayDuration={600}>
            <Tooltip.Trigger
              class="{buttonVariants({
                variant: 'ghost',
                size: 'icon-sm',
              })} text-primary/70 hover:text-primary"
              aria-label="New Map"
              onclick={() => handleNewMap(null)}
            >
              <MapPinPlus strokeWidth={1.5} />
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom">New Map</Tooltip.Content>
          </Tooltip.Root>

          <Tooltip.Root delayDuration={600}>
            <Tooltip.Trigger
              class="{buttonVariants({
                variant: 'ghost',
                size: 'icon-sm',
              })} text-primary/70 hover:text-primary"
              aria-label="New Scene"
            >
              <Music2 strokeWidth={1.5} />
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom">New Scene</Tooltip.Content>
          </Tooltip.Root>
        </div>
      </Sidebar.GroupContent>
    </Sidebar.Group>

    <!-- Files section -->
    <div id="sidebar-files-section">
      <Collapsible.Root open class="group/collapsible">
        <Sidebar.Group>
          <Sidebar.GroupLabel>
            {#snippet child({ props })}
              <Collapsible.Trigger {...props}>
                Files
                <ChevronDown
                  class="ms-auto transition-transform group-data-[state=open]/collapsible:rotate-180"
                />
              </Collapsible.Trigger>
            {/snippet}
          </Sidebar.GroupLabel>
          <Collapsible.Content forceMount>
            {#snippet child({ props, open })}
              {#if open}
                <div {...props} transition:slide>
                  <Sidebar.GroupContent>
                    {#if treeLoading && !tree}
                      <div class="space-y-1 px-2">
                        <Sidebar.MenuSkeleton showIcon />
                        <Sidebar.MenuSkeleton showIcon />
                        <Sidebar.MenuSkeleton showIcon />
                      </div>
                    {:else if tree && tree.children.length > 0}
                      <Sidebar.Menu>
                        {#each tree.children as treeNode (treeNode.path)}
                          <FileTree
                            node={treeNode}
                            {noteMap}
                            {refresh}
                            {handleNewNote}
                            {handleNewFolder}
                            {handleNewMap}
                          />
                        {/each}
                      </Sidebar.Menu>
                    {:else if tree}
                      <div
                        class="flex flex-col items-center gap-3 px-4 py-6 text-center"
                      >
                        <div
                          class="flex size-10 items-center justify-center rounded-lg bg-primary/10"
                        >
                          <FilePlus
                            class="size-5 text-primary"
                            strokeWidth={1.5}
                          />
                        </div>
                        <div class="space-y-1">
                          <p class="text-(--font-body) font-medium">No notes yet</p>
                          <p class="text-(--font-ui) text-muted-foreground">
                            Create your first note to start building your world.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onclick={() => handleNewNote(null)}
                        >
                          <FilePlus strokeWidth={1.5} />
                          New Note
                        </Button>
                      </div>
                    {/if}
                  </Sidebar.GroupContent>
                </div>
              {/if}
            {/snippet}
          </Collapsible.Content>
        </Sidebar.Group>
      </Collapsible.Root>
    </div>

    <!-- Scenes section -->
    <Collapsible.Root open class="group/collapsible">
      <Sidebar.Group>
        <Sidebar.GroupLabel>
          {#snippet child({ props })}
            <Collapsible.Trigger {...props}>
              Scenes
              <ChevronDown
                class="ms-auto transition-transform group-data-[state=open]/collapsible:rotate-180"
              />
            </Collapsible.Trigger>
          {/snippet}
        </Sidebar.GroupLabel>
        <Collapsible.Content forceMount>
          {#snippet child({ props, open })}
            {#if open}
              <div {...props} transition:slide>
                <Sidebar.GroupContent>
                  <Sidebar.Menu>
                    <Sidebar.MenuItem>
                      <Sidebar.MenuButton>
                        {#snippet child({ props })}
                          <button type="button" {...props} onclick={() => tabs.openTab({ type: 'scenes', id: 0, title: 'All Scenes' })}>
                            <LayoutList class="size-4" />
                            All Scenes
                          </button>
                        {/snippet}
                      </Sidebar.MenuButton>
                    </Sidebar.MenuItem>
                    {#each favoriteScenes as scene (scene.id)}
                      <Sidebar.MenuItem>
                        <Sidebar.MenuButton>
                          {#snippet child({ props })}
                            {@const isPlaying = scene.id === activeSceneDisplayId}
                            <button
                              type="button"
                              {...props}
                              data-scene-playing={isPlaying || undefined}
                              onclick={() => tabs.openTab({ type: 'scene', id: scene.id, title: scene.name })}
                            >
                              {#if isPlaying}
                                <Volume2 class="size-4 text-primary" />
                              {:else}
                                <Star class="size-4 fill-primary/30 text-primary" />
                              {/if}
                              <span class="truncate">{scene.name}</span>
                            </button>
                          {/snippet}
                        </Sidebar.MenuButton>
                      </Sidebar.MenuItem>
                    {/each}
                  </Sidebar.Menu>
                </Sidebar.GroupContent>
              </div>
            {/if}
          {/snippet}
        </Collapsible.Content>
      </Sidebar.Group>
    </Collapsible.Root>
  </Sidebar.Content>

  <Sidebar.Footer>
    <MiniPlayer />
    <VaultSelector />
  </Sidebar.Footer>
  <Sidebar.Rail />
</Sidebar.Root>
