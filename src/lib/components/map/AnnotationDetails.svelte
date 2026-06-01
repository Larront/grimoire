<script module lang="ts">
  import type { AnnotationKind } from "$lib/types/ledger";

  export const KIND_LABELS: Record<AnnotationKind, string> = {
    text: 'Text Label',
    rect: 'Rectangle',
    circle: 'Circle',
  };
</script>

<script lang="ts">
  import type { MapAnnotation } from "$lib/types/ledger";
  import { Lock, LockOpen } from "@lucide/svelte";
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

  $effect(() => {
    draftLabel = annotation.label ?? '';
  });

  async function save(patch: Partial<MapAnnotation>) {
    await onUpdate({ ...annotation, ...patch });
  }

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
           {unlocked ? 'text-accent hover:text-accent/70' : 'text-foreground-faint hover:text-foreground-muted'}"
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
      onblur={() => {
        if (draftLabel !== (annotation.label ?? ''))
          save({ label: draftLabel || 'Label' });
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLElement).blur();
      }}
      class="w-full bg-background-subtle border border-background-border rounded-lg px-3 py-1.5
             font-mono text-[10px] text-foreground outline-none focus:border-accent"
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
      class="w-full accent-accent cursor-pointer"
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
      class="w-full accent-accent cursor-pointer"
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

<!-- Actions -->
<DetailSection label="Actions" sectionKey="actions">
  <button
    type="button"
    onclick={() => onDelete(annotation.id)}
    class="font-mono text-[10px] text-foreground-faint hover:text-error transition-colors cursor-pointer"
  >
    Delete annotation
  </button>
</DetailSection>
