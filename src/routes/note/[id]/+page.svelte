<script lang="ts">
  import { tick } from "svelte";
  import { page } from "$app/state";
  import { replaceState } from "$app/navigation";
  import { invoke } from "@tauri-apps/api/core";
  import { notes } from "$lib/stores/notes.svelte";
  import { LoaderCircle } from "@lucide/svelte";
  import { parseFrontmatter, serializeFrontmatter } from "$lib/utils";
  import { breadcrumbs } from "$lib/stores/breadcrumbs.svelte";
  import { tabState } from "$lib/stores/tab-state.svelte";
  import Editor from "$lib/components/editor/Editor.svelte";

  let note = $derived(
    notes.notes.find((n) => n.id === Number(page.params.id)) ?? null,
  );

  // ── Content loading ──────────────────────────────────────────────────────
  let body = $state<string | null>(null);
  let lastMarkdown = $state<string | null>(null);
  let lastFetchedId = $state<number | null>(null);

  $effect(() => {
    if (note) tabState.lastNoteId = note.id;
  });

  $effect(() => {
    if (note && note.id !== lastFetchedId) {
      const targetId = note.id;
      lastFetchedId = targetId;
      body = null;
      invoke<string>("read_note_content", { notePath: note.path }).then((c) => {
        if (lastFetchedId !== targetId) return;
        const parsed = parseFrontmatter(c);
        body = parsed.body;
      });
    }
  });

  // ── Title editing ─────────────────────────────────────────────────────────
  let draftTitle = $state("");
  let titleInput: HTMLInputElement | undefined = $state();
  let isSavingTitle = $state(false);

  // Keep draftTitle in sync when navigating to a different note
  $effect(() => {
    if (note && !isSavingTitle) draftTitle = note.title;
  });

  $effect(() => {
    if (note) {
      breadcrumbs.set(
        note.path
          .split("/")
          .slice(0, -1)
          .map((segment) => ({ label: segment })),
      );
    } else {
      breadcrumbs.clear();
    }
    return () => breadcrumbs.clear();
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
    isSavingTitle = true;
    try {
      await invoke("update_note", {
        note: { ...note, title: trimmed, path: newPath },
      });
      await notes.load();
    } catch (e) {
      console.error("title save failed:", e);
      draftTitle = note.title;
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
      if (note) draftTitle = note.title;
      (e.target as HTMLInputElement).blur();
    }
  }

  // ── Auto-focus on new note or rename ─────────────────────────────────────
  $effect(() => {
    if (
      note &&
      (page.url.searchParams.has("new") || page.url.searchParams.has("rename"))
    ) {
      tick().then(() => {
        titleInput?.focus();
        titleInput?.select();
        replaceState(`/note/${note!.id}`, {}); // note! safe: guarded by outer if(note &&)
      });
    }
  });

  async function handleSave(markdown: string) {
    lastMarkdown = markdown;
    if (!note || isSavingTitle) return;
    try {
      await invoke("write_note_content", {
        notePath: note.path,
        content: markdown,
      });
    } catch (e) {
      console.error("content save failed:", e);
    }
  }
</script>

{#if notes.isLoading}
  <div class="flex flex-1 items-center justify-center">
    <LoaderCircle class="size-5 animate-spin text-muted-foreground" />
  </div>
{:else if !note}
  <div class="flex flex-1 items-center justify-center text-muted-foreground">
    Note not found
  </div>
{:else}
  <div class="flex flex-1 flex-col overflow-y-auto">
    <div class="w-full lg:max-w-[70%] mx-auto px-10 pt-10 pb-20">
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
        class="mt-3 mb-8 h-px bg-gradient-to-r from-primary/25 to-transparent"
      ></div>
      {#if body !== null}
        <Editor initialContent={body} onSave={handleSave} />
      {/if}
    </div>
  </div>
{/if}
