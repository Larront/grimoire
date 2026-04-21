<script lang="ts">
  import { goto } from "$app/navigation";
  import { notes } from "$lib/stores/notes.svelte";
  import type { Note, Pin } from "$lib/types/vault";
  import { ExternalLink } from "@lucide/svelte";
  import { invoke } from "@tauri-apps/api/core";

  interface Props {
    pin: Pin;
    linkedNote?: Note | null;
    onUpdate: (pin: Pin) => Promise<void>;
  }

  let { pin, linkedNote, onUpdate }: Props = $props();

  let draftTitle = $state("");
  let draftDescription = $state("");
  let notePreview = $state<string | null>(null);
  let noteSearchQuery = $state("");

  $effect(() => {
    draftTitle = pin.title;
    draftDescription = pin.description ?? "";
  });

  $effect(() => {
    const linked = linkedNote;
    if (!linked) {
      notePreview = null;
      return;
    }
    invoke<string>("read_note_content", { notePath: linked.path })
      .then((content) => {
        const stripped = content.replace(/[#*_`\[\]]/g, "").trim();
        notePreview =
          stripped.slice(0, 150) + (stripped.length > 150 ? "…" : "");
      })
      .catch(() => {
        notePreview = null;
      });
  });

  async function save(patch: Partial<Pin>) {
    try {
      await onUpdate({ ...pin, ...patch });
    } finally {
    }
  }

  const filteredNotes = $derived(
    noteSearchQuery.trim()
      ? notes.notes.filter((n: Note) =>
          n.title.toLowerCase().includes(noteSearchQuery.toLowerCase()),
        )
      : notes.notes,
  );
</script>

<div class="flex flex-col gap-4 p-4 flex-1 overflow-y-auto">
  <!-- Header -->
  <!-- svelte-ignore a11y_autofocus -->
  <input
    autofocus
    bind:value={draftTitle}
    onblur={() => {
      if (draftTitle.trim() !== pin.title)
        save({ title: draftTitle.trim() || pin.title });
    }}
    onkeydown={(e) => {
      if (e.key === "Enter") (e.target as HTMLElement).blur();
    }}
    class="w-full bg-transparent font-display text-xl font-semibold text-foreground
             border-none outline-none border-b border-transparent focus:border-accent
             pb-1 transition-colors"
    placeholder="Name this pin"
  />

  <!-- Linked note -->
  <div class="flex flex-col gap-2">
    <span
      class="font-sans text-xs text-foreground-faint uppercase tracking-wider"
      >Linked Note</span
    >
    {#if linkedNote}
      <div
        class="bg-canvas border border-border rounded-lg p-3 flex flex-col gap-2"
      >
        <div class="flex items-center justify-between">
          <span class="font-sans text-sm font-semibold text-foreground"
            >{linkedNote.title}</span
          >
          <button
            onclick={() => goto(`/note/${linkedNote!.id}`)}
            class="p-1 text-accent hover:text-accent/70 transition-colors cursor-pointer"
            title="Open note"
          >
            <ExternalLink class="w-3.5 h-3.5" />
          </button>
        </div>
        {#if notePreview}
          <p class="font-sans text-xs text-foreground-muted leading-relaxed">
            {notePreview}
          </p>
        {/if}
        <button
          onclick={() => save({ note_id: null })}
          class="font-sans text-xs text-danger hover:text-danger/70 transition-colors cursor-pointer self-start"
        >
          Unlink
        </button>
      </div>
    {:else}
      <div class="flex flex-col gap-1">
        <input
          bind:value={noteSearchQuery}
          class="bg-canvas border border-border rounded-lg px-2 py-1.5 font-sans text-xs text-foreground outline-none focus:border-accent"
          placeholder="Search notes…"
        />
        {#if noteSearchQuery.trim()}
          <div
            class="bg-canvas border border-border rounded-lg overflow-hidden max-h-36 overflow-y-auto"
          >
            {#each filteredNotes.slice(0, 8) as n (n.id)}
              <button
                onclick={() => {
                  save({ note_id: n.id });
                  noteSearchQuery = "";
                }}
                class="w-full px-3 py-2 font-sans text-sm text-foreground text-left hover:bg-accent-subtle transition-colors cursor-pointer"
              >
                {n.title}
              </button>
            {:else}
              <p class="px-3 py-2 font-sans text-xs text-foreground-faint">
                No notes found
              </p>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Description -->
  <div class="flex flex-col gap-1">
    <label
      for="pin-description"
      class="font-sans text-xs text-foreground-faint uppercase tracking-wider"
      >Description</label
    >
    <textarea
      id="pin-description"
      bind:value={draftDescription}
      onblur={() => {
        const val = draftDescription.trim() || null;
        if (val !== pin.description) save({ description: val });
      }}
      rows={4}
      class="bg-canvas border border-border rounded-lg px-3 py-2 font-sans text-sm text-foreground
               outline-none focus:border-accent resize-none leading-relaxed"
      placeholder="Add notes about this location…"
    ></textarea>
  </div>
</div>
