<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { templates } from "$lib/stores/templates.svelte";
  import { parseFrontmatter, serializeFrontmatter } from "$lib/utils";
  import { LoaderCircle } from "@lucide/svelte";
  import Editor from "$lib/components/editor/Editor.svelte";

  interface Props {
    templatePath: string;
    templateTitle: string;
  }
  let { templatePath, templateTitle }: Props = $props();

  let body = $state<string | null>(null);
  let frontmatterTags = $state<string[]>([]);
  let lastFetchedPath = $state<string | null>(null);
  let isLoading = $state(false);

  $effect(() => {
    if (templatePath !== lastFetchedPath) {
      const targetPath = templatePath;
      lastFetchedPath = targetPath;
      body = null;
      isLoading = true;
      invoke<string>("read_template", { path: targetPath }).then((content) => {
        if (lastFetchedPath !== targetPath) return;
        const parsed = parseFrontmatter(content);
        frontmatterTags = parsed.tags;
        body = parsed.body;
        isLoading = false;
      }).catch((e) => {
        console.error("read_template failed:", e);
        body = "";
        isLoading = false;
      });
    }
  });

  let draftTitle = $state("");
  let isSavingTitle = $state(false);

  $effect(() => {
    if (!isSavingTitle) draftTitle = templateTitle;
  });

  async function commitTitle() {
    const trimmed = draftTitle.trim();
    if (!trimmed || trimmed === templateTitle) {
      draftTitle = templateTitle;
      return;
    }
    isSavingTitle = true;
    const currentPath = templatePath;
    try {
      await invoke("rename_template", { path: currentPath, newName: trimmed });
      const newPath = currentPath.replace(/[^/]+\.md$/, `${trimmed}.md`);
      tabs.updateTemplateTab(currentPath, trimmed, newPath);
      await templates.load();
    } catch (e) {
      console.error("title save failed:", e);
      draftTitle = templateTitle;
      isSavingTitle = false;
    }
  }

  function handleTitleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
    if (e.key === "Escape") {
      draftTitle = templateTitle;
      (e.target as HTMLInputElement).blur();
    }
  }

  async function handleSave(markdown: string) {
    if (isSavingTitle) return;
    try {
      const content = serializeFrontmatter(frontmatterTags, markdown);
      await invoke("write_template", { path: templatePath, content });
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
    <div class="w-full mx-auto px-6 pt-10 pb-20 @5xl:max-w-[70%] @5xl:px-10">
      <input
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
      {#if body !== null}
        <Editor initialContent={body} onSave={handleSave} />
      {/if}
    </div>
  </div>
{/if}
