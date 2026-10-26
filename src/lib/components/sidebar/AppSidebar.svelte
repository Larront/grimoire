<script lang="ts">
  import { api } from "$lib/api";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import { useSidebar } from "$lib/components/ui/sidebar/context.svelte.js";
  import { cn } from "$lib/utils";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { shortcut } from "$lib/utils/keyboard";
  import { onMount, setContext, type ComponentProps } from "svelte";
  import { onLedgerEvents } from "$lib/ledger/events";
  import AppSearch from "../AppSearch.svelte";
  import {
    FilePlus,
    FolderPlus,
    MapPinPlus,
    ChevronDown,
    Music2,
    Plus,
    NotebookPen,
    Network,
    Settings,
    Search,
    Files,
    LayoutTemplate,
    SquarePen,
  } from "@lucide/svelte";
  import { buttonVariants } from "../ui/button";
  import type { FileNode, Note, Map as LedgerMap } from "$lib/types/ledger";
  import { ledger } from "$lib/stores/ledger.svelte";
  import { unlinkedPins } from "$lib/stores/unlinked-pins.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { maps } from "$lib/stores/maps.svelte";
  import { quickNotes } from "$lib/stores/quick-notes.svelte";
  import { scenes } from "$lib/stores/scenes.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { toastExternalMoveLinks, toastSuccess } from "$lib/toast";
  import { slide } from "svelte/transition";
  import { importPdfFromHandle, isPdfFile } from "$lib/pdf/import";
  import {
    canDrop,
    dropIntoFolder,
    isTreeDrag,
    readDragItem,
    treeDrag,
  } from "$lib/stores/tree-move.svelte";
  import { treeExpansion } from "$lib/stores/tree-expansion.svelte";
  import { shell } from "$lib/utils/shell-actions";
  import { STRIP_ICON, ROW_ICON, EXPANDED_ONLY } from "./strip-classes";
  import FileTree from "./FileTree.svelte";
  import MiniPlayer from "./MiniPlayer.svelte";
  import LedgerSelector from "./LedgerSelector.svelte";
  import SidebarScenes from "./SidebarScenes.svelte";
  import RailScenes from "./RailScenes.svelte";
  import { createUntitledNote } from "$lib/utils/note-actions";

  let { ref = $bindable(null), ...restProps }: ComponentProps<typeof Sidebar.Root> = $props();

  let tree = $state<FileNode | null>(null);
  let treeLoading = $state(false);
  let noteMap = $state(new Map<number, Note>());

  setContext<Map<number, Note>>("noteMap", noteMap);

  const sidebarState = useSidebar();

  /**
   * Open the sidebar and bring a section into view.
   *
   * What a stand-in on the collapsed strip does (#226): it reveals the group it
   * stands for rather than navigating somewhere, so Files and Scenes answer a
   * click the same way. Scrolled after the expansion has been laid out, or the
   * section is measured at the width it is leaving.
   */
  function reveal(sectionId: string) {
    sidebarState.setOpen(true);
    requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function refresh() {
    if (!ledger.isOpen) return;
    try {
      tree = await api.getFileTree();
    } catch (e) {
      console.error("FileTree refresh failed:", e);
    }
  }

  // ── External file watching (ADR-0013) ─────────────────────────────────────
  // When a note's .md file is created, deleted, or moved outside Grimoire, the
  // backend syncs the notes table + derived indexes and emits a targeted event.
  // Refetch the notes store (which cascades a tree rebuild via the $effect
  // below) so the Files tree reflects the change without reopening the ledger.
  // The allowlist is enforced by the disk-walking tree builder, so a non-note
  // file can never leak into the tree here.
  async function syncFromDisk() {
    // Reload the notes store first — the tree's note_id lookups and the frontend
    // noteMap are keyed off it — then rebuild the tree from disk.
    await notes.load();
    refresh();
  }

  onMount(() =>
    onLedgerEvents({
      "ledger:tree-changed": () => syncFromDisk(),
      "note:removed": () => syncFromDisk(),
      // An external move re-keyed a note's row in place (same id, new path); refetch
      // so the tree shows it at its new location and open panes follow it there.
      "note:moved": () => syncFromDisk(),
      // Bulk external change (git checkout, cloud sync): the backend rebuilt the
      // whole ledger and emitted one coarse event — refetch notes + tree wholesale.
      "ledger:rebuilt": () => syncFromDisk(),
      // The same bulk change can re-create note rows, which costs them their id
      // and unlinks every pin holding it (#224). The open-time repair reports
      // this through `open_ledger`'s result; mid-session there is no result to
      // ride on, so it arrives as its own event.
      "pins:unlinked": (pins) => unlinkedPins.add(pins),
      // A targeted external move left other notes linking to the old path. Offer
      // a non-destructive heal — never silent, never auto-dismissing (ADR-0014).
      // The count is display-only; the command recomputes the real set on Update.
      "note:external-move-links-stale": ({ from, to, count }) => {
        const oldName = from.split("/").pop()?.replace(/\.md$/, "") ?? from;
        toastExternalMoveLinks(oldName, count, () => {
          void api.applyBacklinkRewrite(from, to).then((n) => {
            if (n > 0) {
              toastSuccess(`${n} ${n === 1 ? "note" : "notes"} updated`);
            }
          });
        });
      },
    }),
  );

  $effect(() => {
    noteMap.clear();
    for (const n of notes.notes) noteMap.set(n.id, n);
  });

  $effect(() => {
    if (!ledger.isOpen) {
      tree = null;
      noteMap.clear();
      treeExpansion.clear();
    }
  });

  $effect(() => {
    notes.notes;
    maps.maps;
    if (ledger.isOpen) {
      treeLoading = true;
      api
        .getFileTree()
        .then((result) => (tree = result))
        .catch((e) => console.error("FileTree tree sync failed:", e))
        .finally(() => (treeLoading = false));
    }
  });

  // ── Drops onto the ledger root: reorganise (#163) and PDF import (#102) ────
  // The Files tree area is the ledger root's drop target. Every folder region
  // claims its own drops and stop-propagates them, so what reaches here is a
  // drop aimed at the root: empty tree space, or a top-level row.
  let isRootDropTarget = $state(false);

  function handleRootDragOver(e: DragEvent) {
    if (isTreeDrag(e)) {
      if (!canDrop(treeDrag.item, "")) {
        isRootDropTarget = false;
        return;
      }
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      isRootDropTarget = true;
      return;
    }
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    isRootDropTarget = true;
  }

  async function handleRootDrop(e: DragEvent) {
    isRootDropTarget = false;

    if (isTreeDrag(e)) {
      e.preventDefault();
      const item = readDragItem(e) ?? treeDrag.item;
      treeDrag.end();
      if (item && (await dropIntoFolder(item, "", noteMap))) {
        await refresh();
      }
      return;
    }

    const pdfs = Array.from(e.dataTransfer?.files ?? []).filter(isPdfFile);
    if (!pdfs.length) return;
    e.preventDefault();
    for (const f of pdfs) await importPdfFromHandle(f, "");
    await refresh();
  }

  async function handleNewMap(parentNode: FileNode | null = null) {
    try {
      const newMap = await api.createMapEmpty("Untitled Map");
      await maps.load();
      refresh();
      tabs.openTab({ type: "map", id: newMap.id, title: "Untitled Map" });
    } catch (e) {
      console.error("create map failed:", e);
    }
  }

  async function handleNewNote(parentNode: FileNode | null) {
    try {
      const newNote = await api.createNote(
        "Untitled",
        `${parentNode ? parentNode.path + "/Untitled.md" : "Untitled.md"}`,
        parentNode ? parentNode.path : null,
      );
      // Open the folder it went into, or the new note is created somewhere the
      // GM cannot see (#164). Done before the refresh so the rebuilt tree comes
      // back already open rather than opening a beat later.
      if (parentNode) treeExpansion.reveal(parentNode.path);
      await notes.load();
      refresh();
      tabs.openTab({ type: "note", id: newNote.id, title: "Untitled", rename: true });
    } catch (e) {
      console.error("create note failed:", e);
    }
  }

  async function handleNewScene() {
    try {
      const scene = await scenes.createScene("New Scene");
      tabs.openTab({ type: "scene", id: scene.id, title: scene.name });
    } catch (e) {
      console.error("create scene failed:", e);
    }
  }

  async function handleNewFolder(parentNode: FileNode | null) {
    try {
      await api.createFolder(`${parentNode ? parentNode.path + "/New Folder" : "New Folder"}`);
      if (parentNode) treeExpansion.reveal(parentNode.path);
      refresh();
    } catch (e) {
      console.error("create folder failed:", e);
    }
  }
</script>

<!--
  One entry on the collapsed strip: its own group, so every entry is spaced
  alike, and its own button. Rendered only when collapsed —
  these stand in for surfaces the expanded sidebar draws in full.
-->
{#snippet strip(testid: string, label: string, Icon: typeof Search, onclick: () => void)}
  <Sidebar.Group class="hidden group-data-[collapsible=icon]:block">
    <Sidebar.GroupContent>
      <Sidebar.Menu>
        <Sidebar.MenuItem>
          <Sidebar.MenuButton>
            {#snippet child({ props })}
              <button type="button" {...props} data-testid={testid} aria-label={label} {onclick}>
                <Icon class={STRIP_ICON} strokeWidth={1.5} />
              </button>
            {/snippet}
          </Sidebar.MenuButton>
        </Sidebar.MenuItem>
      </Sidebar.Menu>
    </Sidebar.GroupContent>
  </Sidebar.Group>
{/snippet}

<!--
  The sidebar collapses to the rail rather than off-canvas beside one (#226).
  `SIDEBAR_WIDTH_ICON` is 3rem, which is the width the deleted `IconRail` was, in
  the place it stood — so collapsing lands a GM exactly where they used to be.

  What each group shows collapsed is decided here rather than inherited: the
  library fades group *labels* out for free, but a group's *content* is a file
  tree, a scenes list or a templates list, and none of those can be 48px wide.
  Each is hidden explicitly, and the two that a GM reaches for mid-session —
  Files and Scenes — leave an icon behind.
-->
<Sidebar.Root collapsible="icon" bind:ref {...restProps}>
  <Sidebar.Header>
    <!-- The wordmark is the one element whose *content* changes rather than its
         width, so it is the one that needs a beat: everything else rides the
         library's width transition. Nothing replaces it collapsed — a 48px
         square with a letter in it, in a strip where every other square is a
         button, is a decoy, and the toggle it used to carry lives in the tab bar
         and on Ctrl/Cmd+\. -->
    <div
      class="flex items-center justify-center px-1 overflow-hidden transition-opacity duration-200 group-data-[collapsible=icon]:h-0 group-data-[collapsible=icon]:opacity-0"
    >
      <span class="font-heading text-3xl mt-3 tracking-tight text-primary select-none"
        >Grimoire</span
      >
    </div>
  </Sidebar.Header>

  <Sidebar.Content>
    <Sidebar.Group>
      <Sidebar.GroupContent>
        <!-- Search + quick-actions keep the default sidebar width and center as
             the sidebar widens (#140): the extra room becomes side padding
             rather than stretching the bar and spreading the buttons apart.
             15rem matches the default content width, so at that width this is a
             no-op. The file tree below still uses the full width. -->
        <div class="mx-auto w-full max-w-[15rem]">
          <div class={EXPANDED_ONLY}>
            <AppSearch />
          </div>
          <!-- Creating is an expanded-sidebar act. `Ctrl/Cmd+N` (#227) covers the
               common case from anywhere. ONE labelled menu rather than four bare
               icons: the icons were unlabelled behind a 600ms tooltip, sat at the
               weight of the session-critical rows below them, and the New Scene one
               had no handler at all. A word a GM can read beats four glyphs to
               decode, and the four acts are still one click and a choice away. -->
          <div class="mx-3 mt-1.5 {EXPANDED_ONLY}">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                data-testid="sidebar-new"
                class="{buttonVariants({
                  variant: 'ghost',
                  size: 'sm',
                })} w-full justify-start gap-2 px-2 text-(length:--font-ui) text-foreground-muted hover:text-foreground"
              >
                <Plus class="size-4" strokeWidth={1.75} />
                New
                <ChevronDown class="ms-auto size-3.5 opacity-60" />
              </DropdownMenu.Trigger>
              <!-- Note and Note from template go beside the open note, as Ctrl+N does
                   (see `newNoteFolder`). The template items are the sidebar's only
                   templates: the footer list they replace pushed Files out of sight
                   when opened (2026-10 design review). -->
              <DropdownMenu.Content align="start" class="w-(--bits-dropdown-menu-anchor-width)">
                <DropdownMenu.Item
                  onSelect={() =>
                    void createUntitledNote().catch((e) => console.error("create note failed:", e))}
                >
                  <FilePlus strokeWidth={1.5} />
                  Note
                  <DropdownMenu.Shortcut>{shortcut(["N"])}</DropdownMenu.Shortcut>
                </DropdownMenu.Item>
                <DropdownMenu.Item data-testid="sidebar-new-from-template" onSelect={shell.openTemplatePicker}>
                  <LayoutTemplate strokeWidth={1.5} />
                  Note from template…
                </DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => handleNewFolder(null)}>
                  <FolderPlus strokeWidth={1.5} />
                  Folder
                </DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => handleNewMap(null)}>
                  <MapPinPlus strokeWidth={1.5} />
                  Map
                </DropdownMenu.Item>
                <DropdownMenu.Item onSelect={handleNewScene}>
                  <Music2 strokeWidth={1.5} />
                  Scene
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item data-testid="sidebar-manage-templates" onSelect={shell.openTemplates}>
                  <SquarePen strokeWidth={1.5} />
                  Templates…
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>
        </div>
      </Sidebar.GroupContent>
    </Sidebar.Group>

    <!--
      The stand-ins: what the collapsed strip shows in place of surfaces that
      cannot be 48px wide. One `Sidebar.Group` each, not one group holding three
      — the group is what carries the `p-2`, so three rows sharing one sat tight
      together and read as a set while Graph and Quick Notes stood apart. Every
      entry on the strip is its own button, spaced like its neighbours.

      Search is a bar expanded and an icon collapsed. Files and Scenes both
      expand the sidebar and scroll to their group: a stand-in stands for a
      surface, so it should hand that surface over rather than pick one
      destination out of it. Both behaviours changed here — the old rail's Files
      button opened the sidebar and stopped, and its Scenes button went straight
      to the All Scenes tab, which is still a row away once expanded.
    -->
    {@render strip("sidebar-search-icon", "Search", Search, shell.openSearch)}
    {@render strip("sidebar-files-standin", "Files", Files, () => reveal("sidebar-files-section"))}
    <!-- Scenes is its own component: while a scene plays it carries the playing bars
         and, under it, that scene's pause — the mini player cannot be 48px wide. -->
    <RailScenes onReveal={() => reveal("sidebar-scenes-section")} />

    <!-- Quick Notes directly under search: the inbox a GM empties between
         sessions, with a count worth seeing at a glance. Expanded-only — see #233
         for why its count can't be on the strip. Graph used to share this group,
         but it is an occasional look across the world rather than a place a GM
         returns to, so it sits subdued in the footer beside Settings. -->
    <Sidebar.Group class={EXPANDED_ONLY}>
      <Sidebar.GroupContent>
        <Sidebar.Menu>
          <Sidebar.MenuItem>
            <Sidebar.MenuButton>
              {#snippet child({ props })}
                <button
                  type="button"
                  {...props}
                  data-testid="sidebar-quick-notes"
                  aria-label="Quick Notes"
                  onclick={shell.openQuickNotes}
                >
                  <NotebookPen class="size-4" strokeWidth={1.5} />
                  <span>Quick Notes</span>
                </button>
              {/snippet}
            </Sidebar.MenuButton>
            {#if quickNotes.count > 0}
              <Sidebar.MenuBadge data-testid="sidebar-quick-notes-count">
                {quickNotes.count}
              </Sidebar.MenuBadge>
            {/if}
          </Sidebar.MenuItem>
        </Sidebar.Menu>
      </Sidebar.GroupContent>
    </Sidebar.Group>

    <!-- Scenes before Files: switching the room's sound is the live-session act, so it
         sits above the tree that grows longest. -->
    <SidebarScenes />

    <!-- Files section -->
    <div id="sidebar-files-section" class={EXPANDED_ONLY}>
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
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                      ondragover={handleRootDragOver}
                      ondragleave={() => (isRootDropTarget = false)}
                      ondrop={handleRootDrop}
                      class="rounded-md {isRootDropTarget ? 'ring-1 ring-primary/40' : ''}"
                    >
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
                        <!-- One quiet line, not a second "make your first note" beside
                             the world's home, which already offers it (as does New ▾
                             above). It had a crimson tile and a button of its own
                             (2026-10 design review). -->
                        <p
                          class="px-2 py-1.5 text-(length:--font-ui) text-muted-foreground"
                          data-testid="files-empty"
                        >
                          Your notes will be listed here.
                        </p>
                      {/if}
                    </div>
                  </Sidebar.GroupContent>
                </div>
              {/if}
            {/snippet}
          </Collapsible.Content>
        </Sidebar.Group>
      </Collapsible.Root>
    </div>

  </Sidebar.Content>

  <Sidebar.Footer>
    <!-- The mini player and the ledger selector are both rows of text and controls
         with nothing to narrow to, so they go when the strip does. -->
    <div class={EXPANDED_ONLY}>
      <MiniPlayer />
      <LedgerSelector />
    </div>
    <!-- Graph and Settings, subdued, at the foot of the sidebar as Settings is at
         the foot of the rail (#235). Neither is reached for mid-session: Graph is
         an occasional overview (also in the command palette), Settings a dialog
         opener rather than a place, so they are the last things here rather than
         rows among the groups. -->
    <Sidebar.Menu>
      <Sidebar.MenuItem>
        <Sidebar.MenuButton>
          {#snippet child({ props })}
            <button
              type="button"
              {...props}
              data-testid="sidebar-graph"
              aria-label="Graph"
              class={cn(
                String(props.class ?? ""),
                "text-muted-foreground hover:text-sidebar-foreground",
              )}
              onclick={shell.openGraph}
            >
              <Network class={ROW_ICON} strokeWidth={1.5} />
              <span class={EXPANDED_ONLY}>Graph</span>
            </button>
          {/snippet}
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
      <Sidebar.MenuItem>
        <Sidebar.MenuButton>
          {#snippet child({ props })}
            <!-- `class` merged into the button's own rather than set beside it:
                 an attribute after `{...props}` replaces what the spread put
                 there, which cost this button every `MenuButton` style it has —
                 including the `overflow-hidden` that keeps a label out of a 48px
                 square. The label is hidden outright now regardless. -->
            <button
              type="button"
              {...props}
              data-testid="sidebar-settings"
              aria-label="Settings"
              class={cn(
                String(props.class ?? ""),
                "text-muted-foreground hover:text-sidebar-foreground",
              )}
              onclick={shell.openSettings}
            >
              <Settings class={ROW_ICON} strokeWidth={1.5} />
              <span class={EXPANDED_ONLY}>Settings</span>
            </button>
          {/snippet}
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Footer>
  <Sidebar.Rail />
</Sidebar.Root>
