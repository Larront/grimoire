<script lang="ts">
  import { goto } from "$app/navigation";
  import { notes } from "$lib/stores/notes.svelte";
  import type { Note, Pin, PinShape } from "$lib/types/vault";
  import { ExternalLink, ChevronDown, Lock, LockOpen } from "@lucide/svelte";
  import { invoke } from "@tauri-apps/api/core";
  import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
  } from "$lib/components/ui/collapsible";
  import { CURATED_ICON_COMPONENTS } from "./pinAppearance";

  interface Props {
    pin: Pin;
    linkedNote?: Note | null;
    unlocked?: boolean;
    onToggleLock?: () => void;
    onUpdate: (pin: Pin) => Promise<void>;
  }

  let { pin, linkedNote, unlocked = false, onToggleLock, onUpdate }: Props = $props();

  let draftTitle = $state("");
  let draftDescription = $state("");
  let notePreview = $state<string | null>(null);
  let noteSearchQuery = $state("");
  let appearanceOpen = $state(false);

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

  const PIN_SHAPES: PinShape[] = [
    "circle",
    "pin",
    "diamond",
    "headstone",
    "shield",
    "banner",
  ];

  const SHAPE_PREVIEWS: Record<PinShape, string> = {
    circle: `<circle cx="8" cy="8" r="6" fill="currentColor"/>`,
    pin: `<path d="M8 15 C5 12 2 10 2 7 A6 6 0 0 1 14 7 C14 10 11 12 8 15Z" fill="currentColor"/>`,
    diamond: `<polygon points="8,2 14,8 8,14 2,8" fill="currentColor"/>`,
    headstone: `<path d="M4 15 V8 Q4 2 8 2 Q12 2 12 8 V15 Z" fill="currentColor"/>`,
    shield: `<path d="M8 2 L14 4 V10 Q14 15 8 16 Q2 15 2 10 V4 Z" fill="currentColor"/>`,
    banner: `<path d="M3 2 H13 V14 L8 11 L3 14 Z" fill="currentColor"/>`,
  };

  const PRESET_COLORS = [
    "#4a90c4",
    "#6a9b87",
    "#b89a5e",
    "#8b3a3a",
    "#6b4e8a",
    "#5a6b7a",
    "#c4b8a0",
    "#3d4a52",
  ];

  const resolvedColor = $derived(pin.color ?? "#4a90c4");
  const isCustomColor = $derived(
    !!pin.color && !PRESET_COLORS.includes(pin.color),
  );
</script>

<div class="flex flex-col gap-4 p-4 flex-1 overflow-y-auto">
  <!-- Header -->
  <div class="flex items-start gap-2">
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
      class="flex-1 bg-transparent font-display text-xl font-semibold text-foreground
               border-none outline-none border-b border-transparent focus:border-accent
               pb-1 transition-colors"
      placeholder="Name this pin"
    />
    <button
      type="button"
      onclick={onToggleLock}
      title={unlocked ? "Lock pin" : "Unlock to drag"}
      class="mt-1 p-1.5 rounded-md transition-colors cursor-pointer
             {unlocked ? 'text-accent hover:text-accent/70' : 'text-foreground-faint hover:text-foreground-muted'} shrink-0"
    >
      {#if unlocked}
        <LockOpen class="w-4 h-4" />
      {:else}
        <Lock class="w-4 h-4" />
      {/if}
    </button>
  </div>

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

  <!-- Pin Appearance collapsible -->
  <div class="border-t border-border/40 pt-3">
    <Collapsible bind:open={appearanceOpen}>
      <CollapsibleTrigger
        class="w-full flex items-center justify-between cursor-pointer group"
      >
        <span class="font-sans text-xs text-foreground-faint uppercase tracking-wider"
          >Pin Appearance</span
        >
        <ChevronDown
          class="w-3.5 h-3.5 text-foreground-faint transition-transform duration-200 {appearanceOpen
            ? 'rotate-180'
            : ''}"
        />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div class="flex flex-col gap-3 pt-3">
          <!-- Shape -->
          <div class="flex flex-col gap-1.5">
            <span
              class="font-sans text-xs text-foreground-faint uppercase tracking-wider"
              >Shape</span
            >
            <div class="flex gap-1">
              {#each PIN_SHAPES as shape (shape)}
                <button
                  type="button"
                  onclick={() => save({ shape })}
                  title={shape}
                  class="w-9 h-9 flex items-center justify-center rounded-md border transition-colors cursor-pointer
                         {pin.shape === shape
                    ? 'border-accent bg-accent-subtle'
                    : 'border-border hover:border-accent/50 hover:bg-accent-subtle/50'}"
                  style="color:{pin.shape === shape
                    ? resolvedColor
                    : 'var(--color-foreground-muted)'}"
                >
                  <svg viewBox="0 0 16 16" width="16" height="16">
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html SHAPE_PREVIEWS[shape]}
                  </svg>
                </button>
              {/each}
            </div>
          </div>

          <!-- Icon -->
          <div class="flex flex-col gap-1.5">
            <span
              class="font-sans text-xs text-foreground-faint uppercase tracking-wider"
              >Icon</span
            >
            <div class="grid grid-cols-4 gap-1">
              {#each CURATED_ICON_COMPONENTS as [key, Component] (key)}
                <button
                  type="button"
                  onclick={() => save({ icon: key })}
                  title={key}
                  class="h-8 flex items-center justify-center rounded-md border transition-colors cursor-pointer
                         {pin.icon === key
                    ? 'border-accent bg-accent-subtle text-accent'
                    : 'border-transparent hover:border-border hover:bg-accent-subtle/50 text-foreground-muted'}"
                >
                  <Component size={14} />
                </button>
              {/each}
            </div>
          </div>

          <!-- Color -->
          <div class="flex flex-col gap-1.5">
            <span
              class="font-sans text-xs text-foreground-faint uppercase tracking-wider"
              >Color</span
            >
            <div class="flex flex-wrap gap-1.5 items-center">
              {#each PRESET_COLORS as color (color)}
                <button
                  type="button"
                  onclick={() => save({ color })}
                  title={color}
                  class="w-6 h-6 rounded-full border-2 transition-all cursor-pointer
                         {pin.color === color
                    ? 'border-accent scale-110'
                    : 'border-transparent hover:border-border/60'}"
                  style="background-color:{color}"
                ></button>
              {/each}
              <!-- Custom color -->
              <label
                title="Custom color"
                class="w-6 h-6 rounded-full border-2 cursor-pointer flex items-center justify-center overflow-hidden
                       {isCustomColor
                  ? 'border-accent scale-110'
                  : 'border-border/60 hover:border-accent/50 bg-canvas'}"
                style={isCustomColor ? `background-color:${pin.color}` : ""}
              >
                {#if !isCustomColor}
                  <span class="font-sans text-foreground-faint text-xs leading-none select-none">+</span>
                {/if}
                <input
                  type="color"
                  class="sr-only"
                  value={pin.color ?? "#4a90c4"}
                  onchange={(e) =>
                    save({ color: (e.target as HTMLInputElement).value })}
                />
              </label>
            </div>
          </div>

          <!-- Reset -->
          <button
            type="button"
            onclick={() => save({ shape: null, icon: null, color: null })}
            class="font-sans text-xs text-foreground-faint hover:text-danger transition-colors cursor-pointer self-start"
          >
            Reset to default
          </button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  </div>
</div>
