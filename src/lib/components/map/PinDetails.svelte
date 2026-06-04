<script lang="ts">
  import { notes } from "$lib/stores/notes.svelte";
  import type { Note, Pin, PinCategory, PinShape } from "$lib/types/ledger";
  import { ExternalLink, Lock, LockOpen, ChevronDown } from "@lucide/svelte";
  import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
  } from "$lib/components/ui/collapsible";
  import { CURATED_ICON_COMPONENTS } from "./pinAppearance";
  import TagChipEditor from "$lib/components/TagChipEditor.svelte";
  import DetailSection from "$lib/components/DetailSection.svelte";
  import ColorSwatches from "$lib/components/ColorSwatches.svelte";

  // Controlled body (ADR-0006): all data arrives as props from the pane's
  // pin Details Source; edits leave through onUpdate / onTagsChange.
  interface Props {
    pin: Pin;
    linkedNote?: Note | null;
    unlocked?: boolean;
    pinTags?: string[];
    allTags?: string[];
    categories?: PinCategory[];
    notePreview?: string | null;
    onTagsChange?: (tags: string[]) => void;
    onToggleLock?: () => void;
    onUpdate: (pin: Pin) => Promise<void>;
    onOpenNote?: (id: number, title: string) => void;
  }

  let {
    pin,
    linkedNote,
    unlocked = false,
    pinTags = $bindable([]),
    allTags = [],
    categories = [],
    notePreview = null,
    onTagsChange,
    onToggleLock,
    onUpdate,
    onOpenNote,
  }: Props = $props();

  let draftTitle = $state("");
  let draftDescription = $state("");
  let noteSearchQuery = $state("");
  let appearanceOpen = $state(false);

  $effect(() => {
    draftTitle = pin.title;
    draftDescription = pin.description ?? "";
  });

  async function save(patch: Partial<Pin>) {
    await onUpdate({ ...pin, ...patch });
  }

  const filteredNotes = $derived(
    noteSearchQuery.trim()
      ? notes.notes.filter((n: Note) =>
          n.title.toLowerCase().includes(noteSearchQuery.toLowerCase()),
        )
      : notes.notes,
  );

  const PIN_SHAPES: PinShape[] = [
    "circle", "pin", "diamond", "headstone", "shield", "banner",
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
    "#4a90c4", "#6a9b87", "#b89a5e", "#8b3a3a",
    "#6b4e8a", "#5a6b7a", "#c4b8a0", "#3d4a52",
  ];

  const resolvedColor = $derived(pin.color ?? "#4a90c4");
</script>

<!-- Title row -->
<div class="flex items-start gap-2 pb-3">
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
    class="flex-1 min-w-0 bg-transparent font-heading text-xl font-semibold text-foreground
           border-none outline-none border-b border-transparent focus:border-primary
           pb-1 transition-colors"
    placeholder="Name this pin"
  />
  <button
    type="button"
    onclick={onToggleLock}
    title={unlocked ? "Lock pin" : "Unlock to drag"}
    class="mt-1 p-1.5 rounded-md transition-colors cursor-pointer shrink-0
           {unlocked ? 'text-primary hover:text-primary/70' : 'text-foreground-faint hover:text-foreground-muted'}"
  >
    {#if unlocked}
      <LockOpen class="w-4 h-4" />
    {:else}
      <Lock class="w-4 h-4" />
    {/if}
  </button>
</div>

<!-- Linked note -->
<DetailSection label="Linked Note" sectionKey="linked-note">
  {#if linkedNote}
    <div class="bg-background-subtle border border-background-border rounded-lg p-3 flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <span class="min-w-0 truncate font-heading text-sm font-semibold text-foreground">{linkedNote.title}</span>
        <button
          onclick={() => onOpenNote?.(linkedNote!.id, linkedNote!.title)}
          class="shrink-0 p-1 text-primary hover:text-primary/70 transition-colors cursor-pointer"
          title="Open note"
        >
          <ExternalLink class="w-3.5 h-3.5" />
        </button>
      </div>
      {#if notePreview}
        <p class="font-mono text-[10px] text-foreground-muted leading-relaxed">{notePreview}</p>
      {/if}
      <button
        onclick={() => save({ note_id: null })}
        class="font-mono text-[10px] text-error hover:text-error/70 transition-colors cursor-pointer self-start"
      >
        Unlink
      </button>
    </div>
  {:else}
    <div class="flex flex-col gap-1">
      <input
        bind:value={noteSearchQuery}
        class="bg-background-subtle border border-background-border rounded-lg px-2 py-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary"
        placeholder="Search notes…"
      />
      {#if noteSearchQuery.trim()}
        <div class="bg-background-subtle border border-background-border rounded-lg overflow-hidden max-h-36 overflow-y-auto">
          {#each filteredNotes.slice(0, 8) as n (n.id)}
            <button
              onclick={() => { save({ note_id: n.id }); noteSearchQuery = ""; }}
              class="w-full px-3 py-2 font-mono text-[10px] text-foreground text-left hover:bg-primary-subtle transition-colors cursor-pointer"
            >
              {n.title}
            </button>
          {:else}
            <p class="px-3 py-2 font-mono text-[10px] text-foreground-faint">No notes found</p>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</DetailSection>

<!-- Tags -->
<DetailSection label="Tags" sectionKey="tags">
  <TagChipEditor
    bind:tags={pinTags}
    suggestions={allTags}
    onchange={onTagsChange}
  />
</DetailSection>

<!-- Category -->
<DetailSection label="Category" sectionKey="category">
  <select
    data-slot="pin-category-select"
    value={pin.category_id?.toString() ?? ""}
    onchange={(e) => {
      const val = (e.target as HTMLSelectElement).value;
      const id = val === "" ? null : parseInt(val, 10);
      save({ category_id: id });
    }}
    class="w-full bg-background-subtle border border-background-border rounded-lg px-3 py-1.5
           font-mono text-[10px] text-foreground outline-none focus:border-primary cursor-pointer"
  >
    <option value="">Uncategorized</option>
    {#each categories as cat (cat.id)}
      <option value={cat.id.toString()}>{cat.name}</option>
    {/each}
  </select>
</DetailSection>

<!-- Description -->
<DetailSection label="Description" sectionKey="description">
  <textarea
    id="pin-description"
    bind:value={draftDescription}
    onblur={() => {
      const val = draftDescription.trim() || null;
      if (val !== pin.description) save({ description: val });
    }}
    rows={4}
    class="w-full bg-background-subtle border border-background-border rounded-lg px-3 py-2
           font-mono text-[10px] text-foreground outline-none focus:border-primary resize-none leading-relaxed"
    placeholder="Add notes about this location…"
  ></textarea>
</DetailSection>

<!-- Appearance -->
<DetailSection label="Appearance" sectionKey="appearance">
  <Collapsible bind:open={appearanceOpen}>
    <CollapsibleTrigger class="w-full flex items-center justify-between cursor-pointer">
      <span class="font-mono text-[10px] text-foreground-muted">Shape, icon, color</span>
      <ChevronDown
        class="w-3.5 h-3.5 text-foreground-faint transition-transform duration-200 {appearanceOpen ? 'rotate-180' : ''}"
      />
    </CollapsibleTrigger>

    <CollapsibleContent>
      <div class="flex flex-col gap-3 pt-3">
        <!-- Shape -->
        <div class="flex flex-col gap-1.5" data-slot="shape-section">
          <span class="font-mono text-[10px] text-foreground-faint uppercase tracking-[0.1em]">Shape</span>
          <div class="flex gap-1">
            {#each PIN_SHAPES as shape (shape)}
              <button
                type="button"
                onclick={() => save({ shape })}
                title={shape}
                class="w-9 h-9 flex items-center justify-center rounded-md border transition-colors cursor-pointer
                       {pin.shape === shape
                  ? 'border-primary bg-primary-subtle'
                  : 'border-background-border hover:border-primary/50 hover:bg-primary-subtle/50'}"
                style="color:{pin.shape === shape ? resolvedColor : 'var(--color-foreground-muted)'}"
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
        <div class="flex flex-col gap-1.5" data-slot="icon-section">
          <span class="font-mono text-[10px] text-foreground-faint uppercase tracking-[0.1em]">Icon</span>
          <div class="grid grid-cols-4 gap-1">
            {#each CURATED_ICON_COMPONENTS as [key, Component] (key)}
              <button
                type="button"
                onclick={() => save({ icon: key })}
                title={key}
                class="h-8 flex items-center justify-center rounded-md border transition-colors cursor-pointer
                       {pin.icon === key
                  ? 'border-primary bg-primary-subtle text-primary'
                  : 'border-transparent hover:border-background-border hover:bg-primary-subtle/50 text-foreground-muted'}"
              >
                <Component size={14} />
              </button>
            {/each}
          </div>
        </div>

        <!-- Color -->
        <div class="flex flex-col gap-1.5" data-slot="color-section">
          <span class="font-mono text-[10px] text-foreground-faint uppercase tracking-[0.1em]">Color</span>
          <ColorSwatches
            value={pin.color}
            presets={PRESET_COLORS}
            onchange={(color) => save({ color })}
          />
        </div>

        <!-- Reset -->
        <button
          type="button"
          onclick={() => save({ shape: null, icon: null, color: null })}
          class="font-mono text-[10px] text-foreground-faint hover:text-error transition-colors cursor-pointer self-start"
        >
          Reset to default
        </button>
      </div>
    </CollapsibleContent>
  </Collapsible>
</DetailSection>
