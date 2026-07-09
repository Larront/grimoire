<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Editor } from "@tiptap/core";
  import { StarterKit } from "@tiptap/starter-kit";
  import { Markdown } from "@tiptap/markdown";
  import { api } from "$lib/api";

  import {
    ImageBlock,
    preprocessImageAttrs,
    insertImageFromHandle,
    isImageFile,
  } from "$lib/editor/image-block";
  import { SceneBlock } from "$lib/editor/scene-block.svelte";
  import { TimelineBlock, preprocessTimelineBlocks } from "$lib/editor/timeline-block";
  import { SlashCommand } from "$lib/editor/slash-command";
  import {
    WikiLink,
    preprocessWikiLinks,
    wikiBrokenLinkKey,
    parseWikiTarget,
    stripWikiFragment,
  } from "$lib/editor/wiki-link";
  import type { SlashCommandSuggestionState } from "$lib/editor/slash-command";
  import type { WikiLinkSuggestionState } from "$lib/editor/wiki-link";

  import SlashCommandMenu from "./SlashCommandMenu.svelte";
  import WikiLinkSuggestion from "./WikiLinkSuggestion.svelte";
  import WikiLinkPreview from "./WikiLinkPreview.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { pendingSaves } from "$lib/stores/pending-saves";
  import { parseFrontmatter } from "$lib/utils";

  interface Props {
    initialContent: string;
    onSave: (markdown: string) => Promise<void>;
    highlightQuery?: string;
  }

  let { initialContent, onSave, highlightQuery = "" }: Props = $props();

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
  let unregisterFlush: (() => void) | undefined;
  // Bumped on every doc edit so the broken-link resolver re-runs when links change.
  let docVersion = $state(0);

  // ── Overlay state ────────────────────────────────────────────────────────────
  let slashState = $state<SlashCommandSuggestionState | null>(null);
  let wikiState = $state<WikiLinkSuggestionState | null>(null);
  let wikiPreview = $state<{
    path: string;
    title: string;
    content: string;
    x: number;
    y: number;
  } | null>(null);
  let previewTimer: ReturnType<typeof setTimeout> | undefined;

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

    // Brief pulse on the editor element to draw attention to the selection
    const el = editorInstance.view.dom as HTMLElement;
    el.dataset.searchPulse = "1";
    setTimeout(() => delete el.dataset.searchPulse, 600);
  }

  onMount(() => {
    const preprocessed = preprocessWikiLinks(preprocessImageAttrs(preprocessTimelineBlocks(initialContent)));

    editor = new Editor({
      element,
      extensions: [
        StarterKit,
        Markdown,
        ImageBlock,
        SceneBlock,
        TimelineBlock,
        SlashCommand.configure({
          onSlashCommand: (state) => {
            slashState = state;
          },
        }),
        WikiLink.configure({
          onSuggestion: (state) => {
            wikiState = state;
          },
        }),
      ],
      content: preprocessed,
      contentType: "markdown",
      onUpdate: () => {
        docVersion++;
        dirty = true;
        if (autosavePaused) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(save, 500);
      },
    });

    // Ledger switches and window close flush through this registry; the
    // editor's own unmount flushes in onDestroy below.
    unregisterFlush = pendingSaves.register(flush);

    if (highlightQuery) {
      // Allow the editor to finish its initial render before searching
      setTimeout(() => scrollToFirstMatch(editor!, highlightQuery), 150);
    }
  });

  onDestroy(() => {
    unregisterFlush?.();
    clearTimeout(previewTimer);
    // flush() captures the markdown synchronously (before its first await),
    // so the pending edit is safe to hand off before destroying the editor.
    void flush();
    editor?.destroy();
  });

  async function save() {
    if (!editor) return;
    dirty = false;
    const run: Promise<void> = onSave(editor.getMarkdown()).finally(() => {
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
    return editor?.getMarkdown() ?? initialContent;
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
   * the editor and disk silently diverged until the next keystroke.
   */
  export function resumeAutosave(): void {
    autosavePaused = false;
    if (dirty) void save();
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

  // Resolve which wikilink targets don't exist — path miss AND alias miss, the same
  // test handleClick uses to navigate — and feed the set to the broken-link plugin so
  // stubs render faded. Unresolved-yet links stay full accent (never flash as stubs).
  function refreshBrokenLinks() {
    const ed = editor;
    if (!ed) return;
    const paths = new Set<string>();
    ed.state.doc.descendants((n) => {
      if (n.type.name === "wikiLink" && n.attrs.path) paths.add(n.attrs.path as string);
    });
    const noteList = notes.notes;
    (async () => {
      const broken = new Set<string>();
      for (const p of paths) {
        const target = stripWikiFragment(p);
        if (noteList.some((n) => n.path === target)) continue;
        const resolved = await api.resolveNoteTarget(target).catch(() => null);
        if (resolved == null) broken.add(p);
      }
      // Guard against a torn-down / swapped editor after the await.
      if (editor === ed) ed.view.dispatch(ed.state.tr.setMeta(wikiBrokenLinkKey, broken));
    })();
  }

  // Re-resolve when the editor mounts, the doc changes (docVersion), or the ledger's
  // notes load/change (notes.notes). The meta-only dispatch above doesn't change the
  // doc, so it neither bumps docVersion nor re-triggers this effect.
  $effect(() => {
    notes.notes;
    docVersion;
    if (editor) refreshBrokenLinks();
  });

  function handleKeydown(e: KeyboardEvent) {
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

  async function createNoteFromStub(path: string) {
    const { title } = parseWikiTarget(path);
    const newNote = await api.createNote(title, path, null);
    await notes.load();
    tabs.navigate({ type: "note", id: newNote.id, title: newNote.title });
  }

  async function handleClick(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest<HTMLElement>("[data-wiki-link]");
    if (!link?.dataset.path) return;
    const target = stripWikiFragment(link.dataset.path);

    const note = notes.notes.find((n) => n.path === target);
    if (note) {
      tabs.navigate({ type: "note", id: note.id, title: note.title });
      return;
    }

    try {
      const resolved = await api.resolveNoteTarget(target);
      if (resolved) {
        tabs.navigate({ type: "note", id: resolved.id, title: resolved.title });
      } else {
        await createNoteFromStub(target);
      }
    } catch {
      // no ledger open — do nothing
    }
  }

  function handleMouseover(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest<HTMLElement>("[data-wiki-link]");
    if (!link?.dataset.path) return;
    const path = link.dataset.path;
    const target = stripWikiFragment(path);
    const title = link.dataset.title ?? "";
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const note =
        notes.notes.find((n) => n.path === target) ??
        (await api.silent.resolveNoteTarget(target).catch(() => null));
      if (!note) return;
      try {
        const raw = await api.readNoteContent(note.path);
        const { body } = parseFrontmatter(raw);
        const r = link.getBoundingClientRect();
        wikiPreview = {
          path,
          title: title || note.title,
          content: body,
          x: r.left,
          y: r.bottom + 6,
        };
      } catch {
        /* unreadable — skip preview */
      }
    }, 400);
  }

  function handleMouseout(e: MouseEvent) {
    if (!(e.target as HTMLElement).closest("[data-wiki-link]")) return;
    clearTimeout(previewTimer);
    wikiPreview = null;
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
  onmouseover={handleMouseover}
  onmouseout={handleMouseout}
></div>

{#if slashState}
  <SlashCommandMenu state={slashState} />
{/if}

{#if wikiState}
  <WikiLinkSuggestion
    items={wikiState.items}
    selectedIndex={wikiState.selectedIndex}
    x={wikiState.x}
    y={wikiState.y}
    onSelect={wikiState.command}
  />
{/if}

{#if wikiPreview}
  <WikiLinkPreview {...wikiPreview} />
{/if}
