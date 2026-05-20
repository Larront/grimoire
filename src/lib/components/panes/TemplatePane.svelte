<script lang="ts">
  import { untrack } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { LoaderCircle } from "@lucide/svelte";
  import Editor from "$lib/components/editor/Editor.svelte";

  interface Props {
    templatePath: string;
    templateTitle: string;
  }
  let { templatePath, templateTitle }: Props = $props();

  let body = $state<string | null>(null);
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
        body = content;
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

  $effect(() => {
    const title = templateTitle;
    untrack(() => tabs.updateTabTitle("template", 0, title));
  });

  async function commitTitle() {
    const trimmed = draftTitle.trim();
    if (!trimmed || trimmed === templateTitle) {
      draftTitle = templateTitle;
      return;
    }
    isSavingTitle = true;
    try {
      await invoke("rename_template", { path: templatePath, newName: trimmed });
      tabs.updateTabTitle("template", 0, trimmed);
    } catch (e) {
      console.error("title save failed:", e);
      draftTitle = templateTitle;
    } finally {
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
      await invoke("write_template", { path: templatePath, content: markdown });
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
