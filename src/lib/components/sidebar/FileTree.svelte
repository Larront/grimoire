<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import type { FileNode, Note } from "$lib/types/vault";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import * as Rename from "$lib/components/ui/rename";
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import FileTree from "$lib/components/sidebar/FileTree.svelte";
  import { goto } from "$app/navigation";
  import { notes } from "$lib/stores/notes.svelte";
  import { maps } from "$lib/stores/maps.svelte";
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

  // Delete confirmation state
  let deleteDialogOpen = $state(false);
  let pendingDelete = $state<{
    type: "note" | "folder" | "map";
    node: FileNode;
  } | null>(null);

  function requestDelete(type: "note" | "folder" | "map", target: FileNode) {
    pendingDelete = { type, node: target };
    deleteDialogOpen = true;
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const { type, node: target } = pendingDelete;
    try {
      if (type === "folder") {
        const openId = Number(page.params.id);
        const openNote = noteMap.get(openId);
        if (openNote?.path.startsWith(target.path + "/")) await goto("/");
        await invoke("delete_folder", { folderPath: target.path });
        // Folder may contain notes — reload to keep counts accurate
        await notes.load();
      } else if (type === "note" && target.note_id !== null) {
        if (page.params.id === String(target.note_id)) await goto("/");
        await invoke("delete_note", { noteId: target.note_id });
        await notes.load();
      } else if (type === "map" && target.map_id !== null) {
        if (page.params.id === String(target.map_id)) await goto("/");
        await invoke("delete_map", { mapId: target.map_id });
        await maps.load();
      }
      refresh();
    } catch (e) {
      console.error(`delete ${type} failed:`, e);
    } finally {
      pendingDelete = null;
      deleteDialogOpen = false;
    }
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
          onSelect={() => requestDelete("folder", node)}
        >
          Delete Folder
        </ContextMenu.Item>
      {:else if node.map_id !== null}
        <ContextMenu.Item
          variant="destructive"
          onSelect={() => requestDelete("map", node)}
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
          onSelect={() => requestDelete("note", node)}
        >
          Delete Note
        </ContextMenu.Item>
      {/if}
    </ContextMenu.Content>
  </ContextMenu.Portal>
</ContextMenu.Root>

<AlertDialog.Root bind:open={deleteDialogOpen}>
  <AlertDialog.Portal>
    <AlertDialog.Overlay />
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>
          Delete {pendingDelete?.type === "folder"
            ? "folder"
            : pendingDelete?.type === "map"
              ? "map"
              : "note"}?
        </AlertDialog.Title>
        <AlertDialog.Description>
          {#if pendingDelete?.type === "folder"}
            This will permanently delete "{pendingDelete.node.name}" and all its
            contents. This cannot be undone.
          {:else}
            This will permanently delete "{pendingDelete?.node.name}". This
            cannot be undone.
          {/if}
        </AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
        <AlertDialog.Action
          class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onclick={confirmDelete}
        >
          Delete
        </AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>
