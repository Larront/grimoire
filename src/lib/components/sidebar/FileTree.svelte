<script lang="ts">
  import { api } from "$lib/api";
  import type { FileNode, Note } from "$lib/types/ledger";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import * as Rename from "$lib/components/ui/rename";
  import FileTree from "$lib/components/sidebar/FileTree.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { maps } from "$lib/stores/maps.svelte";
  import { toastUndo, toastSuccess } from "$lib/toast";
  import {
    ChevronRight,
    FileText,
    Map as MapIcon,
    MapPinPlus,
    Folder,
    BookOpen,
  } from "@lucide/svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { useSidebar } from "$lib/components/ui/sidebar";
  import { slide } from "svelte/transition";
  import { importPdfFromHandle, isPdfFile } from "$lib/pdf/import";
  import {
    TREE_DRAG_MIME,
    canDrop,
    dragItemFor,
    dropIntoFolder,
    isTreeDrag,
    readDragItem,
    treeDrag,
  } from "$lib/stores/tree-move.svelte";
  import { treeExpansion } from "$lib/stores/tree-expansion.svelte";
  import { open } from "@tauri-apps/plugin-dialog";
  import { readFile } from "@tauri-apps/plugin-fs";
  import { onDestroy } from "svelte";

  const sidebar = useSidebar();

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

  // A PDF node is path-addressed (ADR-0011): no id, detected by extension.
  const isPdf = $derived(!node.is_dir && node.path.toLowerCase().endsWith('.pdf'));

  // Active state: is this node the active tab in the focused pane?
  const isActive = $derived.by(() => {
    const active = tabs.activeTab;
    if (!active) return false;
    if (node.note_id !== null) return active.type === 'note' && active.id === node.note_id;
    if (node.map_id !== null) return active.type === 'map'  && active.id === node.map_id;
    if (isPdf) return active.type === 'pdf' && active.pdfPath === node.path;
    return false;
  });

  function deleteNote(target: FileNode) {
    toastUndo(`"${target.name}" deleted`, async () => {
      if (target.note_id === null) return;
      tabs.closeTabByTypeAndId('note', target.note_id!);
      await api.deleteNote(target.note_id);
      await notes.load();
      refresh();
    });
  }

  function deleteMap(target: FileNode) {
    toastUndo(`"${target.name}" deleted`, async () => {
      if (target.map_id === null) return;
      tabs.closeTabByTypeAndId('map', target.map_id!);
      await api.deleteMap(target.map_id);
      await maps.load();
      refresh();
    });
  }

  function deletePdf(target: FileNode) {
    toastUndo(`"${target.name}" deleted`, async () => {
      tabs.closeTabsByPdfPath(target.path);
      await api.deletePdf(target.path);
      refresh();
    });
  }

  function deleteFolder(target: FileNode) {
    toastUndo(`"${target.name}" deleted`, async () => {
      for (const [id, note] of noteMap) {
        if (note.path.startsWith(target.path + '/')) {
          tabs.closeTabByTypeAndId('note', id);
        }
      }
      await api.deleteFolder(target.path);
      await notes.load();
      refresh();
    });
  }

  // ── Drops onto a folder: reorganise (#163) and PDF import (#102) ──────────
  // A folder's drop target is its whole region — its own row *and* everything
  // nested under it — so aiming at a file inside a folder means that folder, the
  // way it does in any file manager. The innermost region stops propagation, so a
  // nested folder wins over the one containing it and neither the folders above
  // nor the ledger-root zone also claim the drop.
  //
  // Only the row lights up, not the region: a ring drawn around a folder holding
  // fifty notes says nothing about where the thing is going, and the row is the
  // folder.
  let isDropTarget = $state(false);
  let hoverExpandTimer: ReturnType<typeof setTimeout> | null = null;

  // Open/closed is kept by path in treeExpansion, not here (#164): this row is
  // torn down and rebuilt on every tree refresh, and a folder should not close
  // itself because something elsewhere in the ledger changed.
  const expanded = $derived(treeExpansion.isExpanded(node.path));

  // Long enough that dragging *across* a folder on the way somewhere else does
  // not tear the tree open under the cursor.
  const HOVER_EXPAND_MS = 600;

  function scheduleHoverExpand() {
    if (expanded || hoverExpandTimer) return;
    hoverExpandTimer = setTimeout(() => {
      treeExpansion.set(node.path, true);
      hoverExpandTimer = null;
    }, HOVER_EXPAND_MS);
  }

  function cancelHoverExpand() {
    if (hoverExpandTimer) {
      clearTimeout(hoverExpandTimer);
      hoverExpandTimer = null;
    }
  }

  // A drop refreshes the tree, which tears down the rows it was dragged over —
  // any timer still counting down belongs to a folder that no longer exists.
  onDestroy(cancelHoverExpand);

  function handleDragOver(e: DragEvent) {
    if (!node.is_dir) return;

    if (isTreeDrag(e)) {
      // Claimed either way: an illegal drop here must not fall through to an
      // ancestor folder, which would move the node somewhere the cursor is not.
      e.stopPropagation();
      if (!canDrop(treeDrag.item, node.path)) {
        isDropTarget = false;
        cancelHoverExpand();
        return;
      }
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      isDropTarget = true;
      scheduleHoverExpand();
      return;
    }

    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    isDropTarget = true;
    scheduleHoverExpand();
  }

  // dragleave also fires when the cursor crosses between rows *inside* the
  // region, so the highlight only clears when it has genuinely left.
  function handleDragLeave(e: DragEvent) {
    const region = e.currentTarget as HTMLElement;
    const to = e.relatedTarget as Node | null;
    if (to && region.contains(to)) return;
    isDropTarget = false;
    cancelHoverExpand();
  }

  async function handleDrop(e: DragEvent) {
    if (!node.is_dir) return;
    isDropTarget = false;
    cancelHoverExpand();

    if (isTreeDrag(e)) {
      e.preventDefault();
      e.stopPropagation();
      // The event's payload is the truth; the in-flight record is the fallback
      // for a browser that hands over an empty DataTransfer.
      const item = readDragItem(e) ?? treeDrag.item;
      treeDrag.end();
      if (item && (await dropIntoFolder(item, node.path, noteMap))) {
        await refresh();
      }
      return;
    }

    const pdfs = Array.from(e.dataTransfer?.files ?? []).filter(isPdfFile);
    if (!pdfs.length) return;
    e.preventDefault();
    e.stopPropagation();
    for (const f of pdfs) await importPdfFromHandle(f, node.path);
    await refresh();
  }

  // ── Dragging a row (#163) ─────────────────────────────────────────────────
  function handleDragStart(e: DragEvent) {
    // An inline rename owns the row while it is open: dragging text out from
    // under the cursor would make the field impossible to use.
    if (renamingPath === node.path) {
      e.preventDefault();
      return;
    }
    const item = dragItemFor(node);
    treeDrag.start(item);
    e.dataTransfer?.setData(TREE_DRAG_MIME, JSON.stringify(item));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  function handleDragEnd() {
    treeDrag.end();
    isDropTarget = false;
    cancelHoverExpand();
  }

  // The explicit affordance for PDF import (drag-and-drop is the implicit one):
  // pick one or more PDFs via the OS dialog and import them into this folder. The
  // dialog yields paths, so bytes are read here and handed to the same backend
  // command the drop path uses (savePdfBytes; ADR-0011).
  async function importPdfToFolder(target: FileNode) {
    if (!target.is_dir) return;
    const picked = await open({
      title: "Import PDF",
      multiple: true,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (!paths.length) return;
    for (const p of paths) {
      const bytes: number[] = Array.from(await readFile(p));
      const name = p.replace(/\\/g, "/").split("/").pop() ?? "document.pdf";
      await api.savePdfBytes(bytes, name, target.path);
    }
    treeExpansion.reveal(target.path);
    await refresh();
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
        // `newName` is the bare folder name, like the PDF branch below: the
        // backend keeps the folder in its current parent (#162 — composing the
        // path here is what once moved every renamed subfolder to the root).
        const updatedCount = await api.renameFolder(target.path, newName.trim());
        if (updatedCount > 0) {
          toastSuccess(
            `${updatedCount} ${updatedCount === 1 ? "note" : "notes"} updated`,
          );
        }
        refresh();
      } else if (isPdf) {
        // PDFs are path-addressed (ADR-0011): rename the file on disk, then
        // re-key any open tab so it follows the moved file and shows the new
        // title. `newName` is the stem; the backend appends `.pdf`.
        const newPath = await api.renamePdf(target.path, newName.trim());
        tabs.updatePdfTab(target.path, newName.trim(), newPath);
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
        title={node.name}
        draggable={renamingPath !== node.path}
        ondragstart={handleDragStart}
        ondragend={handleDragEnd}
        onclick={() => {
          if (renamingPath === node.path) return;
          if (node.note_id !== null) {
            tabs.navigateOpen({ type: 'note', id: node.note_id, title: node.name });
          } else if (node.map_id !== null) {
            tabs.navigateOpen({ type: 'map', id: node.map_id, title: node.name });
          } else if (isPdf) {
            tabs.navigateOpen({ type: 'pdf', id: 0, title: node.name, pdfPath: node.path });
          } else {
            return;
          }
          sidebar?.setOpenMobile(false);
        }}
      >
        {#if node.map_id !== null}
          <MapIcon class="size-4 shrink-0 text-muted-foreground" />
        {:else if isPdf}
          <BookOpen class="size-4 shrink-0 text-muted-foreground" />
        {:else}
          <FileText class="size-4 shrink-0 text-muted-foreground" />
        {/if}
        {#if isPdf}
          <!-- PDFs rename inline in the tree (like folders): they're
               path-addressed, so there's no tab-title rename to hang off. -->
          <Rename.Root
            this="span"
            class="flex-1 truncate text-sm"
            bind:value={
              () => (renamingPath === node.path ? renameValue : node.name),
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
        {:else}
          <span class="truncate">{node.name}</span>
        {/if}
      </Sidebar.MenuButton>
    {:else}
      <Sidebar.MenuItem>
        <Collapsible.Root
          bind:open={
            () => expanded,
            (val) => treeExpansion.set(node.path, val)
          }
          class="group/collapsible [&[data-state=open]>div>button>svg:first-child]:rotate-90"
        >
          <!-- The folder's whole region is the drop target (see handleDragOver);
               only the row below shows it. -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            ondragover={handleDragOver}
            ondragleave={handleDragLeave}
            ondrop={handleDrop}
          >
          <Collapsible.Trigger>
            {#snippet child({ props })}
              <Sidebar.MenuButton
                {...props}
                title={node.name}
                draggable={renamingPath !== node.path}
                ondragstart={handleDragStart}
                ondragend={handleDragEnd}
                class={isDropTarget ? "ring-1 ring-primary/50" : undefined}
              >
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
          </div>
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
        <ContextMenu.Item onSelect={() => importPdfToFolder(node)}>
          Import PDF…
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
        <ContextMenu.Item onSelect={() => tabs.navigateOpen({ type: 'map', id: node.map_id!, title: node.name }, 'right')}>Open in Right Pane</ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item
          variant="destructive"
          onSelect={() => deleteMap(node)}
        >
          Delete Map
        </ContextMenu.Item>
      {:else if isPdf}
        <ContextMenu.Item onSelect={() => tabs.navigateOpen({ type: 'pdf', id: 0, title: node.name, pdfPath: node.path })}>Open</ContextMenu.Item>
        <ContextMenu.Item onSelect={() => tabs.navigateOpen({ type: 'pdf', id: 0, title: node.name, pdfPath: node.path }, 'right')}>Open in Right Pane</ContextMenu.Item>
        <ContextMenu.Item onSelect={() => startRename(node)}>Rename</ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item
          variant="destructive"
          onSelect={() => deletePdf(node)}
        >
          Delete PDF
        </ContextMenu.Item>
      {:else}
        <ContextMenu.Item onSelect={() => tabs.navigateOpen({ type: 'note', id: node.note_id!, title: node.name }, 'right')}>Open in Right Pane</ContextMenu.Item>
        <ContextMenu.Item onSelect={() => tabs.openTabWithRename('note', node.note_id!, node.name)}>Rename</ContextMenu.Item>
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
