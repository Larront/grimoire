<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { api } from "$lib/api";
  import { MediaQuery } from "svelte/reactivity";
  import { fly } from "svelte/transition";
  import { notes } from "$lib/stores/notes.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { searchPalette } from "$lib/stores/search.svelte";
  import { appPrefs } from "$lib/stores/app-prefs.svelte";
  import { linksTick } from "$lib/stores/links-tick.svelte";
  import { toastSuccess } from "$lib/toast";
  import { LoaderCircle, FileWarning } from "@lucide/svelte";
  import { parseFrontmatter, serializeFrontmatter } from "$lib/utils";
  import { parseWikiTarget } from "$lib/editor/wiki-link";
  import Editor from "$lib/components/editor/Editor.svelte";
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import type { RightRailState } from "$lib/stores/right-rail.svelte";
  import DetailPanel from "$lib/components/DetailPanel.svelte";
  import NoteDetails from "$lib/components/NoteDetails.svelte";
  import { createNoteDetailsSource } from "$lib/details/note-details-source.svelte";
  import { getDockMode, floatTransition } from "$lib/utils/dock-threshold";
  import type { Note } from "$lib/types/ledger";

  interface Props {
    noteId: number;
    rename?: boolean;
    pane: 'left' | 'right';
    tabIndex: number;
    rail?: RightRailState;
  }
  let { noteId, rename, pane, tabIndex, rail }: Props = $props();

  let liveNote = $derived(notes.notes.find((n) => n.id === noteId) ?? null);
  // When this note's file is deleted externally the notes store drops its row —
  // but blanking the pane to "Note not found" would yank the GM's buffer away
  // (ADR-0013 Stage 4). We snapshot the note here and keep rendering from it,
  // behind a Save-to-recreate / Close banner, until the GM decides — cleared when
  // they recreate it (Save to recreate remounts the pane on the new row) or close
  // the tab. An externally restored file lands as a *new* note id, so it opens
  // separately rather than silently retiring this banner.
  let deletedNote = $state<Note | null>(null);
  let note = $derived(liveNote ?? deletedNote);

  // ── Content loading ──────────────────────────────────────────────────────
  let body = $state<string | null>(null);
  let lastMarkdown = $state<string | null>(null);
  let lastFetchedId = $state<number | null>(null);
  let highlightQuery = $state("");
  // The note the mounted Editor's content belongs to. `note` moves as soon as
  // the tab navigates — before the old Editor's unmount flush runs — so saves
  // must target the note whose body was loaded, never the live `note`.
  let editorNoteId: number | null = null;
  // The note's file couldn't be read (deleted/moved outside Grimoire). The
  // pane owns this error UI, so the fetch uses the silent surface (ADR-0010).
  let loadError = $state(false);
  // The mounted Editor instance, for its clean-buffer check and autosave
  // control during external-change conflict resolution.
  let editorApi = $state<
    | {
        isClean: () => boolean;
        pauseAutosave: () => void;
        resumeAutosave: () => void;
        discardPendingEdit: () => void;
        getMarkdown: () => string;
      }
    | undefined
  >(undefined);
  // Bumped to force-remount the Editor with freshly-loaded content when the
  // file changes on disk (Editor seeds its buffer only on mount).
  let reloadTick = $state(0);
  // The external on-disk body captured when the file changed under a dirty
  // buffer. Non-null ⇒ the Conflict Banner is showing (ADR-0013 Stage 4): the
  // GM must choose to reload it or keep their edits; neither side is discarded
  // silently. Held (not re-read on resolve) so an intervening autosave can't
  // swap it out from under the "Reload from disk" choice.
  let conflictBody = $state<string | null>(null);

  $effect(() => {
    if (note && note.id !== lastFetchedId) {
      const targetId = note.id;
      lastFetchedId = targetId;
      body = null;
      loadError = false;
      conflictBody = null;
      // Capture and consume the pending search query for scroll-to-match
      highlightQuery = searchPalette.activeQuery;
      searchPalette.activeQuery = "";
      api.silent
        .readNoteContent(note.path)
        .then((c) => {
          if (lastFetchedId !== targetId) return;
          const parsed = parseFrontmatter(c);
          editorNoteId = targetId;
          body = parsed.body;
        })
        .catch(() => {
          if (lastFetchedId !== targetId) return;
          loadError = true;
        });
    }
  });

  function closeThisTab() {
    tabs.closeTab(pane, tabIndex);
  }

  // ── External file watching (ADR-0013 Stages 3 + 4) ────────────────────────
  // When this note's .md file is edited outside Grimoire, the backend emits
  // note:content-changed with its path. A clean buffer reloads from disk
  // silently. A dirty buffer (unsaved edits / mid-debounce) must never be
  // clobbered and the external edit must never be discarded silently, so we
  // surface a non-destructive Conflict Banner and let the GM choose.
  async function handleExternalChange(changedPath: string) {
    if (!note || note.path !== changedPath) return;
    let externalBody: string;
    try {
      const c = await api.silent.readNoteContent(changedPath);
      // The pane may have navigated away during the read.
      if (!note || note.path !== changedPath) return;
      externalBody = parseFrontmatter(c).body;
    } catch {
      // Unreadable (mid-write, deleted) — leave the current buffer untouched.
      return;
    }
    if (editorApi && !editorApi.isClean()) {
      // Dirty buffer: don't touch it. Capture the external version, freeze the
      // autosave so a queued edit can't clobber disk while the banner waits,
      // and raise it — resolution reloads or keeps under the GM's control.
      conflictBody = externalBody;
      editorApi.pauseAutosave();
      return;
    }
    body = externalBody;
    reloadTick++;
  }

  // Discard the in-app buffer and load the external version. discardPendingEdit
  // stops the outgoing editor's teardown flush from writing the stale buffer;
  // remounting (reloadTick) reseeds a clean buffer from disk content.
  function reloadFromDisk() {
    if (conflictBody === null) return;
    editorApi?.discardPendingEdit();
    body = conflictBody;
    conflictBody = null;
    reloadTick++;
  }

  // Keep the unsaved buffer; resumeAutosave writes it to disk now, so the kept
  // version wins the conflict instead of lingering diverged from disk.
  function keepMyVersion() {
    editorApi?.resumeAutosave();
    conflictBody = null;
  }

  // ── Deleted while open (ADR-0013 Stage 4) ──────────────────────────────────
  // The open note's file was deleted (or moved away, with no move correlated) on
  // disk. The pane must not vanish: snapshot the note so the notes store dropping
  // its row (via the sidebar's own note:removed sync) can't blank the pane, and
  // raise the Save-to-recreate / Close banner. The buffer simply becomes unsaved —
  // handleSave finds no row for this id, so autosave can never resurrect the file.
  function handleExternalRemove(removedPath: string) {
    // Read `note` synchronously, before the concurrent notes.load() drops the row.
    const current = note;
    if (!current || current.path !== removedPath) return;
    deletedNote = { ...current };
  }

  // "Save to recreate": write the live buffer back to the original path. The row
  // was deleted, so createNote inserts a fresh one (new id) then we write the
  // buffer into it; repoint the tab at that new id so the pane keeps this note.
  async function saveToRecreate() {
    const snap = deletedNote;
    if (!snap) return;
    const markdown = editorApi?.getMarkdown() ?? lastMarkdown ?? "";
    try {
      const created = await api.createNote(snap.title, snap.path, snap.parent_path);
      await api.writeNoteContent(created.path, markdown);
      await notes.load();
      deletedNote = null;
      tabs.repointNoteTab(snap.id, created.id, created.title);
    } catch (e) {
      console.error("recreate note failed:", e);
    }
  }

  onMount(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const unlisten = Promise.all([
      listen<{ path: string }>("note:content-changed", (event) =>
        handleExternalChange(event.payload.path),
      ),
      listen<{ path: string }>("note:removed", (event) =>
        handleExternalRemove(event.payload.path),
      ),
      // Bulk external change (git checkout, cloud sync): the backend rebuilt the
      // whole ledger under one coarse event. This note's file may be among the
      // rewritten ones, so reload its content (clean-buffer gated) and details.
      listen("ledger:rebuilt", () => {
        if (!note) return;
        handleExternalChange(note.path);
        details.reload();
      }),
    ]);
    return () => {
      void unlisten.then((fns) => fns.forEach((fn) => fn()));
    };
  });

  // ── Title editing ─────────────────────────────────────────────────────────
  let draftTitle = $state("");
  let titleInput: HTMLInputElement | undefined = $state();
  let isSavingTitle = $state(false);

  // ── Rename confirmation dialog ────────────────────────────────────────────
  let renameDialogOpen = $state(false);
  let pendingRenameNote: { title: string; path: string } | null = $state(null);
  let pendingBacklinkCount = $state(0);

  // Keep draftTitle in sync when navigating to a different note
  $effect(() => {
    if (note && !isSavingTitle) draftTitle = note.title;
  });

  // Keep tab title in sync when note title changes
  $effect(() => {
    if (note) {
      const title = note.title;
      untrack(() => tabs.updateTabTitle('note', noteId, title));
    }
  });

  function parentDir(path: string): string {
    const i = path.lastIndexOf("/");
    return i === -1 ? "" : path.slice(0, i);
  }

  async function commitTitle() {
    if (!note) return;
    const trimmed = draftTitle.trim();
    if (!trimmed || trimmed === note.title) {
      draftTitle = note.title; // reset in case of whitespace-only edit
      return;
    }
    const dir = parentDir(note.path);
    const newPath = dir ? `${dir}/${trimmed}.md` : `${trimmed}.md`;

    if (appPrefs.confirmRenameLinks) {
      let count = 0;
      try {
        count = await api.getNoteBacklinkCount(note.path);
      } catch {
        count = 0;
      }
      if (count > 0) {
        pendingRenameNote = { title: trimmed, path: newPath };
        pendingBacklinkCount = count;
        renameDialogOpen = true;
        return; // dialog will call handleRenameAndUpdate or handleRenameOnly
      }
    }

    await doRename(trimmed, newPath, true);
  }

  async function doRename(title: string, newPath: string, updateLinks: boolean) {
    if (!note) return;
    isSavingTitle = true;
    try {
      if (updateLinks) {
        const result = await api.renameNote({ ...note, title, path: newPath });
        if (result.updated_count > 0) {
          const n = result.updated_count;
          toastSuccess(`${n} ${n === 1 ? "note" : "notes"} updated`);
        }
      } else {
        await api.updateNote({ ...note, title, path: newPath });
      }
      await notes.load();
    } catch (e) {
      console.error("title save failed:", e);
      draftTitle = note.title;
    } finally {
      isSavingTitle = false;
    }
  }

  async function handleRenameAndUpdate() {
    renameDialogOpen = false;
    if (!pendingRenameNote) return;
    await doRename(pendingRenameNote.title, pendingRenameNote.path, true);
    pendingRenameNote = null;
  }

  async function handleRenameOnly() {
    renameDialogOpen = false;
    if (!pendingRenameNote) return;
    await doRename(pendingRenameNote.title, pendingRenameNote.path, false);
    pendingRenameNote = null;
  }

  function handleRenameCancel() {
    renameDialogOpen = false;
    pendingRenameNote = null;
    if (note) draftTitle = note.title;
  }

  function handleTitleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
    if (e.key === "Escape") {
      if (note) draftTitle = note.title;
      (e.target as HTMLInputElement).blur();
    }
  }

  // ── Auto-focus on rename ─────────────────────────────────────────────────
  $effect(() => {
    if (rename) {
      tick().then(() => {
        titleInput?.focus();
        titleInput?.select();
        tabs.clearRenameFlag(pane, tabIndex);
      });
    }
  });

  async function handleSave(markdown: string) {
    lastMarkdown = markdown;
    if (editorNoteId === null || isSavingTitle) return;
    // Resolve the path from the store at save time: it follows renames, and a
    // note deleted while its editor was open is absent — never resurrect its
    // file from a trailing debounced or flushed save.
    const target = notes.notes.find((n) => n.id === editorNoteId);
    if (!target) return;
    try {
      await api.writeNoteContent(target.path, markdown);
      linksTick.bump();
    } catch (e) {
      console.error("content save failed:", e);
    }
  }

  // ── Pane width measurement (dock vs float decision) ─────────────────────
  const reducedMotion = new MediaQuery("(prefers-reduced-motion: reduce)");
  let containerEl = $state<HTMLDivElement | undefined>(undefined);
  let paneWidth = $state(0);

  $effect(() => {
    if (!containerEl) return;
    const ro = new ResizeObserver((entries) => {
      paneWidth = entries[0]?.contentRect.width ?? 0;
    });
    ro.observe(containerEl);
    return () => ro.disconnect();
  });

  const isDocked = $derived(getDockMode(paneWidth) === "docked");

  // ── Detail panel state ───────────────────────────────────────────────────
  // The Details Source owns the fetch fan-out, refresh invariants, and the
  // save-status machine (see CONTEXT.md — "Details Source").
  const details = createNoteDetailsSource(() => note);

  function navigateToNote(id: number, title: string) {
    tabs.openTab({ type: 'note', id, title });
  }

  async function createStubNote(targetPath: string) {
    const { title } = parseWikiTarget(targetPath);
    const newNote = await api.createNote(title, targetPath, null);
    await notes.load();
    tabs.openTab({ type: 'note', id: newNote.id, title: newNote.title });
  }
</script>

{#snippet detailPanel(onclose: () => void)}
  <DetailPanel title="Details" {onclose} saveStatus={details.saveStatus} onRetrySave={details.retrySave}>
    <NoteDetails
      {note}
      bind:tags={details.tags}
      allTags={details.allTags}
      bind:aliases={details.aliases}
      aliasCollisions={details.aliasCollisions}
      backlinks={details.backlinks}
      outboundLinks={details.outboundLinks}
      tagsLoadError={details.tagsLoadError}
      aliasesLoadError={details.aliasesLoadError}
      onTagsChange={details.saveTags}
      onAliasesChange={details.saveAliases}
      onNavigateNote={navigateToNote}
      onCreateStub={createStubNote}
    />
  </DetailPanel>
{/snippet}

<!-- ── Rename confirmation dialog ──────────────────────────────────────────── -->
<AlertDialog.Root bind:open={renameDialogOpen}>
  <AlertDialog.Portal>
    <AlertDialog.Overlay />
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>Update linked notes?</AlertDialog.Title>
        <AlertDialog.Description>
          {pendingBacklinkCount}
          {pendingBacklinkCount === 1 ? "note links" : "notes link"} to this note.
          Update their wikilinks to the new name?
        </AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel onclick={handleRenameCancel}>Cancel</AlertDialog.Cancel>
        <button
          type="button"
          data-testid="rename-only-btn"
          onclick={handleRenameOnly}
          class="inline-flex items-center justify-center rounded-md text-sm font-medium
                 border border-border bg-background hover:bg-accent hover:text-accent-foreground
                 h-9 px-4 py-2 transition-colors"
        >Rename only</button>
        <AlertDialog.Action onclick={handleRenameAndUpdate} data-testid="rename-update-btn">
          Rename + Update
        </AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>

<div bind:this={containerEl} class="relative flex flex-1 min-h-0">
  <!-- Note content area -->
  <div class="flex-1 min-w-0">
    {#if notes.isLoading}
      <div class="flex flex-1 items-center justify-center">
        <LoaderCircle class="size-5 animate-spin text-muted-foreground" />
      </div>
    {:else if !note}
      <div class="flex flex-1 items-center justify-center text-muted-foreground">
        Note not found
      </div>
    {:else}
      <!-- Single scroll container: title scrolls with the editor; scrollbar sits at pane edge.
           @container lets the inner content respond to the pane's own width, so split panes
           get tighter margins than the wide single-pane layout. -->
      <div
        data-note-scroll
        class="@container h-[calc(100svh_-_var(--tab-bar-h)_-_1px)] overflow-y-auto"
      >
        {#if conflictBody !== null}
          <!-- In-pane conflict bar (ADR-0013). Sticky, not modal: it flags
               external divergence without blocking the rest of the app. -->
          <div
            data-testid="conflict-banner"
            role="alert"
            class="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3
                   border-b border-primary/20 bg-background/95 px-6 py-2.5 backdrop-blur"
          >
            <div class="flex items-center gap-2 min-w-0">
              <FileWarning class="size-4 shrink-0 text-primary" />
              <p class="text-xs text-muted-foreground">
                This note changed on disk while you had unsaved edits.
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <button
                type="button"
                data-testid="conflict-reload"
                onclick={reloadFromDisk}
                class="inline-flex h-7 items-center rounded-md border border-border bg-background
                       px-2.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground
                       transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >Reload from disk</button>
              <button
                type="button"
                data-testid="conflict-keep"
                onclick={keepMyVersion}
                class="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-xs font-medium
                       text-primary-foreground hover:bg-primary/90 transition-colors
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >Keep my version</button>
            </div>
          </div>
        {/if}
        {#if deletedNote !== null}
          <!-- Deleted-while-open bar (ADR-0013 Stage 4). The file vanished on
               disk; the buffer is kept as an unsaved copy so nothing the GM was
               viewing is lost. Sticky, not modal. -->
          <div
            data-testid="deleted-banner"
            role="alert"
            class="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3
                   border-b border-primary/20 bg-background/95 px-6 py-2.5 backdrop-blur"
          >
            <div class="flex items-center gap-2 min-w-0">
              <FileWarning class="size-4 shrink-0 text-primary" />
              <p class="text-xs text-muted-foreground">
                This note's file was deleted outside Grimoire. Your unsaved copy
                is still here.
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <button
                type="button"
                data-testid="deleted-close"
                onclick={closeThisTab}
                class="inline-flex h-7 items-center rounded-md border border-border bg-background
                       px-2.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground
                       transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >Close</button>
              <button
                type="button"
                data-testid="deleted-recreate"
                onclick={saveToRecreate}
                class="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-xs font-medium
                       text-primary-foreground hover:bg-primary/90 transition-colors
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >Save to recreate</button>
            </div>
          </div>
        {/if}
        <div class="w-full mx-auto px-6 pt-10 pb-20 @5xl:max-w-[70%] @5xl:px-10">
          <input
            bind:this={titleInput}
            bind:value={draftTitle}
            class="w-full bg-transparent border-none outline-none p-0
                   font-heading text-4xl leading-tight tracking-tight
                   text-foreground placeholder:text-muted-foreground/40 focus:ring-0"
            placeholder="Untitled"
            onblur={commitTitle}
            onkeydown={handleTitleKeydown}
          />
          <div
            class="mt-3 mb-8 h-px bg-linear-to-r from-primary/25 to-transparent"
          ></div>
          {#if loadError}
            <!-- No Editor mounts in this state, so no autosave can recreate
                 the missing file. -->
            <div
              data-testid="note-load-error"
              class="flex flex-col items-start gap-3 text-muted-foreground"
            >
              <p class="text-sm leading-relaxed max-w-prose">
                This note couldn't be read — its file may have been moved or
                deleted outside Grimoire.
              </p>
              <button
                type="button"
                data-testid="note-load-error-close"
                onclick={closeThisTab}
                class="text-sm text-primary underline-offset-2 hover:underline
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
              >Close tab</button>
            </div>
          {:else if body !== null}
            {#key reloadTick}
              <Editor bind:this={editorApi} initialContent={body} onSave={handleSave} {highlightQuery} />
            {/key}
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <!-- Docked detail panel — visible when pane is wide enough (≥820px) -->
  {#if rail && !rail.isMobile && isDocked}
    <aside
      data-slot="right-rail"
      data-mobile="false"
      data-state={rail.open ? 'open' : 'closed'}
      class="flex w-0 shrink-0 flex-col overflow-hidden motion-reduce:transition-none transition-[width] duration-200 ease-linear data-[state=open]:w-[300px]"
    >
      <div class="flex h-full w-[300px] flex-col border-l border-background-border bg-background-subtle">
        {@render detailPanel(rail.toggle)}
      </div>
    </aside>
  {/if}

  <!-- Floating detail panel — visible when pane is narrow (<820px, non-mobile).
       Guard paneWidth > 0 avoids a brief flash before the ResizeObserver fires. -->
  {#if rail?.open && !rail.isMobile && !isDocked && paneWidth > 0}
    <div
      data-float="true"
      transition:fly={floatTransition(reducedMotion.current)}
      class="absolute top-4 right-4 z-50 w-80 bg-background rounded-lg shadow-2xl
             border border-background-border flex flex-col overflow-hidden max-h-[calc(100%-2rem)]"
    >
      {@render detailPanel(rail.toggle)}
    </div>
  {/if}
</div>

<!-- Mobile sheet overlay (always present when rail is mobile, regardless of note load state) -->
{#if rail?.isMobile}
  <Sheet.Root
    bind:open={() => rail.openMobile, (v) => rail.setOpenMobile(v)}
  >
    <Sheet.Content
      side="right"
      data-slot="right-rail"
      data-mobile="true"
      class="w-[300px] p-0 [&>button]:hidden"
      showCloseButton={false}
    >
      <Sheet.Header class="sr-only">
        <Sheet.Title>Details panel</Sheet.Title>
        <Sheet.Description>Document metadata and details.</Sheet.Description>
      </Sheet.Header>
      {@render detailPanel(() => rail?.setOpenMobile(false))}
    </Sheet.Content>
  </Sheet.Root>
{/if}
