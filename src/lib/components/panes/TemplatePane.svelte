<script lang="ts">
  /*
    A template being written: its name, the tags it gives a new note, and its text.

    Revised in the 2026-10 design review. A template's tags are half of what it does
    — a note made from it starts with them — yet the pane hid them and wrote them back
    blind, so a template made in the app could never have any. They sit under the
    name now, said as what they are for. Saves are body-only, as a note's are: the
    frontmatter stays on disk, so keys this pane doesn't show (a note's aliases,
    carried over by "Save note as template") survive an edit.
  */
  import { api, friendlyMessage } from "$lib/api";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { templates } from "$lib/stores/templates.svelte";
  import { parseFrontmatter } from "$lib/utils";
  import { nameProblem } from "$lib/utils/file-name";
  import { CircleX, LoaderCircle } from "@lucide/svelte";
  import Editor from "$lib/components/editor/Editor.svelte";
  import TagChipEditor from "$lib/components/TagChipEditor.svelte";

  interface Props {
    templatePath: string;
    templateTitle: string;
    /** Just made, already named in the Templates dialog: start in its text. Carried
     *  on the tab's `rename` flag, which a new note uses to start in its name. */
    fresh?: boolean;
    pane: "left" | "right";
    tabIndex: number;
  }
  let { templatePath, templateTitle, fresh = false, pane, tabIndex }: Props = $props();

  let column = $state<HTMLElement | null>(null);

  $effect(() => {
    if (!fresh || body === null || !column) return;
    const el = column;
    // The editor builds its view after mounting; wait a frame for it to exist.
    requestAnimationFrame(() => {
      el.querySelector<HTMLElement>(".ProseMirror")?.focus();
      tabs.clearRenameFlag(pane, tabIndex);
    });
  });

  let body = $state<string | null>(null);
  let tags = $state<string[]>([]);
  let allTags = $state<string[]>([]);
  let lastFetchedPath = $state<string | null>(null);
  let isLoading = $state(false);

  $effect(() => {
    if (templatePath !== lastFetchedPath) {
      const targetPath = templatePath;
      lastFetchedPath = targetPath;
      body = null;
      isLoading = true;
      api
        .readTemplate(targetPath)
        .then((content) => {
          if (lastFetchedPath !== targetPath) return;
          const parsed = parseFrontmatter(content);
          tags = parsed.tags;
          body = parsed.body;
          isLoading = false;
        })
        .catch((e) => {
          console.error("read_template failed:", e);
          body = "";
          isLoading = false;
        });
      api
        .listAllTags()
        .then((t) => (allTags = t ?? []))
        .catch(() => (allTags = []));
    }
  });

  async function onTagsChange(next: string[]) {
    try {
      await api.writeTemplateTags(templatePath, next);
    } catch (e) {
      console.error("write_template_tags failed:", e);
    }
  }

  let draftTitle = $state("");
  let isSavingTitle = $state(false);
  /** Why the typed name wasn't taken. It stays typed, with this under it. */
  let titleRefused = $state<string | null>(null);

  $effect(() => {
    if (!isSavingTitle && !titleRefused) draftTitle = templateTitle;
  });

  async function commitTitle() {
    const trimmed = draftTitle.trim();
    if (!trimmed || trimmed === templateTitle) {
      draftTitle = templateTitle;
      titleRefused = null;
      return;
    }
    const problem = nameProblem(trimmed);
    if (problem) {
      titleRefused = problem;
      return;
    }
    isSavingTitle = true;
    const currentPath = templatePath;
    try {
      // Quiet surface: a refusal is said under the name, not in a toast.
      await api.silent.renameTemplate(currentPath, trimmed);
      titleRefused = null;
      const newPath = currentPath.replace(/[^/]+\.md$/, `${trimmed}.md`);
      tabs.updateTemplateTab(currentPath, trimmed, newPath);
      await templates.load();
    } catch (e) {
      titleRefused = friendlyMessage(e);
      isSavingTitle = false;
    }
  }

  function handleTitleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      const input = e.target as HTMLInputElement;
      input.blur();
      // On into the text, as a note's title does.
      input.closest("[data-note-column]")?.querySelector<HTMLElement>(".ProseMirror")?.focus();
    }
    if (e.key === "Escape") {
      draftTitle = templateTitle;
      titleRefused = null;
      (e.target as HTMLInputElement).blur();
    }
  }

  async function handleSave(markdown: string) {
    if (isSavingTitle) return;
    try {
      await api.writeTemplate(templatePath, markdown);
    } catch (e) {
      console.error("content save failed:", e);
    }
  }
</script>

{#if isLoading}
  <div class="flex flex-1 items-center justify-center">
    <LoaderCircle class="size-5 animate-spin text-muted-foreground" />
  </div>
{:else}
  <!-- Single scroll container: title scrolls with the editor; scrollbar sits at pane edge.
       @container lets the inner content respond to the pane's own width, so split panes
       get tighter margins than the wide single-pane layout. -->
  <div
    data-template-scroll
    class="@container h-[calc(100svh_-_var(--tab-bar-h)_-_1px)] overflow-y-auto"
  >
    <!-- A template is a note being written, so it gets the note's column and with it the
         block gutter (#190) — see `[data-note-column]` in app.css. -->
    <div bind:this={column} data-note-column class="w-full mx-auto pt-10 pb-20 max-w-[46rem]">
      <input
        bind:value={draftTitle}
        aria-label="Template name"
        aria-invalid={!!titleRefused}
        aria-describedby="template-title-problem"
        title={draftTitle}
        class="w-full bg-transparent border-none outline-none p-0
               font-heading text-[2.75rem] leading-[1.15] tracking-tight text-ellipsis
               text-foreground placeholder:text-muted-foreground/40 focus:ring-0"
        placeholder="Name the template"
        onblur={commitTitle}
        onkeydown={handleTitleKeydown}
      />
      <p id="template-title-problem" aria-live="polite" class="text-(length:--font-ui)">
        {#if titleRefused}
          <span class="mt-2 inline-flex items-center gap-1.5 text-error">
            <CircleX size={14} class="shrink-0" />
            {titleRefused}
          </span>
          <span class="text-foreground-muted">· Esc puts the old name back.</span>
        {/if}
      </p>
      <!-- What the template gives besides its text, said as what it is for. -->
      <div class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5" data-testid="template-tags">
        <span class="text-xs font-semibold text-foreground-muted">Tags for new notes</span>
        <div class="min-w-48 flex-1">
          <TagChipEditor bind:tags suggestions={allTags} onchange={onTagsChange} />
        </div>
      </div>
      <div class="mt-3 mb-8 h-px bg-border"></div>
      {#if body !== null}
        <Editor initialContent={body} onSave={handleSave} />
      {/if}
    </div>
  </div>
{/if}
