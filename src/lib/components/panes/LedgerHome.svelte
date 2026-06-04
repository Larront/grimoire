<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { ledger } from "$lib/stores/ledger.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { searchPalette } from "$lib/stores/search.svelte";
  import { invoke } from "@tauri-apps/api/core";
  import type { Note } from "$lib/types/ledger";
  import { LoaderCircle } from "@lucide/svelte";

  let isCreatingNote = $state(false);
  let errorMsg = $state<string | null>(null);

  const ledgerName = $derived(ledger.path?.split(/[\\/]/).pop() ?? "My Ledger");

  async function handleCreateFirstNote() {
    isCreatingNote = true;
    errorMsg = null;
    try {
      const newNote = await invoke<Note>("create_note", {
        noteTitle: "Untitled",
        notePath: "Untitled.md",
        noteParentPath: null,
      });
      await notes.load();
      tabs.openTab({
        type: "note",
        id: newNote.id,
        title: "Untitled",
        rename: true,
      });
    } catch (e) {
      errorMsg = String(e);
    } finally {
      isCreatingNote = false;
    }
  }
</script>

<!-- ── Ledger home (new, empty ledger) ─────────────────────────────── -->
<div class="flex flex-col items-center justify-center h-full">
  <div
    class="flex flex-col items-center gap-8 w-full max-w-120 px-10 splash-fade"
  >
    <h1
      class="font-heading text-[2rem] font-normal text-foreground text-center leading-tight"
    >
      {ledgerName}
    </h1>

    <div class="flex flex-col items-center gap-6">
      <p class="font-sans text-sm italic text-foreground-muted text-center">
        Every world begins with its first note.
      </p>
      <Button
        onclick={handleCreateFirstNote}
        disabled={isCreatingNote}
        class="gap-2"
      >
        {#if isCreatingNote}
          <LoaderCircle class="w-3.5 h-3.5 animate-spin" />
          Creating...
        {:else}
          New note
        {/if}
      </Button>
      <button
        data-testid="start-from-template"
        onclick={() => {
          searchPalette.open = true;
          searchPalette.openToTemplatePicker = true;
        }}
        class="font-sans text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        …or start from a template
      </button>
    </div>

    {#if errorMsg}
      <p class="font-sans text-xs text-destructive text-center" role="alert">
        {errorMsg}
      </p>
    {/if}
  </div>
</div>
