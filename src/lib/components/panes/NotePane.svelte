<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { onLedgerEvents } from "$lib/ledger/events";
  import { api } from "$lib/api";
  import { notes } from "$lib/stores/notes.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { searchPalette } from "$lib/stores/search.svelte";
  import { appPrefs } from "$lib/stores/app-prefs.svelte";
  import { toastSuccess } from "$lib/toast";
  import { LoaderCircle, FileWarning } from "@lucide/svelte";
  import { parseFrontmatter, serializeFrontmatter } from "$lib/utils";
  import { parseWikiTarget } from "$lib/editor/wiki-link";
  import Editor from "$lib/components/editor/Editor.svelte";
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import DetailPanel from "$lib/components/DetailPanel.svelte";
  import DetailSurface from "$lib/components/DetailSurface.svelte";
  import NoteDetails from "$lib/components/NoteDetails.svelte";
  import { createNoteDetailsSource } from "$lib/details/note-details-source.svelte";
  import { paneSurface } from "$lib/details/pane-detail-surface.svelte";
  import type { Note } from "$lib/types/ledger";

  interface Props {
    noteId: number;
    rename?: boolean;
    pane: "left" | "right";
    tabIndex: number;
  }
  let { noteId, rename, pane, tabIndex }: Props = $props();

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
  // What a recreate needs beyond the text, taken as the file vanished: the editor's
  // buffer is the body alone, and the save restores the rest from a file that is no
  // longer there — so recreating used to drop every tag and alias (2026-10 design
  // review). The tags and aliases come from Details, which has this session's edits.
  let deletedMeta: { tags: string[]; aliases: string[] } = { tags: [], aliases: [] };
  // The frontmatter block as the file was last read, for the keys Details doesn't
  // edit (another tool's, the portability contract's).
  let loadedHead = "";

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
    // No note — a world switching under this tab — means the next one is read afresh,
    // even with the same id: ids are per world, and the one that comes back is a
    // different note.
    if (!note) {
      lastFetchedId = null;
      return;
    }
    if (note.id !== lastFetchedId) {
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
          loadedHead = c.slice(0, c.length - parsed.body.length);
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
      loadedHead = c.slice(0, c.length - externalBody.length);
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
    deletedMeta = { tags: [...details.tags], aliases: [...details.aliases] };
    deletedNote = { ...current };
  }

  // "Save to recreate": write the live buffer back to the original path. The row
  // was deleted, so createNote inserts a fresh one (new id) then we write the
  // buffer into it; repoint the tab at that new id so the pane keeps this note.
  async function saveToRecreate() {
    const snap = deletedNote;
    if (!snap) return;
    const markdown = editorApi?.getMarkdown() ?? lastMarkdown ?? "";
    const { tags, aliases } = deletedMeta;
    try {
      const created = await api.createNote(snap.title, snap.path, snap.parent_path);
      // The new file is empty, so the save writes the block as given.
      await api.writeNoteContent(created.path, loadedHead + markdown);
      // Only where there is something to say: no tags, and none before, adds no key.
      if (tags.length || /^tags:/m.test(loadedHead)) await api.writeNoteTags(created.path, tags);
      if (aliases.length) await api.setNoteAliases(created.id, aliases);
      await notes.load();
      deletedNote = null;
      tabs.repointNoteTab(snap.id, created.id, created.title);
      toastSuccess(`“${created.title}” is saved again`);
    } catch (e) {
      // The api's toast has said why; the copy stays open, behind its banner.
      console.error("recreate note failed:", e);
    }
  }

  onMount(() =>
    onLedgerEvents({
      "note:content-changed": ({ path }) => handleExternalChange(path),
      "note:removed": ({ path }) => handleExternalRemove(path),
      // Bulk external change (git checkout, cloud sync): the backend rebuilt the
      // whole ledger under one coarse event. This note's file may be among the
      // rewritten ones, so reload its content (clean-buffer gated). The Details
      // Source subscribes to the same event for its own refetch — the pane no
      // longer relays it (#212).
      "ledger:rebuilt": () => {
        if (!note) return;
        handleExternalChange(note.path);
      },
    }),
  );

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
      untrack(() => tabs.updateTabTitle("note", noteId, title));
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
        const result = await api.renameNote({ ...note, title, path: newPath }, true);
        if (result.updated_count > 0) {
          const n = result.updated_count;
          toastSuccess(`${n} ${n === 1 ? "note" : "notes"} updated`);
        }
      } else {
        await api.renameNote({ ...note, title, path: newPath }, false);
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
      const input = e.target as HTMLInputElement;
      input.blur();
      // On into the text, as a title's Enter does in any editor. It used to leave the
      // caret nowhere, so a GM naming their first note typed into nothing.
      input.closest("[data-note-column]")?.querySelector<HTMLElement>(".ProseMirror")?.focus();
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

  // `markdown` is body-only — the frontmatter was split off when the buffer was
  // seeded (see the read above) and writeNoteContent restores it from disk on
  // the way in. Do not prepend it here as well: two restorations write the block
  // twice, and a block captured at load time would roll back a key some other
  // tool added while the note sat open.
  async function handleSave(markdown: string) {
    lastMarkdown = markdown;
    if (editorNoteId === null || isSavingTitle) return;
    // Resolve the path from the store at save time: it follows renames, and a
    // note deleted while its editor was open is absent — never resurrect its
    // file from a trailing debounced or flushed save.
    const target = notes.notes.find((n) => n.id === editorNoteId);
    if (!target) return;
    try {
      // No linksTick.bump() here: the bump belongs to the write path, and the
      // Command Wrapper does it for every command that rewrites note bodies
      // (#212). This one used to be the only caller that remembered.
      await api.writeNoteContent(target.path, markdown);
    } catch (e) {
      console.error("content save failed:", e);
    }
  }

  // ── Detail surface ───────────────────────────────────────────────────────
  // The surface belongs to the pane slot, not to this note: it is what keeps a
  // rail the GM opened open as they navigate from note to note. A note's surface
  // is user-toggled (so the pane's header row shows a trigger) and docks or
  // floats on the pane's measured width (ADR-0006 §2, §3).
  const surface = $derived(paneSurface(pane));
  $effect(() => surface.claim({ toggleable: true, alwaysFloat: false }));

  let containerEl = $state<HTMLDivElement | undefined>(undefined);
  $effect(() => (containerEl ? surface.measure(containerEl) : undefined));

  // ── Detail panel state ───────────────────────────────────────────────────
  // The Details Source owns the fetch fan-out, refresh invariants, and the
  // save-status machine (see CONTEXT.md — "Details Source").
  const details = createNoteDetailsSource(() => note);

  function navigateToNote(id: number, title: string) {
    tabs.openTab({ type: "note", id, title });
  }

  async function createStubNote(targetPath: string) {
    const { title } = parseWikiTarget(targetPath);
    const newNote = await api.createNote(title, targetPath, null);
    await notes.load();
    tabs.openTab({ type: "note", id: newNote.id, title: newNote.title });
  }
</script>

{#snippet detailPanel()}
  <DetailPanel
    title="Details"
    onclose={surface.toggle}
    saveStatus={details.saveStatus}
    onRetrySave={details.retrySave}
  >
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
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Update linked notes?</AlertDialog.Title>
      <AlertDialog.Description>
        {pendingBacklinkCount}
        {pendingBacklinkCount === 1 ? "note links" : "notes link"} to this note. Update their wikilinks
        to the new name?
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
                 h-9 px-4 py-2 transition-colors">Rename only</button
      >
      <AlertDialog.Action onclick={handleRenameAndUpdate} data-testid="rename-update-btn">
        Rename + Update
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<div bind:this={containerEl} class="relative flex flex-1 min-h-0">
  <!-- Note content area -->
  <div class="flex-1 min-w-0">
    <!-- Wait only while the note isn't there yet. Every reload of the notes list —
         this note's own rename, a note made elsewhere — used to swap the open note
         for a spinner and back, tearing down its editor: the caret went nowhere and
         its undo history with it (2026-10 design review). -->
    {#if notes.isLoading && !note}
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
            data-note-inset
            role="alert"
            class="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3
                   border-b border-border bg-background-elevated py-2.5"
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
                >Reload from disk</button
              >
              <button
                type="button"
                data-testid="conflict-keep"
                onclick={keepMyVersion}
                class="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-xs font-medium
                       text-primary-foreground hover:bg-primary/90 transition-colors
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >Keep my version</button
              >
            </div>
          </div>
        {/if}
        {#if deletedNote !== null}
          <!-- Deleted-while-open bar (ADR-0013 Stage 4). The file vanished on
               disk; the buffer is kept as an unsaved copy so nothing the GM was
               viewing is lost. Sticky, not modal. -->
          <div
            data-testid="deleted-banner"
            data-note-inset
            role="alert"
            class="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3
                   border-b border-border bg-background-elevated py-2.5"
          >
            <div class="flex items-center gap-2 min-w-0">
              <FileWarning class="size-4 shrink-0 text-primary" />
              <p class="text-xs text-muted-foreground">
                This note's file was deleted outside Grimoire. Your unsaved copy is still here.
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
                >Close</button
              >
              <button
                type="button"
                data-testid="deleted-recreate"
                onclick={saveToRecreate}
                class="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-xs font-medium
                       text-primary-foreground hover:bg-primary/90 transition-colors
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >Save to recreate</button
              >
            </div>
          </div>
        {/if}
        <!-- The horizontal padding is in app.css under `[data-note-column]`, not here:
             its leading edge is the block gutter (#190) and is derived from the grip's
             own size, so it must not drift apart from a utility class. -->
        <div data-note-column class="w-full mx-auto pt-10 pb-20 max-w-[46rem]">
          <input
            bind:this={titleInput}
            bind:value={draftTitle}
            class="w-full bg-transparent border-none outline-none p-0
                   font-heading text-[2.75rem] leading-[1.15] tracking-tight
                   text-foreground placeholder:text-muted-foreground/40 focus:ring-0"
            placeholder="Untitled"
            onblur={commitTitle}
            onkeydown={handleTitleKeydown}
          />
          <div class="mt-3 mb-8 h-px bg-border"></div>
          {#if loadError}
            <!-- No Editor mounts in this state, so no autosave can recreate
                 the missing file. -->
            <div
              data-testid="note-load-error"
              class="flex flex-col items-start gap-3 text-muted-foreground"
            >
              <p class="text-sm leading-relaxed max-w-prose">
                This note couldn't be read — its file may have been moved or deleted outside
                Grimoire.
              </p>
              <button
                type="button"
                data-testid="note-load-error-close"
                onclick={closeThisTab}
                class="text-sm text-primary underline-offset-2 hover:underline
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
                >Close tab</button
              >
            </div>
          {:else if body !== null}
            {#key reloadTick}
              <Editor
                bind:this={editorApi}
                initialContent={body}
                onSave={handleSave}
                {highlightQuery}
                notePath={note?.path ?? null}
              />
            {/key}
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <!-- Docked rail, floating overlay or mobile sheet — the surface decides which
       from the pane's measured width (ADR-0006 §2). -->
  <DetailSurface {surface} open={surface.visible} onclose={surface.toggle}>
    {@render detailPanel()}
  </DetailSurface>
</div>
