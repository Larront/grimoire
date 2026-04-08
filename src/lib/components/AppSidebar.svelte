<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import { setContext, type ComponentProps } from "svelte";
  import AppSearch from "./AppSearch.svelte";
  import {
    FilePlus,
    MapPinPlus,
    FolderPlus,
    ChevronDown,
    Plus,
    ChevronRight,
  } from "@lucide/svelte";
  import { Button } from "./ui/button";
  import type { FileNode, Note, Map as VaultMap } from "$lib/types/vault";
  import { vault } from "$lib/stores/vault.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { maps } from "$lib/stores/maps.svelte";
  import { goto } from "$app/navigation";
  import { slide } from "svelte/transition";

  let {
    ref = $bindable(null),
    ...restProps
  }: ComponentProps<typeof Sidebar.Root> = $props();

  let tree = $state<FileNode | null>(null);
  let noteMap = $state(new Map<number, Note>());

  setContext<Map<number, Note>>("noteMap", noteMap);

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

  // Clear tree when vault closes.
  $effect(() => {
    if (!vault.isOpen) {
      tree = null;
      noteMap.clear();
    }
  });

  $effect(() => {
    notes.notes; // declare reactive dependency
    if (vault.isOpen) {
      invoke<FileNode>("get_file_tree")
        .then((result) => (tree = result))
        .catch((e) => console.error("FileTree tree sync failed:", e));
    }
  });

  // New Map dialog state
  let newMapDialogOpen = $state(false);
  let newMapTitle = $state("");
  let newMapSourcePath = $state<string | null>(null);
  let newMapDestPath = $state("");
  let isCreatingMap = $state(false);
  let newMapError = $state<string | null>(null);

  function deriveDestPath(sourcePath: string, title: string): string {
    const ext = sourcePath.split(".").pop()?.toLowerCase() ?? "png";
    return `Maps/${title}.${ext}`;
  }

  async function handlePickImage() {
    const picked = await open({
      title: "Choose Map Image",
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (picked && typeof picked === "string") {
      newMapSourcePath = picked;
      if (newMapTitle) {
        newMapDestPath = deriveDestPath(picked, newMapTitle);
      }
    }
  }

  async function handleCreateMap() {
    if (!newMapTitle.trim() || !newMapSourcePath) return;
    isCreatingMap = true;
    newMapError = null;
    try {
      const newMap = await invoke<VaultMap>("create_map", {
        title: newMapTitle.trim(),
        sourceImagePath: newMapSourcePath,
        destPath:
          newMapDestPath ||
          deriveDestPath(newMapSourcePath, newMapTitle.trim()),
      });
      await maps.load();
      refresh();
      newMapDialogOpen = false;
      newMapTitle = "";
      newMapSourcePath = null;
      newMapDestPath = "";
      goto(`/map/${newMap.id}`);
    } catch (e) {
      newMapError = String(e);
    } finally {
      isCreatingMap = false;
    }
  }

  async function handleNewNote() {
    try {
      const newNote = await invoke<Note>("create_note", {
        noteTitle: "Untitled",
        notePath: "Untitled.md",
        noteParentPath: null,
      });
      await notes.load();
      refresh();
      goto(`/note/${newNote.id}?new=1`);
    } catch (e) {
      console.error("create note failed:", e);
    }
  }

  async function handleNewFolder() {
    try {
      await invoke("create_folder", { folderPath: "New Folder" });
      refresh();
    } catch (e) {
      console.error("create folder failed:", e);
    }
  }
</script>

<Sidebar.Root bind:ref {...restProps}>
  <Sidebar.Content>
    <Sidebar.Header class="font-heading text-3xl justify-center text-center">
      Grimoire
    </Sidebar.Header>
    <Sidebar.Group>
      <Sidebar.GroupContent>
        <AppSearch />
        <div class="flex items-center gap-1 px-2.5 py-1.5 shrink-0">
          <Button
            title="New Note"
            aria-label="New Note"
            onclick={handleNewNote}
          >
            <FilePlus strokeWidth={1.25} class="size-6" />
          </Button>
          <Button
            title="New Folder"
            aria-label="New Folder"
            onclick={handleNewFolder}
          >
            <FolderPlus strokeWidth={1.25} class="size-6" />
          </Button>
          <Button title="New Map" aria-label="New Map">
            <MapPinPlus strokeWidth={1.25} class="size-6" />
          </Button>
        </div>
      </Sidebar.GroupContent>
    </Sidebar.Group>
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
              <div {...props} transition:slide={{ duration: 100 }}>
                <Sidebar.Content>
                  {#if tree}
                    {#if tree.children.length === 0}
                      <p>
                        No notes yet.<br />Use the buttons above to make your
                        first note
                      </p>
                    {:else}
                      {#each tree.children as node (node.path)}
                        {@render Tree({ node })}
                      {/each}
                    {/if}
                  {/if}
                </Sidebar.Content>
              </div>
            {/if}
          {/snippet}
        </Collapsible.Content>
      </Sidebar.Group>
    </Collapsible.Root>
    <Collapsible.Root open class="group/collapsible">
      <Sidebar.Group>
        <Sidebar.GroupLabel>Scenes</Sidebar.GroupLabel>
        <Sidebar.GroupAction title="Add Scene">
          <Plus /> <span class="sr-only">Add Scene</span>
        </Sidebar.GroupAction>
        <Sidebar.Content></Sidebar.Content>
      </Sidebar.Group>
    </Collapsible.Root>
  </Sidebar.Content>
  <Sidebar.Rail />
</Sidebar.Root>

<!-- eslint-disable-next-line @typescript-eslint/no-explicit-any -->
{#snippet Tree({ node }: { node: FileNode })}
  {#if !node.is_dir}
    <Sidebar.MenuButton
      class="data-[active=true]:bg-transparent"
      onclick={() => {
        console.log(node);
        if (node.note_id !== null) {
          goto("/note/" + node.note_id);
        } else if (node.map_id !== null) {
          goto("/map/" + node.map_id);
        }
      }}
    >
      {node.name}
    </Sidebar.MenuButton>
  {:else}
    <Sidebar.MenuItem>
      <Collapsible.Root
        class="group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90"
      >
        <Collapsible.Trigger>
          {#snippet child({ props })}
            <Sidebar.MenuButton {...props}>
              <ChevronRight class="transition-transform" />
              {node.name}
            </Sidebar.MenuButton>
          {/snippet}
        </Collapsible.Trigger>
        <Collapsible.Content forceMount>
          {#snippet child({ props, open })}
            {#if open}
              <div {...props} transition:slide>
                <Sidebar.MenuSub>
                  {#each node.children as subNode (node.path)}
                    {@render Tree({ node: subNode })}
                  {/each}
                </Sidebar.MenuSub>
              </div>
            {/if}
          {/snippet}
        </Collapsible.Content>
      </Collapsible.Root>
    </Sidebar.MenuItem>
  {/if}
{/snippet}
