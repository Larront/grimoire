<script module lang="ts">
  import type { AnnotationKind } from "$lib/types/ledger";

  export const KIND_LABELS: Record<AnnotationKind, string> = {
    text: 'Text Label',
    rect: 'Rectangle',
    circle: 'Circle',
  };
</script>

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { MapAnnotation } from "$lib/types/ledger";
  import { Lock, LockOpen, Trash2 } from "@lucide/svelte";
  import DetailSection from "$lib/components/DetailSection.svelte";
  import ColorSwatches from "$lib/components/ColorSwatches.svelte";

  interface Props {
    annotation: MapAnnotation;
    unlocked?: boolean;
    onToggleLock?: () => void;
    onUpdate: (updated: MapAnnotation) => Promise<void>;
    onDelete: (id: number) => Promise<void>;
  }

  let { annotation, unlocked = false, onToggleLock, onUpdate, onDelete }: Props = $props();

  let draftLabel = $state('');

  // The row the draft was loaded from — see the same field on PinDetails: the
  // `annotation` prop is null by the time teardown runs when the panel closes
  // by deselection.
  let editing: MapAnnotation | null = null;

  $effect(() => {
    editing = annotation;
    draftLabel = annotation.label ?? '';
  });

  // Patches `editing` rather than `annotation` — see the same note on PinDetails.
  async function save(patch: Partial<MapAnnotation>) {
    if (!editing) return;
    await onUpdate({ ...editing, ...patch });
  }

  // Commits on teardown as well as on blur, for the reason and in the shape
  // PinDetails does (#201) — the label is the same kind of free-text field on
  // the same floating panel, destroyed by the same tab change.
  function commitLabel() {
    if (!editing) return;
    if (draftLabel === (editing.label ?? '')) return;
    save({ label: draftLabel || 'Label' });
  }

  onDestroy(commitLabel);

  const PRESET_COLORS = [
    '#e2e8f0', '#94a3b8', '#f8fafc',
    '#2dd4bf', '#38bdf8', '#a78bfa',
    '#f97316', '#fb7185', '#4ade80',
  ];
</script>

<!-- Kind row -->
<div class="flex items-center justify-between pb-3">
  <span class="font-mono text-[10px] text-foreground-faint uppercase tracking-[0.1em]">
    {KIND_LABELS[annotation.kind]}
  </span>
  <button
    type="button"
    onclick={onToggleLock}
    title={unlocked ? "Lock annotation" : "Unlock to drag"}
    class="p-1.5 rounded-md transition-colors cursor-pointer
           {unlocked ? 'text-primary hover:text-primary/70' : 'text-foreground-faint hover:text-foreground-muted'}"
  >
    {#if unlocked}
      <LockOpen class="w-3.5 h-3.5" />
    {:else}
      <Lock class="w-3.5 h-3.5" />
    {/if}
  </button>
</div>

{#if annotation.kind === 'text'}
  <!-- Label (text only) -->
  <DetailSection label="Label" sectionKey="label">
    <!-- svelte-ignore a11y_autofocus -->
    <input
      id="ann-label"
      autofocus
      bind:value={draftLabel}
      onblur={commitLabel}
      onkeydown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLElement).blur();
      }}
      class="w-full bg-background-subtle border border-background-border rounded-lg px-3 py-1.5
             font-mono text-[10px] text-foreground outline-none focus:border-primary"
      placeholder="Label text"
    />
  </DetailSection>

  <!-- Font size (text only) -->
  <DetailSection label="Font Size — {annotation.font_size}px" sectionKey="font-size">
    <input
      id="ann-fontsize"
      type="range"
      min="10"
      max="48"
      step="2"
      value={annotation.font_size}
      oninput={(e) => save({ font_size: Number((e.target as HTMLInputElement).value) })}
      class="w-full accent-primary cursor-pointer"
    />
  </DetailSection>
{:else}
  <!-- Opacity (shapes only) -->
  <DetailSection label="Fill Opacity — {Math.round(annotation.opacity * 100)}%" sectionKey="opacity">
    <input
      id="ann-opacity"
      type="range"
      min="0"
      max="1"
      step="0.05"
      value={annotation.opacity}
      oninput={(e) => save({ opacity: Number((e.target as HTMLInputElement).value) })}
      class="w-full accent-primary cursor-pointer"
    />
  </DetailSection>

  <!-- Stroke color (shapes only) -->
  <DetailSection label="Stroke" sectionKey="stroke">
    <ColorSwatches
      value={annotation.stroke_color}
      presets={PRESET_COLORS}
      onchange={(color) => save({ stroke_color: color })}
    />
  </DetailSection>
{/if}

<!-- Fill / text color -->
<DetailSection label={annotation.kind === 'text' ? 'Text Color' : 'Fill Color'} sectionKey="color">
  <ColorSwatches
    value={annotation.color}
    presets={PRESET_COLORS}
    onchange={(color) => save({ color })}
  />
</DetailSection>

<!--
  Actions.

  This was `font-mono text-[10px] text-foreground-faint` — the smallest, faintest text in
  the app, at roughly 2.8:1, which is the treatment DESIGN.md's Sub-AA Exception reserves
  for decorative labels and explicitly forbids on interactive elements. It was the only
  way to remove a shape from a map and it read as a caption, so it was reported as a
  missing feature rather than a hard-to-see one. Ember Error, at label size, with the
  icon DESIGN.md pairs with every destructive state.

  Still one click and no confirmation dialog, which is deliberate: DESIGN.md refuses a
  modal for this, and a mis-deleted rectangle is redrawn in a second. The keyboard route
  (Delete / Backspace on a selected shape) is wired in MapPane and is the reason a
  discoverable button here is not the only way in.
-->
<DetailSection label="Actions" sectionKey="actions">
  <button
    type="button"
    onclick={() => onDelete(annotation.id)}
    class="flex items-center gap-1.5 rounded-[6px] px-2 py-1 -mx-2 text-(--font-ui)
           text-error hover:bg-error/10 transition-colors cursor-pointer"
  >
    <Trash2 class="size-3.5 shrink-0" />
    Delete {KIND_LABELS[annotation.kind].toLowerCase()}
  </button>
</DetailSection>
