<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import type { FileNode, Note } from "$lib/types/vault";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import * as Rename from "$lib/components/ui/rename";
  import FileTree from "$lib/components/sidebar/FileTree.svelte";
  import { goto } from "$app/navigation";
  import { notes } from "$lib/stores/notes.svelte";
  import { maps } from "$lib/stores/maps.svelte";
  import { toastUndo } from "$lib/toast";
  import {
    ChevronRight,
    FileText,
    Map as MapIcon,
    MapPinPlus,
    Folder,
  } from "@lucide/svelte";
  import { page } from "$app/state";
  import { slide } from "svelte/transition";

  interface Props {
    node: FileNode;
    noteMap: Map<number, Note>;
    refresh: () => Promise<void>;
    handleNewNote: (parentNode: FileNode | null) => Promise<void>;
    handleNewFolder: (parentNode: FileNode | null) => Promise<void>;
    handleNewMap: (parentNode: FileNode | null) => Promise<void>;
  }

  let { node, noteMap, refresh, handleNewNote, handleNewFolder, handleNewMap }: Props =
    $props();

  // Active state: is this node the currently viewed page?
  const isActive = $derived.by(() => {
    const id = page.params.id;
    if (!id) return false;
    if (node.note_id !== null) return String(node.note_id) === id;
    if (node.map_id !== null) return String(node.map_id) === id;
    return false;
  });

  function deleteNote(target: FileNode) {
    toastUndo(`"${target.name}" deleted`, async () => {
      if (target.note_id === null) return;
      if (page.params.id === String(target.note_id)) await goto("/");
      await invoke("delete_note", { noteId: target.note_id });
      await notes.load();
      refresh();
    });
  }

  function deleteMap(target: FileNode) {
    toastUndo(`"${target.name}" deleted`, async () => {
      if (target.map_id === null) return;
      if (page.params.id === String(target.map_id)) await goto("/");
      await invoke("delete_map", { mapId: target.map_id });
      await maps.load();
      refresh();
    });
  }

  function deleteFolder(target: FileNode) {
    toastUndo(`"${target.name}" deleted`, async () => {
      const openId = Number(page.params.id);
      const openNote = noteMap.get(openId);
      if (openNote?.path.startsWith(target.path + "/")) await goto("/");
      await invoke("delete_folder", { folderPath: target.path });
      await notes.load();
      refresh();
    });
  }

  // Rename state
  let renamingPath = $state<string | null>(null);
  let renameValue = $state("");

  function startRename(target: FileNode) {
    renameValue = target.name;
    renamingPath = target.path;
  }

  async function handleRename(
    target: FileNode,
    newName: string,
  ): Promise<boolean> {
    if (!newName.trim() || newName === target.name) {
      renamingPath = null;
      return false;
    }
    try {
      if (target.is_dir) {
        await invoke("rename_folder", {
          oldPath: target.path,
          newPath: newName.trim(),
        });
        refresh();
      }
      renamingPath = null;
      return true;
    } catch (e) {
      console.error("rename failed:", e);
      return false;
    }
  }
</script>

<ContextMenu.Root>
  <ContextMenu.Trigger>
    {#if !node.is_dir}
      <Sidebar.MenuButton
        {isActive}
        onclick={() => {
          if (renamingPath === node.path) return;
          if (node.note_id !== null) goto("/note/" + node.note_id);
          else if (node.map_id !== null) goto("/map/" + node.map_id);
        }}
      >
        {#if node.map_id !== null}
          <MapIcon class="size-4 shrink-0 text-muted-foreground" />
        {:else}
          <FileText class="size-4 shrink-0 text-muted-foreground" />
        {/if}
        <span class="truncate">{node.name}</span>
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
                <Folder class="size-4 shrink-0 text-muted-foreground" />
                <Rename.Root
                  this="span"
                  class="flex-1 truncate text-sm"
                  bind:value={
                    () =>
                      renamingPath === node.path ? renameValue : node.name,
                    (val) => {
                      renameValue = val;
                    }
                  }
                  bind:mode={
                    () => (renamingPath === node.path ? "edit" : "view"),
                    (val) => {
                      if (val === "view") renamingPath = null;
                    }
                  }
                  blurBehavior="exit"
                  onSave={(val) => handleRename(node, val)}
                  onCancel={() => (renamingPath = null)}
                />
              </Sidebar.MenuButton>
            {/snippet}
          </Collapsible.Trigger>
          <Collapsible.Content forceMount>
            {#snippet child({ props, open })}
              {#if open}
                <div {...props} transition:slide>
                  <Sidebar.MenuSub>
                    {#each node.children as subNode (subNode.path)}
                      <FileTree
                        node={subNode}
                        {noteMap}
                        {refresh}
                        {handleNewNote}
                        {handleNewFolder}
                        {handleNewMap}
                      />
                    {/each}
                  </Sidebar.MenuSub>
                </div>
              {/if}
            {/snippet}
          </Collapsible.Content>
        </Collapsible.Root>
      </Sidebar.MenuItem>
    {/if}
  </ContextMenu.Trigger>

  <ContextMenu.Portal>
    <ContextMenu.Content>
      {#if node.is_dir}
        <ContextMenu.Item onSelect={() => handleNewNote(node)}
          >New Note</ContextMenu.Item
        >
        <ContextMenu.Item onSelect={() => handleNewFolder(node)}
          >New Subfolder</ContextMenu.Item
        >
        <ContextMenu.Item onSelect={() => handleNewMap(node)}>
          New Map
        </ContextMenu.Item>
        <ContextMenu.Item onSelect={() => startRename(node)}
          >Rename</ContextMenu.Item
        >
        <ContextMenu.Separator />
        <ContextMenu.Item
          variant="destructive"
          onSelect={() => deleteFolder(node)}
        >
          Delete Folder
        </ContextMenu.Item>
      {:else if node.map_id !== null}
        <ContextMenu.Item
          variant="destructive"
          onSelect={() => deleteMap(node)}
        >
          Delete Map
        </ContextMenu.Item>
      {:else}
        <ContextMenu.Item
          onSelect={() => goto(`/note/${node.note_id}?rename=1`)}
          >Rename</ContextMenu.Item
        >
        <ContextMenu.Separator />
        <ContextMenu.Item
          variant="destructive"
          onSelect={() => deleteNote(node)}
        >
          Delete Note
        </ContextMenu.Item>
      {/if}
    </ContextMenu.Content>
  </ContextMenu.Portal>
</ContextMenu.Root>
