<script lang="ts">
  import { api } from "$lib/api";
  import type { FileNode, Note } from "$lib/types/ledger";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
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
    FileWarning,
    FolderX,
    Map as MapIcon,
    MapPinPlus,
    Folder,
    BookOpen,
    Ellipsis,
    FilePlus,
    FileUp,
    FolderPlus,
    LayoutTemplate,
    PanelRightOpen,
    Pencil,
    Trash2,
  } from "@lucide/svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { unreadableNotes } from "$lib/stores/unreadable-notes.svelte";
  import { useSidebar } from "$lib/components/ui/sidebar";
  import { slide } from "svelte/transition";
  import { importPdfFromHandle, isPdfFile, pickPdfsInto } from "$lib/pdf/import";
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
  import { treeRename } from "$lib/stores/tree-rename.svelte";
  import { shell } from "$lib/utils/shell-actions";
  import { isTypingIn } from "$lib/utils/keyboard";
  import { recycleBin } from "$lib/utils/platform";
  import { onDestroy } from "svelte";

  const sidebar = useSidebar();

  interface Props {
    node: FileNode;
    noteMap: Map<number, Note>;
    refresh: () => Promise<void>;
    handleNewNote: (parentNode: FileNode | null) => Promise<void>;
    handleNewFolder: (parentNode: FileNode | null) => Promise<void>;
    handleNewMap: (parentNode: FileNode | null) => Promise<void>;
    /** The tree's first row: Tab's stop until a row has been focused. */
    first?: boolean;
  }

  let {
    node,
    noteMap,
    refresh,
    handleNewNote,
    handleNewFolder,
    handleNewMap,
    first = false,
  }: Props = $props();

  // A PDF node is path-addressed (ADR-0011): no id, detected by extension.
  const isPdf = $derived(!node.is_dir && node.path.toLowerCase().endsWith(".pdf"));
  // A note, or folder, the open couldn't read. Muted with a warning, saying so on hover,
  // and a note's click opens the list rather than doing nothing (2026-10 design review).
  const unreadable = $derived(unreadableNotes.has(node.is_dir ? `${node.path}/` : node.path));

  // Active state: is this node the active tab in the focused pane?
  const isActive = $derived.by(() => {
    const active = tabs.activeTab;
    if (!active) return false;
    if (node.note_id !== null) return active.type === "note" && active.id === node.note_id;
    if (node.map_id !== null) return active.type === "map" && active.id === node.map_id;
    if (isPdf) return active.type === "pdf" && active.pdfPath === node.path;
    return false;
  });

  // ── Deleting ──────────────────────────────────────────────────────────────
  // A note, folder or PDF goes to the Recycle Bin at once: they are the GM's own files,
  // and the OS keeps them for as long as it takes to notice (the owner's call, 2026-10
  // design review — a folder of notes used to be gone for good when a five-second Undo
  // toast closed). A map's pins live in the database, which no bin gives back, so a map
  // keeps an Undo toast: its row leaves at once and comes back on Undo.

  let hidden = $state(false);

  /** The row after this one (or before it, at the end), outside anything it holds. */
  function neighbourRow(): HTMLElement | null {
    const rows = [...document.querySelectorAll<HTMLElement>("[data-tree-row]")].filter(
      (r) => !r.dataset.treeRow!.startsWith(`${node.path}/`),
    );
    const at = rows.findIndex((r) => r.dataset.treeRow === node.path);
    if (at < 0) return null;
    return rows[at + 1] ?? rows[at - 1] ?? null;
  }

  async function recycle(target: FileNode, remove: () => Promise<void>) {
    // Found first: focus goes to the row that takes this one's place, not to the
    // search box, which is where it fell when the row went.
    const next = neighbourRow();
    try {
      await remove();
    } catch {
      // The api's toast has said why; the row stays, because the file did.
      return;
    }
    toastSuccess(`“${target.name}” is in the ${recycleBin}`);
    await refresh();
    if (next?.isConnected) next.focus();
  }

  function deleteNote(target: FileNode) {
    const id = target.note_id;
    if (id === null) return;
    void recycle(target, async () => {
      await api.deleteNote(id);
      tabs.closeTabByTypeAndId("note", id);
      await notes.load();
    });
  }

  function deletePdf(target: FileNode) {
    void recycle(target, async () => {
      await api.deletePdf(target.path);
      tabs.closeTabsByPdfPath(target.path);
    });
  }

  function deleteFolder(target: FileNode) {
    const inside = [...noteMap].filter(([, n]) => n.path.startsWith(`${target.path}/`));
    void recycle(target, async () => {
      await api.deleteFolder(target.path);
      for (const [id] of inside) tabs.closeTabByTypeAndId("note", id);
      await notes.load();
    });
  }

  function deleteMap(target: FileNode) {
    const id = target.map_id;
    if (id === null) return;
    neighbourRow()?.focus();
    hidden = true;
    toastUndo(
      `Deleted “${target.name}”`,
      async () => {
        try {
          await api.deleteMap(id);
        } catch {
          hidden = false;
          return;
        }
        tabs.closeTabByTypeAndId("map", id);
        await maps.load();
        refresh();
      },
      () => (hidden = false),
    );
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

  // The explicit way to import PDFs, beside dropping them on the folder.
  async function importPdfToFolder(target: FileNode) {
    if (!target.is_dir) return;
    if ((await pickPdfsInto(target.path)) === 0) return;
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

  // A folder just made by New folder starts out being named.
  $effect(() => {
    if (treeRename.path === node.path) {
      treeRename.path = null;
      startRename(node);
    }
  });

  // And a row just renamed has focus back once the rebuilt tree draws it.
  let rowEl = $state<HTMLButtonElement | null>(null);
  $effect(() => {
    if (treeRename.focus === node.path && rowEl) {
      treeRename.focus = null;
      rowEl.focus();
    }
  });

  // ── The row's menu ────────────────────────────────────────────────────────
  // One list, drawn twice: by a right-click (or Shift+F10) and by the row's "⋯".
  // Every row names its Delete, and F2 and Delete do the same from the row itself
  // (2026-10 design review — the menus here had no icons, no keys, Title Case, and
  // a folder could not start a note from a template).

  type Kind = "folder" | "map" | "pdf" | "note";
  const kind: Kind = $derived(
    node.is_dir ? "folder" : node.map_id !== null ? "map" : isPdf ? "pdf" : "note",
  );

  type Action = {
    label: string;
    icon: typeof Pencil;
    run: () => void;
    key?: string;
    destructive?: boolean;
  };

  // An action that opens something elsewhere hands focus on: the menu must not take
  // it back to the row as it closes, and the sidebar's sheet gets out of the way.
  // Rename used to open the note and leave focus on the row, under the sheet.
  let handingOff = false;
  function handOff(run: () => void) {
    return () => {
      handingOff = true;
      sidebar?.setOpenMobile(false);
      run();
    };
  }

  function openInRightPane() {
    if (node.note_id !== null) {
      tabs.navigateOpen({ type: "note", id: node.note_id, title: node.name }, "right");
    } else if (node.map_id !== null) {
      tabs.navigateOpen({ type: "map", id: node.map_id, title: node.name }, "right");
    } else if (isPdf) {
      tabs.navigateOpen({ type: "pdf", id: 0, title: node.name, pdfPath: node.path }, "right");
    }
  }

  function rename() {
    if (kind === "note") {
      handOff(() => tabs.openTabWithRename("note", node.note_id!, node.name))();
    } else if (kind === "map") {
      handOff(() => tabs.openTabWithRename("map", node.map_id!, node.name))();
    } else {
      // The inline field focuses itself; the menu must not take focus back either.
      handingOff = true;
      startRename(node);
    }
  }

  function remove() {
    if (kind === "folder") deleteFolder(node);
    else if (kind === "map") deleteMap(node);
    else if (kind === "pdf") deletePdf(node);
    else deleteNote(node);
  }

  const groups: Action[][] = $derived.by(() => {
    const renameAction: Action = { label: "Rename", icon: Pencil, run: rename, key: "F2" };
    const deleteAction: Action = {
      label: `Delete “${node.name}”`,
      icon: Trash2,
      run: remove,
      key: "Del",
      destructive: true,
    };
    if (kind === "folder") {
      return [
        [
          { label: "New note", icon: FilePlus, run: handOff(() => handleNewNote(node)) },
          {
            label: "New note from template…",
            icon: LayoutTemplate,
            run: handOff(() => shell.openTemplatePickerIn(node.path)),
          },
          { label: "New folder", icon: FolderPlus, run: () => handleNewFolder(node) },
          { label: "New map…", icon: MapPinPlus, run: handOff(() => handleNewMap(node)) },
          { label: "Import PDF…", icon: FileUp, run: () => importPdfToFolder(node) },
        ],
        [renameAction],
        [deleteAction],
      ];
    }
    return [
      [
        { label: "Open in right pane", icon: PanelRightOpen, run: handOff(openInRightPane) },
        renameAction,
      ],
      [deleteAction],
    ];
  });

  // ── Moving through the tree ─────────────────────────────────────────────
  // ↑ ↓ along the rows shown, Home and End to the ends, → opens a folder (then steps
  // into it), ← closes it (or steps out to the folder holding the row) — a tree's
  // keys. The tree is one Tab stop, the row last focused.
  const tabStop = $derived(
    treeRename.tabStop === node.path || (treeRename.tabStop === null && first) ? 0 : -1,
  );

  function rows(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>("[data-tree-row]")];
  }

  function moveFocus(e: KeyboardEvent): boolean {
    const all = rows();
    const at = all.findIndex((r) => r.dataset.treeRow === node.path);
    let to: HTMLElement | undefined;
    if (e.key === "ArrowDown") to = all[at + 1];
    else if (e.key === "ArrowUp") to = all[at - 1];
    else if (e.key === "Home") to = all[0];
    else if (e.key === "End") to = all[all.length - 1];
    else if (e.key === "ArrowRight" && node.is_dir) {
      if (!expanded) treeExpansion.set(node.path, true);
      else to = all[at + 1]?.dataset.treeRow?.startsWith(`${node.path}/`) ? all[at + 1] : undefined;
    } else if (e.key === "ArrowLeft") {
      if (node.is_dir && expanded) treeExpansion.set(node.path, false);
      else {
        const slash = node.path.lastIndexOf("/");
        if (slash > 0) to = all.find((r) => r.dataset.treeRow === node.path.slice(0, slash));
      }
    } else return false;
    e.preventDefault();
    to?.focus();
    return true;
  }

  function onRowKeydown(e: KeyboardEvent) {
    if (isTypingIn(e.target) || renamingPath === node.path) return;
    if (moveFocus(e)) return;
    if (e.key === "F2") {
      e.preventDefault();
      rename();
    } else if (e.key === "Delete") {
      e.preventDefault();
      remove();
    }
  }

  function keepFocusIfHandedOff(e: Event) {
    if (handingOff) e.preventDefault();
    handingOff = false;
  }

  async function handleRename(target: FileNode, newName: string): Promise<boolean> {
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
        const slash = target.path.lastIndexOf("/");
        treeRename.focus =
          slash > 0 ? `${target.path.slice(0, slash)}/${newName.trim()}` : newName.trim();
        if (updatedCount > 0) {
          toastSuccess(`${updatedCount} ${updatedCount === 1 ? "note" : "notes"} updated`);
        }
        refresh();
      } else if (isPdf) {
        // PDFs are path-addressed (ADR-0011): rename the file on disk, then
        // re-key any open tab so it follows the moved file and shows the new
        // title. `newName` is the stem; the backend appends `.pdf`.
        const newPath = await api.renamePdf(target.path, newName.trim());
        tabs.updatePdfTab(target.path, newName.trim(), newPath);
        treeRename.focus = newPath;
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

<!-- The row's "⋯": the same menu, findable without a right-click. Out of the Tab
     order — every row would be two stops — since Shift+F10, F2 and Delete reach the
     same actions from the row itself. -->
{#snippet more()}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      tabindex={-1}
      aria-label="More for {node.name}"
      class="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity
             group-hover/tree-row:opacity-100 group-focus-within/tree-row:opacity-100 data-[state=open]:opacity-100
             hover:bg-surface-hover hover:text-foreground"
    >
      <Ellipsis class="size-4" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="start" class="max-w-72" onCloseAutoFocus={keepFocusIfHandedOff}>
      {#each groups as group, g (g)}
        {#if g > 0}<DropdownMenu.Separator />{/if}
        {#each group as action (action.label)}
          {@const Icon = action.icon}
          <DropdownMenu.Item
            variant={action.destructive ? "destructive" : "default"}
            onSelect={action.run}
          >
            <Icon />
            <span class="min-w-0 truncate">{action.label}</span>
            {#if action.key}<DropdownMenu.Shortcut>{action.key}</DropdownMenu.Shortcut>{/if}
          </DropdownMenu.Item>
        {/each}
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/snippet}

{#if !hidden}
  <ContextMenu.Root>
    <ContextMenu.Trigger class={node.is_dir ? undefined : "group/tree-row relative"}>
      {#if !node.is_dir}
        <Sidebar.MenuButton
          class="group-hover/tree-row:pr-8 group-focus-within/tree-row:pr-8"
          bind:ref={rowEl}
          data-tree-row={node.path}
          tabindex={tabStop}
          onfocus={() => (treeRename.tabStop = node.path)}
          onkeydown={onRowKeydown}
          {isActive}
          title={unreadable ? `Grimoire couldn't open ${node.name}` : node.name}
          draggable={renamingPath !== node.path}
          ondragstart={handleDragStart}
          ondragend={handleDragEnd}
          onclick={() => {
            if (renamingPath === node.path) return;
            if (unreadable) {
              unreadableNotes.show();
              return;
            }
            if (node.note_id !== null) {
              tabs.navigateOpen({ type: "note", id: node.note_id, title: node.name });
            } else if (node.map_id !== null) {
              tabs.navigateOpen({ type: "map", id: node.map_id, title: node.name });
            } else if (isPdf) {
              tabs.navigateOpen({ type: "pdf", id: 0, title: node.name, pdfPath: node.path });
            } else {
              return;
            }
            sidebar?.setOpenMobile(false);
          }}
        >
          {#if unreadable}
            <FileWarning class="size-4 shrink-0 text-muted-foreground" />
          {:else if node.map_id !== null}
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
              fallbackSelectionBehavior="all"
              onSave={(val) => handleRename(node, val)}
              onCancel={() => (renamingPath = null)}
            />
          {:else}
            <span class="truncate {unreadable ? 'text-muted-foreground' : ''}">{node.name}</span>
          {/if}
        </Sidebar.MenuButton>
        {@render more()}
      {:else}
        <Sidebar.MenuItem>
          <Collapsible.Root
            bind:open={() => expanded, (val) => treeExpansion.set(node.path, val)}
            class="group/collapsible [&[data-state=open]>div>button>svg:first-child]:rotate-90"
          >
            <!-- The folder's whole region is the drop target (see handleDragOver);
               only the row below shows it. -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div ondragover={handleDragOver} ondragleave={handleDragLeave} ondrop={handleDrop}>
              <div class="group/tree-row relative">
                <Collapsible.Trigger>
                  {#snippet child({ props })}
                    <Sidebar.MenuButton
                      {...props}
                      title={unreadable ? `Grimoire couldn't open ${node.name}` : node.name}
                      draggable={renamingPath !== node.path}
                      ondragstart={handleDragStart}
                      ondragend={handleDragEnd}
                      bind:ref={rowEl}
                      data-tree-row={node.path}
                      tabindex={tabStop}
                      onfocus={() => (treeRename.tabStop = node.path)}
                      onkeydown={onRowKeydown}
                      class="group-hover/tree-row:pr-8 group-focus-within/tree-row:pr-8 {isDropTarget
                        ? 'ring-1 ring-primary/50'
                        : ''}"
                    >
                      <ChevronRight class="transition-transform" />
                      {#if unreadable}
                        <FolderX class="size-4 shrink-0 text-muted-foreground" />
                      {:else}
                        <Folder class="size-4 shrink-0 text-muted-foreground" />
                      {/if}
                      <Rename.Root
                        this="span"
                        class="flex-1 truncate text-sm {unreadable ? 'text-muted-foreground' : ''}"
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
                        fallbackSelectionBehavior="all"
                        onSave={(val) => handleRename(node, val)}
                        onCancel={() => (renamingPath = null)}
                      />
                    </Sidebar.MenuButton>
                  {/snippet}
                </Collapsible.Trigger>
                {@render more()}
              </div>
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
      <ContextMenu.Content class="max-w-72" onCloseAutoFocus={keepFocusIfHandedOff}>
        {#each groups as group, g (g)}
          {#if g > 0}<ContextMenu.Separator />{/if}
          {#each group as action (action.label)}
            {@const Icon = action.icon}
            <ContextMenu.Item
              variant={action.destructive ? "destructive" : "default"}
              onSelect={action.run}
            >
              <Icon />
              <span class="min-w-0 truncate">{action.label}</span>
              {#if action.key}<ContextMenu.Shortcut>{action.key}</ContextMenu.Shortcut>{/if}
            </ContextMenu.Item>
          {/each}
        {/each}
      </ContextMenu.Content>
    </ContextMenu.Portal>
  </ContextMenu.Root>
{/if}
