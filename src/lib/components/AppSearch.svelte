<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { Search, Tag } from "@lucide/svelte";
  import * as Command from "$lib/components/ui/command";
  import * as Dialog from "$lib/components/ui/dialog";
  import TagChipEditor from "./TagChipEditor.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { notes } from "$lib/stores/notes.svelte";

  let open = $state(false);
  let addTagOpen = $state(false);
  let tags = $state<string[]>([]);
  let allTags = $state<string[]>([]);
  let loadedForPath = $state<string | null>(null);

  const isMac = $derived(
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform),
  );

  const activeTabIsNote = $derived(tabs.activeTab?.type === "note");

  const activeNote = $derived.by(() => {
    const t = tabs.activeTab;
    if (!t || t.type !== "note") return null;
    return notes.notes.find((n) => n.id === t.id) ?? null;
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "k" && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      open = true;
    }
  }

  function openAddTag() {
    open = false;
    addTagOpen = true;
  }

  $effect(() => {
    if (!addTagOpen) {
      loadedForPath = null;
      tags = [];
      return;
    }
    const note = activeNote;
    if (!note) return;
    const path = note.path;
    if (path === loadedForPath) return;
    loadedForPath = path;
    invoke<string[]>("read_note_tags", { notePath: path })
      .then((loaded) => {
        if (loadedForPath === path) tags = loaded;
      })
      .catch(() => {
        tags = [];
      });
    invoke<string[]>("list_all_tags")
      .then((t) => {
        allTags = t ?? [];
      })
      .catch(() => {
        allTags = [];
      });
  });

  async function onTagsChange(next: string[]) {
    const note = activeNote;
    if (!note) return;
    try {
      await invoke("write_note_tags", { notePath: note.path, tags: next });
    } catch (e) {
      console.error("write_note_tags failed:", e);
    }
    addTagOpen = false;
  }
</script>

<svelte:window onkeydown={onKeydown} />

<Command.Dialog bind:open>
  <Command.Input placeholder="Type a command or search..." />
  <Command.List>
    <Command.Empty>No results found.</Command.Empty>
    {#if activeTabIsNote}
      <Command.Group heading="Actions">
        <Command.Item data-testid="cmd-add-tag" onSelect={openAddTag}>
          <Tag class="size-4 shrink-0 text-muted-foreground" />
          Add tag
        </Command.Item>
      </Command.Group>
    {/if}
  </Command.List>
</Command.Dialog>

<Dialog.Root bind:open={addTagOpen}>
  <Dialog.Content showCloseButton={false}>
    <Dialog.Header class="sr-only">
      <Dialog.Title>Add tag</Dialog.Title>
      <Dialog.Description>Add a tag to the active note.</Dialog.Description>
    </Dialog.Header>
    <div data-testid="add-tag-picker" class="space-y-3">
      <p class="text-sm font-medium">
        Add tag{activeNote ? ` to "${activeNote.title}"` : ""}
      </p>
      <TagChipEditor bind:tags suggestions={allTags} onchange={onTagsChange} />
    </div>
  </Dialog.Content>
</Dialog.Root>

<div
  data-testid="app-search-bar"
  class="relative flex items-center justify-between gap-3 mx-3 mb-1 mt-2 h-(--row-h) px-(--pad-x)
         bg-muted text-muted-foreground rounded-lg text-(--font-ui) font-normal
         cursor-pointer whitespace-nowrap select-none
         hover:bg-sidebar-accent hover:text-foreground transition-colors duration-100"
>
  <span class="flex items-center gap-1.5">
    <Search class="w-3.5 h-3.5 shrink-0" />
    Search vault…
  </span>
  <kbd
    class="pointer-events-none inline-flex h-4 select-none items-center gap-0.5
           rounded border border-border bg-sidebar px-1 font-mono text-[10px] opacity-60"
  >
    <span>{isMac ? "⌘" : "Ctrl"} + K</span>
  </kbd>
</div>
