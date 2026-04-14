<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Editor } from "@tiptap/core";
  import { StarterKit } from "@tiptap/starter-kit";
  import { Markdown } from "@tiptap/markdown";
  import { goto } from "$app/navigation";
  import { invoke } from "@tauri-apps/api/core";

  import {
    ImageBlock,
    preprocessImageAttrs,
    insertImageFromHandle,
    isImageFile,
  } from "$lib/editor/image-block";
  import { SceneBlock } from "$lib/editor/scene-block.svelte";
  import { SlashCommand } from "$lib/editor/slash-command";
  import { WikiLink, preprocessWikiLinks } from "$lib/editor/wiki-link";
  import type { SlashCommandSuggestionState } from "$lib/editor/slash-command";
  import type { WikiLinkSuggestionState } from "$lib/editor/wiki-link";

  import SlashCommandMenu from "./SlashCommandMenu.svelte";
  import WikiLinkSuggestion from "./WikiLinkSuggestion.svelte";
  import WikiLinkPreview from "./WikiLinkPreview.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { parseFrontmatter } from "$lib/utils";

  interface Props {
    initialContent: string;
    onSave: (markdown: string) => Promise<void>;
  }

  let { initialContent, onSave }: Props = $props();

  let element = $state<HTMLDivElement>();
  let editor = $state<Editor | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

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

  onMount(() => {
    const preprocessed = preprocessWikiLinks(preprocessImageAttrs(initialContent));

    editor = new Editor({
      element,
      extensions: [
        StarterKit,
        Markdown,
        ImageBlock,
        SceneBlock,
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
        clearTimeout(saveTimer);
        saveTimer = setTimeout(save, 500);
      },
    });
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

  function handleClick(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest<HTMLElement>("[data-wiki-link]");
    if (!link?.dataset.path) return;
    const note = notes.notes.find((n) => n.path === link.dataset.path);
    if (note) goto(`/note/${note.id}`);
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
