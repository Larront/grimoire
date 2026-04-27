<script lang="ts">
  import type { MapAnnotation, AnnotationKind } from "$lib/types/vault";
  import { Trash2, Lock, LockOpen } from "@lucide/svelte";

  interface Props {
    annotation: MapAnnotation;
    unlocked?: boolean;
    onToggleLock?: () => void;
    onUpdate: (updated: MapAnnotation) => Promise<void>;
    onDelete: (id: number) => Promise<void>;
  }

  let { annotation, unlocked = false, onToggleLock, onUpdate, onDelete }: Props = $props();

  let draftLabel = $state('');
  let saving = $state(false);
  let deleting = $state(false);

  $effect(() => {
    draftLabel = annotation.label ?? '';
  });

  async function save(patch: Partial<MapAnnotation>) {
    saving = true;
    try {
      await onUpdate({ ...annotation, ...patch });
    } finally {
      saving = false;
    }
  }

  async function handleDelete() {
    deleting = true;
    try {
      await onDelete(annotation.id);
    } finally {
      deleting = false;
    }
  }

  const KIND_LABELS: Record<AnnotationKind, string> = {
    text: 'Text Label',
    rect: 'Rectangle',
    circle: 'Circle',
  };

  const PRESET_COLORS = [
    '#e2e8f0', '#94a3b8', '#f8fafc',
    '#2dd4bf', '#38bdf8', '#a78bfa',
    '#f97316', '#fb7185', '#4ade80',
  ];
</script>

<div class="flex flex-col gap-4 p-4 flex-1 overflow-y-auto">
  <!-- Kind badge -->
  <div class="flex items-center justify-between">
    <span class="font-sans text-xs text-foreground-faint uppercase tracking-wider">
      {KIND_LABELS[annotation.kind]}
    </span>
    <div class="flex items-center gap-1">
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
      <button
        onclick={handleDelete}
        disabled={deleting}
        title="Delete annotation"
        class="p-1.5 rounded-md text-foreground-muted hover:text-danger hover:bg-danger/10
               transition-colors cursor-pointer disabled:opacity-50"
      >
        <Trash2 class="w-3.5 h-3.5" />
      </button>
    </div>
  </div>

  <!-- Label (text annotations only) -->
  {#if annotation.kind === 'text'}
    <div class="flex flex-col gap-1">
      <label
        for="ann-label"
        class="font-sans text-xs text-foreground-faint uppercase tracking-wider"
      >Label</label>
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
        class="bg-canvas border border-border rounded-lg px-3 py-1.5 font-sans text-sm
               text-foreground outline-none focus:border-accent"
        placeholder="Label text"
      />
    </div>

    <!-- Font size -->
    <div class="flex flex-col gap-1">
      <label for="ann-fontsize" class="font-sans text-xs text-foreground-faint uppercase tracking-wider">
        Font size — {annotation.font_size}px
      </label>
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
    </div>
  {:else}
    <!-- Opacity (shapes only) -->
    <div class="flex flex-col gap-1">
      <label for="ann-opacity" class="font-sans text-xs text-foreground-faint uppercase tracking-wider">
        Fill opacity — {Math.round(annotation.opacity * 100)}%
      </label>
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
    </div>

    <!-- Stroke color -->
    <div class="flex flex-col gap-1.5">
      <span class="font-sans text-xs text-foreground-faint uppercase tracking-wider">Stroke</span>
      <div class="flex flex-wrap gap-1.5 items-center">
        {#each PRESET_COLORS as c (c)}
          <button
            type="button"
            onclick={() => save({ stroke_color: c })}
            title={c}
            class="w-6 h-6 rounded-full border-2 transition-all cursor-pointer
                   {annotation.stroke_color === c ? 'border-accent scale-110' : 'border-transparent hover:border-border/60'}"
            style="background-color:{c}"
          ></button>
        {/each}
        <label title="Custom stroke color" class="w-6 h-6 rounded-full border-2 cursor-pointer overflow-hidden border-border/60 hover:border-accent/50">
          <input
            type="color"
            class="sr-only"
            value={annotation.stroke_color}
            onchange={(e) => save({ stroke_color: (e.target as HTMLInputElement).value })}
          />
        </label>
      </div>
    </div>
  {/if}

  <!-- Fill / text color -->
  <div class="flex flex-col gap-1.5">
    <span class="font-sans text-xs text-foreground-faint uppercase tracking-wider">
      {annotation.kind === 'text' ? 'Text color' : 'Fill color'}
    </span>
    <div class="flex flex-wrap gap-1.5 items-center">
      {#each PRESET_COLORS as c (c)}
        <button
          type="button"
          onclick={() => save({ color: c })}
          title={c}
          class="w-6 h-6 rounded-full border-2 transition-all cursor-pointer
                 {annotation.color === c ? 'border-accent scale-110' : 'border-transparent hover:border-border/60'}"
          style="background-color:{c}"
        ></button>
      {/each}
      <label title="Custom color" class="w-6 h-6 rounded-full border-2 cursor-pointer overflow-hidden border-border/60 hover:border-accent/50">
        <input
          type="color"
          class="sr-only"
          value={annotation.color}
          onchange={(e) => save({ color: (e.target as HTMLInputElement).value })}
        />
      </label>
    </div>
  </div>
</div>
