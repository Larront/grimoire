<script lang="ts">
  import { api } from "$lib/api";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import * as Rename from "$lib/components/ui/rename";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import { useSidebar } from "$lib/components/ui/sidebar/context.svelte.js";
  import { cn } from "$lib/utils";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import { onMount, setContext, type ComponentProps } from "svelte";
  import { onLedgerEvents } from "$lib/ledger/events";
  import AppSearch from "../AppSearch.svelte";
  import {
    FilePlus,
    FolderPlus,
    MapPinPlus,
    ChevronDown,
    LayoutList,
    LayoutTemplate,
    Plus,
    Star,
    Music2,
    Volume2,
    Inbox,
    Network,
    Settings,
    Search,
    Files,
  } from "@lucide/svelte";
  import { Button, buttonVariants } from "../ui/button";
  import type { FileNode, Note, Map as LedgerMap, TemplateEntry } from "$lib/types/ledger";
  import { ledger, unlinkedPinsModal } from "$lib/stores/ledger.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { maps } from "$lib/stores/maps.svelte";
  import { scenes } from "$lib/stores/scenes.svelte";
  import { quickNotes } from "$lib/stores/quick-notes.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { templates } from "$lib/stores/templates.svelte";
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import { toastUndo, toastExternalMoveLinks, toastSuccess, toastUnlinkedPins } from "$lib/toast";
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

  // Favorite scenes from real data
  const favoriteScenes = $derived(scenes.scenes.filter((s) => s.favorited));

  const activeSceneDisplayId = $derived(audioEngine.loadingSceneId ?? audioEngine.activeSceneId);

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
      "pins:unlinked": (pins) => {
        unlinkedPinsModal.pins = pins;
        toastUnlinkedPins(pins.length, () => {
          unlinkedPinsModal.open = true;
        });
      },
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

  async function handleNewFolder(parentNode: FileNode | null) {
    try {
      await api.createFolder(`${parentNode ? parentNode.path + "/New Folder" : "New Folder"}`);
      if (parentNode) treeExpansion.reveal(parentNode.path);
      refresh();
    } catch (e) {
      console.error("create folder failed:", e);
    }
  }

  async function handleCreateTemplate() {
    try {
      const entry = await api.createTemplate();
      await templates.load();
      tabs.openTab({
        type: "template",
        id: 0,
        title: entry.display_name,
        badge: "Template",
        templatePath: entry.path,
      });
    } catch (e) {
      console.error("create_template failed:", e);
    }
  }

  function openTemplate(tmpl: TemplateEntry) {
    tabs.openTab({
      type: "template",
      id: 0,
      title: tmpl.display_name,
      badge: "Template",
      templatePath: tmpl.path,
    });
  }

  let renamingTemplatePath = $state<string | null>(null);
  let renameTemplateValue = $state("");

  function startRenameTemplate(tmpl: TemplateEntry) {
    renameTemplateValue = tmpl.display_name;
    renamingTemplatePath = tmpl.path;
  }

  async function handleRenameTemplate(tmpl: TemplateEntry, newName: string): Promise<boolean> {
    if (!newName.trim() || newName === tmpl.display_name) {
      renamingTemplatePath = null;
      return false;
    }
    try {
      await api.renameTemplate(tmpl.path, newName.trim());
      const newPath = tmpl.path.replace(/[^/]+\.md$/, `${newName.trim()}.md`);
      tabs.updateTemplateTab(tmpl.path, newName.trim(), newPath);
      await templates.load();
      renamingTemplatePath = null;
      return true;
    } catch (e) {
      console.error("rename template failed:", e);
      return false;
    }
  }

  function deleteTemplate(tmpl: TemplateEntry) {
    toastUndo(`"${tmpl.display_name}" deleted`, async () => {
      await api.deleteTemplate(tmpl.path);
      await templates.load();
    });
  }
</script>

<!--
  One entry on the collapsed strip: its own group, so it is spaced exactly as
  Graph and Quick Notes are, and its own button. Rendered only when collapsed —
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
               common case from anywhere, and four more icons would be the least
               session-critical controls doubling the strip's weight. -->
          <div
            class="flex items-center justify-between mx-3 mt-1.5 px-1.5 py-1 rounded-lg bg-muted/50 {EXPANDED_ONLY}"
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
    {@render strip("sidebar-scenes-standin", "Scenes", Music2, () =>
      reveal("sidebar-scenes-section"),
    )}

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
                        <div class="flex flex-col items-center gap-3 px-4 py-6 text-center">
                          <div
                            class="flex size-10 items-center justify-center rounded-lg bg-primary/10"
                          >
                            <FilePlus class="size-5 text-primary" strokeWidth={1.5} />
                          </div>
                          <div class="space-y-1">
                            <p class="text-(--font-body) font-medium">No notes yet</p>
                            <p class="text-(--font-ui) text-muted-foreground">
                              Create your first note to start building your world.
                            </p>
                          </div>
                          <Button variant="outline" size="sm" onclick={() => handleNewNote(null)}>
                            <FilePlus strokeWidth={1.5} />
                            New Note
                          </Button>
                        </div>
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

    <!-- Scenes section. Hidden wholesale when collapsed, as Files is: the strip's
         Scenes stand-in above expands the sidebar and scrolls here, so this is
         the surface it hands over. -->
    <div id="sidebar-scenes-section" class={EXPANDED_ONLY}>
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
                            <button
                              type="button"
                              {...props}
                              data-testid="sidebar-scenes"
                              onclick={shell.openScenes}
                            >
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
                                onclick={() =>
                                  tabs.navigateOpen({
                                    type: "scene",
                                    id: scene.id,
                                    title: scene.name,
                                  })}
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
    </div>

    <!-- Graph sits under the Scenes group rather than inside it (#235). It opens
         a tab as those rows do, but it is not a scene and does not belong to
         their list — a peer of the groups, like Quick Notes below it. -->
    <Sidebar.Group>
      <Sidebar.GroupContent>
        <Sidebar.Menu>
          <Sidebar.MenuItem>
            <Sidebar.MenuButton>
              {#snippet child({ props })}
                <button
                  type="button"
                  {...props}
                  data-testid="sidebar-graph"
                  aria-label="Graph"
                  onclick={shell.openGraph}
                >
                  <Network class={ROW_ICON} strokeWidth={1.5} />
                  <span class={EXPANDED_ONLY}>Graph</span>
                </button>
              {/snippet}
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
        </Sidebar.Menu>
      </Sidebar.GroupContent>
    </Sidebar.Group>

    <!-- Quick Notes: one button, and deliberately no list (#233). The pane and
         the dialog are already the two surfaces a Quick Note has; a third list
         here would want its own edit and delete affordances, or be a tease
         without them. The badge is absent — never a `0` — when the pen is empty.

         Expanded only, unlike Graph and Settings beside it. The strip is 48px
         and the count has to be legible on it, which means a pill small enough
         to clear a 20px glyph inside a 32px button — about 14px, carrying two
         digits. That is a number a GM squints at, so the honest version of it is
         no number at all: `Ctrl/Cmd+Shift+N` still catches a thought from
         anywhere, so nothing is unreachable while collapsed, only unlisted —
         which is what Templates already accepts. Diverges from #226's collapsed
         order and its "legible collapsed and expanded" criterion, on purpose. -->
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
                  <Inbox class="size-4" strokeWidth={1.5} />
                  <span class={EXPANDED_ONLY}>Quick Notes</span>
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
  </Sidebar.Content>

  <Sidebar.Footer>
    <!-- Templates gets no icon: it had no rail entry, and a footer accordion a GM
         opens occasionally is not session furniture. The mini player and the
         ledger selector are both rows of text and controls with nothing to
         narrow to, so they go with it. -->
    <Collapsible.Root class="group/collapsible {EXPANDED_ONLY}">
      <Sidebar.Group class="py-0">
        <Sidebar.GroupLabel class="font-normal opacity-50">
          {#snippet child({ props })}
            <Collapsible.Trigger {...props}>
              Templates
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
                  {#if templates.isLoading && templates.templates.length === 0}
                    <div class="space-y-1 px-2">
                      <Sidebar.MenuSkeleton showIcon />
                      <Sidebar.MenuSkeleton showIcon />
                    </div>
                  {:else}
                    <Sidebar.Menu>
                      {#each templates.templates as tmpl (tmpl.path)}
                        <ContextMenu.Root>
                          <ContextMenu.Trigger>
                            <Sidebar.MenuButton
                              data-testid="template-row-{tmpl.display_name}"
                              onclick={() => openTemplate(tmpl)}
                            >
                              <LayoutTemplate class="size-4 shrink-0 text-muted-foreground" />
                              <Rename.Root
                                this="span"
                                class="flex-1 truncate text-sm"
                                bind:value={
                                  () =>
                                    renamingTemplatePath === tmpl.path
                                      ? renameTemplateValue
                                      : tmpl.display_name,
                                  (val) => {
                                    renameTemplateValue = val;
                                  }
                                }
                                bind:mode={
                                  () => (renamingTemplatePath === tmpl.path ? "edit" : "view"),
                                  (val) => {
                                    if (val === "view") renamingTemplatePath = null;
                                  }
                                }
                                blurBehavior="exit"
                                onSave={(val) => handleRenameTemplate(tmpl, val)}
                                onCancel={() => (renamingTemplatePath = null)}
                              />
                            </Sidebar.MenuButton>
                          </ContextMenu.Trigger>
                          <ContextMenu.Portal>
                            <ContextMenu.Content>
                              <ContextMenu.Item onSelect={() => startRenameTemplate(tmpl)}
                                >Rename</ContextMenu.Item
                              >
                              <ContextMenu.Separator />
                              <ContextMenu.Item
                                variant="destructive"
                                onSelect={() => deleteTemplate(tmpl)}
                                >Delete Template</ContextMenu.Item
                              >
                            </ContextMenu.Content>
                          </ContextMenu.Portal>
                        </ContextMenu.Root>
                      {/each}
                      <Sidebar.MenuItem>
                        <Sidebar.MenuButton
                          class="text-muted-foreground/50 hover:text-muted-foreground"
                          onclick={handleCreateTemplate}
                          data-testid="new-template-btn"
                        >
                          <Plus class="size-4 shrink-0" strokeWidth={1.5} />
                          <span>New template</span>
                        </Sidebar.MenuButton>
                      </Sidebar.MenuItem>
                    </Sidebar.Menu>
                  {/if}
                </Sidebar.GroupContent>
              </div>
            {/if}
          {/snippet}
        </Collapsible.Content>
      </Sidebar.Group>
    </Collapsible.Root>
    <div class={EXPANDED_ONLY}>
      <MiniPlayer />
      <LedgerSelector />
    </div>
    <!-- Settings, subdued, at the foot of the sidebar as it is at the foot of the
         rail (#235). A dialog opener rather than a place, so it is the last thing
         here rather than a row among the groups. -->
    <Sidebar.Menu>
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
                "text-sidebar-foreground/60 hover:text-sidebar-foreground",
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
