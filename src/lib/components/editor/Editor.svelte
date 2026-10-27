<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Editor } from "@tiptap/core";

  import { noteExtensions } from "$lib/editor/note-extensions";
  import { insertImageFromHandle, isImageFile } from "$lib/editor/image-block";
  import { wikiBrokenLinkKey, stripWikiFragment } from "$lib/editor/wiki-link";
  import { showSearchHit } from "$lib/editor/search-hit";
  import type { SlashCommandSuggestionState } from "$lib/editor/slash-command";
  import type { WikiLinkSuggestionState } from "$lib/editor/wiki-link";

  import { createBlockHandleLife } from "$lib/editor/block-handle-life.svelte";

  import SlashCommandMenu from "./SlashCommandMenu.svelte";
  import BlockHandle from "./BlockHandle.svelte";
  import WikiLinkSuggestion from "./WikiLinkSuggestion.svelte";
  import WikiLinkPreview from "./WikiLinkPreview.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { linkResolver } from "$lib/stores/link-resolver.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { pendingSaves } from "$lib/stores/pending-saves";
  import { createLinkPreview } from "$lib/editor/link-preview.svelte";
  import { createNoteFromStub } from "$lib/editor/stub-note";

  interface Props {
    initialContent: string;
    onSave: (markdown: string) => Promise<void>;
    highlightQuery?: string;
    /** The note being edited — a link menu never offers a note a link to itself. */
    notePath?: string | null;
  }

  let { initialContent, onSave, highlightQuery = "", notePath = null }: Props = $props();

  let element = $state<HTMLDivElement>();
  let editor = $state<Editor | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  // True while an edit is waiting on the save debounce; cleared when a save
  // starts. Lets flush() know whether teardown must save (issue #106).
  let dirty = false;
  // Frozen while a conflict banner awaits the GM's choice (issue #129): a
  // queued or subsequent edit must NOT reach disk and clobber the external
  // change before they decide. Edits still mark the buffer dirty; only the
  // debounced write is suspended.
  let autosavePaused = false;
  let inFlightSave: Promise<void> | null = null;
  // The note's text as it was opened or last written. A save of the same text is no
  // save: opening a note is not editing it (see `save`).
  let savedBody = "";
  let unregisterFlush: (() => void) | undefined;
  // Bumped on every doc edit so the broken-link resolver re-runs when links change.
  let docVersion = $state(0);

  // ── Overlay state ────────────────────────────────────────────────────────────
  let slashState = $state<SlashCommandSuggestionState | null>(null);
  let wikiState = $state<WikiLinkSuggestionState | null>(null);

  // ── The block handle ─────────────────────────────────────────────────────────
  // Which block the grip belongs to, whether it is on screen at all, and what its menu is
  // doing — one owner for all of it (#211). The rules, and the orderings the gestures go
  // in, live in the module; what is left here is the two things only this component knows:
  // the editor's own report of the pointer, and the document changing under the grip.
  //
  // Built before the editor is, and given a way to read it late: the template below draws
  // from it, so it cannot wait for `onMount`.
  const blockHandle = createBlockHandleLife(() => editor);

  function scrollToFirstMatch(editorInstance: Editor, query: string) {
    const terms = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    if (!terms.length) return;

    let found: { from: number; to: number } | null = null;

    editorInstance.state.doc.descendants((node, pos) => {
      if (found) return false;
      if (node.isText && node.text) {
        for (const term of terms) {
          const idx = node.text.toLowerCase().indexOf(term);
          if (idx !== -1) {
            found = { from: pos + idx, to: pos + idx + term.length };
            return false;
          }
        }
      }
    });

    if (!found) return;

    editorInstance.commands.setTextSelection(found);
    editorInstance.commands.scrollIntoView();
    showSearchHit(editorInstance.view, found);
  }

  onMount(() => {
    editor = new Editor({
      element,
      // Every block reads its own markdown (ADR-0016 §3), so the note's text goes
      // to the editor exactly as it sits on disk — there is nothing left to
      // rewrite on the way in.
      extensions: noteExtensions({
        onSlashCommand: (state) => {
          slashState = state;
        },
        onWikiSuggestion: (state) => {
          wikiState = state;
        },
        notePath: () => notePath,
        onBlockTarget: blockHandle.point,
        onBlockGrab: blockHandle.grab,
      }),
      content: initialContent,
      contentType: "markdown",
      onUpdate: ({ transaction }) => {
        docVersion++;
        dirty = true;
        // The positions in the grip's target are the old document's and the pointer has
        // not moved to re-answer them — so the handle either walks its block through the
        // change or comes down. Which of the two is the handle's own decision.
        blockHandle.documentChanged(transaction);
        if (autosavePaused) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(save, 500);
      },
    });

    savedBody = bodyOf(editor);

    // Ledger switches and window close flush through this registry; the
    // editor's own unmount flushes in onDestroy below.
    unregisterFlush = pendingSaves.register(flush);

    if (highlightQuery) {
      // Allow the editor to finish its initial render before searching
      setTimeout(() => scrollToFirstMatch(editor!, highlightQuery), 150);
    }

    // The grip is placed from measurements taken when the pointer last moved, so a scroll
    // leaves it beside whatever has since slid into that spot — dropped rather than
    // re-placed, because which block the (still) pointer is over now is a question only
    // the next mousemove answers. Capture phase: the note scrolls in an ancestor
    // container, not on the window, and a scroll event does not bubble out of one.
    window.addEventListener("scroll", blockHandle.invalidate, true);
    return () => window.removeEventListener("scroll", blockHandle.invalidate, true);
  });

  onDestroy(() => {
    unregisterFlush?.();
    blockHandle.destroy();
    // flush() captures the markdown synchronously (before its first await),
    // so the pending edit is safe to hand off before destroying the editor.
    void flush();
    editor?.destroy();
  });

  /**
   * The note's text as it goes to disk: the editor's markdown, ending in one newline.
   *
   * Tiptap keeps an empty paragraph after a note's last block, so the caret can always
   * get below it, and adds it with the first transaction after a note opens — marking
   * its broken links is enough. That paragraph is never content, and it serialised as a
   * blank line at the end of the file, so the note looked edited and was saved as it
   * opened (2026-10 design review). Trailing blank lines are dropped for the same reason.
   */
  function bodyOf(ed: Editor): string {
    const markdown = ed.getMarkdown().trimEnd();
    return markdown ? markdown + "\n" : "";
  }

  /**
   * Write the buffer, unless it says what was opened or last written. `force` writes it
   * anyway: "Keep my version" puts the GM's text back over a change made on disk, which
   * this buffer can match while the file no longer does.
   */
  async function save(force = false) {
    if (!editor) return;
    dirty = false;
    const body = bodyOf(editor);
    if (!force && body === savedBody) return;
    savedBody = body;
    const run: Promise<void> = onSave(body).finally(() => {
      if (inFlightSave === run) inFlightSave = null;
    });
    inFlightSave = run;
    await run;
  }

  /** Cancel the debounce and persist any pending edit immediately. */
  async function flush() {
    clearTimeout(saveTimer);
    if (dirty) await save();
    else if (inFlightSave) await inFlightSave;
  }

  /**
   * True when the buffer holds no unsaved work — no edit waiting on the save
   * debounce and no save in flight. An external live-reload (ADR-0013 Stage 3)
   * only replaces the buffer when this holds, so a note being edited is never
   * clobbered by a change on disk.
   */
  export function isClean(): boolean {
    return !dirty && !inFlightSave;
  }

  /**
   * The editor's current buffer as markdown. Used by the deleted-while-open
   * banner's "Save to recreate" (ADR-0013 Stage 4) to write the live buffer —
   * including edits made after the file vanished — back to the original path.
   */
  export function getMarkdown(): string {
    return editor ? bodyOf(editor) : initialContent;
  }

  /**
   * Freeze the autosave debounce while an external-change conflict banner is up
   * (issue #129), cancelling any already-scheduled save. Without this the 500ms
   * debounce fires while the banner waits and silently overwrites the external
   * edit on disk — the exact clobber ADR-0013's banner exists to prevent.
   */
  export function pauseAutosave(): void {
    autosavePaused = true;
    clearTimeout(saveTimer);
  }

  /**
   * Unfreeze autosave and persist the kept buffer now ("Keep my version"): the
   * GM chose their edits, so write them to disk immediately rather than leaving
   * the editor and disk silently diverged until the next keystroke. Whether or not
   * an edit is pending: a note whose file came back after a delete has edits that
   * were never saved, with nothing left waiting to save them.
   */
  export function resumeAutosave(): Promise<void> {
    autosavePaused = false;
    return save(true);
  }

  /**
   * Drop the unsaved buffer without persisting it ("Reload from disk"): the
   * external version wins, so neither the debounce nor the teardown flush may
   * write the stale buffer. The pane then remounts this editor with disk content.
   */
  export function discardPendingEdit(): void {
    clearTimeout(saveTimer);
    dirty = false;
  }

  // Ask the Link Resolver which wikilink targets don't resolve and feed the set to
  // the broken-link plugin so stubs render faded. Drawing, so it reads the cached
  // answer: unresolved-yet links stay full accent (never flash as stubs).
  async function refreshBrokenLinks() {
    const ed = editor;
    if (!ed) return;
    const paths = new Set<string>();
    ed.state.doc.descendants((n) => {
      if (n.type.name === "wikiLink" && n.attrs.path) paths.add(n.attrs.path as string);
    });
    await linkResolver.prime(paths);
    // Guard against a torn-down / swapped editor after the await.
    if (editor !== ed) return;
    const broken = new Set([...paths].filter((p) => !linkResolver.isKnown(p)));
    ed.view.dispatch(ed.state.tr.setMeta(wikiBrokenLinkKey, broken));
  }

  // Re-resolve when the editor mounts, the doc changes (docVersion), or the ledger's
  // notes load/change (notes.notes — which is also what invalidates the resolver's
  // cache, so this is the re-prime that turns a newly-created target live). The
  // meta-only dispatch above doesn't change the doc, so it neither bumps docVersion
  // nor re-triggers this effect.
  $effect(() => {
    notes.notes;
    docVersion;
    if (editor) void refreshBrokenLinks();
  });

  function handleKeydown(e: KeyboardEvent) {
    if (previewLinkAtCaret(e)) return;
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      clearTimeout(saveTimer);
      save();
    }
  }

  // ── Image paste / drop ───────────────────────────────────────────────────────

  async function handlePaste(e: ClipboardEvent) {
    if (!editor) return;
    const files = Array.from(e.clipboardData?.files ?? []).filter(isImageFile);
    if (!files.length) return;
    e.preventDefault();
    for (const f of files) await insertImageFromHandle(f, editor);
  }

  async function handleDrop(e: DragEvent) {
    if (!editor) return;
    const files = Array.from(e.dataTransfer?.files ?? []).filter(isImageFile);
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    for (const f of files) await insertImageFromHandle(f, editor);
  }

  // ── Wiki-link interaction ────────────────────────────────────────────────────

  async function handleClick(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest<HTMLElement>("[data-wiki-link]");
    if (!link?.dataset.path) return;
    const target = stripWikiFragment(link.dataset.path);

    try {
      // Acting, not drawing: this chooses between navigating and writing a file to
      // disk, so it takes the authoritative check rather than the cached answer.
      const resolved = await linkResolver.resolve(target);
      if (resolved) {
        tabs.navigate({ type: "note", id: resolved.id, title: resolved.title });
      } else {
        await createNoteFromStub(target);
      }
    } catch {
      // no ledger open — do nothing
    }
  }

  // ── The link preview ─────────────────────────────────────────────────────────
  // Its life is the shared controller's, used by every surface that draws links; what is
  // left here is this surface's pointer and the keyboard's way in.
  const preview = createLinkPreview();
  onDestroy(() => preview.destroy());

  /**
   * Ctrl/Cmd+Shift+P: the preview of the link at the caret, or in the block field that has
   * focus. Keyboard users had no preview at all — a link in prose cannot take focus.
   */
  function previewLinkAtCaret(e: KeyboardEvent): boolean {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.key.toLowerCase() !== "p") return false;
    // A block field's value is a button holding its links; the note's own text is the
    // editor, which holds every link in the note, so it is asked by caret instead.
    // A read-only block value's link takes focus itself.
    const focused = document.activeElement as HTMLElement | null;
    let link = focused?.hasAttribute("data-wiki-link")
      ? focused
      : focused?.tagName === "BUTTON"
        ? focused.querySelector<HTMLElement>("[data-wiki-link]")
        : null;
    if (!link && editor) {
      const caret = editor.state.selection.$from;
      const at =
        caret.nodeAfter?.type.name === "wikiLink"
          ? caret.pos
          : caret.nodeBefore?.type.name === "wikiLink"
            ? caret.pos - caret.nodeBefore.nodeSize
            : null;
      const dom = at === null ? null : editor.view.nodeDOM(at);
      link = dom instanceof HTMLElement ? dom : null;
    }
    if (!link) return false;
    e.preventDefault();
    preview.openFor(link);
    return true;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_mouse_events_have_key_events -->
<div
  bind:this={element}
  onkeydown={handleKeydown}
  onpaste={handlePaste}
  ondragover={(e) => e.preventDefault()}
  ondrop={handleDrop}
  onclick={handleClick}
  onmouseover={preview.pointerOver}
  onmouseout={preview.pointerOut}
></div>

{#if slashState}
  <SlashCommandMenu state={slashState} />
{/if}

{#if editor && blockHandle.target}
  <BlockHandle {editor} target={blockHandle.target} handle={blockHandle} />
{/if}

{#if wikiState}
  <WikiLinkSuggestion
    items={wikiState.items}
    selectedIndex={wikiState.selectedIndex}
    x={wikiState.x}
    y={wikiState.y}
    anchorTop={wikiState.anchorTop}
    onSelect={wikiState.command}
    onHover={wikiState.select}
    onReposition={wikiState.reposition}
  />
{/if}

{#if preview.card}
  <WikiLinkPreview
    card={preview.card}
    allowCreate
    onPointer={preview.cardPointer}
    onOpen={(note) => {
      preview.close();
      tabs.navigate({ type: "note", id: note.id, title: note.title });
    }}
    onCreate={(path) => {
      preview.close();
      void createNoteFromStub(stripWikiFragment(path));
    }}
    onClose={preview.close}
  />
{/if}
