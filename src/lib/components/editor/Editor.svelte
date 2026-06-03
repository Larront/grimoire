<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Editor } from "@tiptap/core";
  import { StarterKit } from "@tiptap/starter-kit";
  import { Markdown } from "@tiptap/markdown";
  import { invoke } from "@tauri-apps/api/core";

  import {
    ImageBlock,
    preprocessImageAttrs,
    insertImageFromHandle,
    isImageFile,
  } from "$lib/editor/image-block";
  import { SceneBlock } from "$lib/editor/scene-block.svelte";
  import { TimelineBlock, preprocessTimelineBlocks } from "$lib/editor/timeline-block";
  import { SlashCommand } from "$lib/editor/slash-command";
  import { WikiLink, preprocessWikiLinks, wikiBrokenLinkKey } from "$lib/editor/wiki-link";
  import type { SlashCommandSuggestionState } from "$lib/editor/slash-command";
  import type { WikiLinkSuggestionState } from "$lib/editor/wiki-link";

  import SlashCommandMenu from "./SlashCommandMenu.svelte";
  import WikiLinkSuggestion from "./WikiLinkSuggestion.svelte";
  import WikiLinkPreview from "./WikiLinkPreview.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
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
        clearTimeout(saveTimer);
        saveTimer = setTimeout(save, 500);
      },
    });

    if (highlightQuery) {
      // Allow the editor to finish its initial render before searching
      setTimeout(() => scrollToFirstMatch(editor!, highlightQuery), 150);
    }
  });

  onDestroy(() => {
    clearTimeout(saveTimer);
    clearTimeout(previewTimer);
    editor?.destroy();
  });

  async function save() {
    if (!editor) return;
    await onSave(editor.getMarkdown());
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
        if (noteList.some((n) => n.path === p)) continue;
        const resolved = await invoke("resolve_note_by_alias", { alias: p }).catch(() => null);
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

  async function handleClick(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest<HTMLElement>("[data-wiki-link]");
    if (!link?.dataset.path) return;
    const path = link.dataset.path;

    const note = notes.notes.find((n) => n.path === path);
    if (note) {
      tabs.navigate({ type: "note", id: note.id, title: note.title });
      return;
    }

    try {
      const resolved = await invoke<{ id: number; title: string; path: string } | null>(
        "resolve_note_by_alias",
        { alias: path },
      );
      if (resolved) tabs.navigate({ type: "note", id: resolved.id, title: resolved.title });
    } catch {
      // stub note or no ledger open — do nothing
    }
  }

  function handleMouseover(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest<HTMLElement>("[data-wiki-link]");
    if (!link?.dataset.path) return;
    const path = link.dataset.path;
    const title = link.dataset.title ?? "";
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const note = notes.notes.find((n) => n.path === path);
      if (!note) return;
      try {
        const raw = await invoke<string>("read_note_content", { notePath: path });
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
