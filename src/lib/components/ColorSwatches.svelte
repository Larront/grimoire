<script lang="ts">
  interface Props {
    value?: string | null;
    presets?: string[];
    onchange: (color: string) => void;
  }

  const DEFAULT_PRESETS = [
    "#4a90c4", "#6a9b87", "#b89a5e", "#8b3a3a",
    "#6b4e8a", "#5a6b7a", "#c4b8a0", "#3d4a52",
  ];

  let { value = null, presets = DEFAULT_PRESETS, onchange }: Props = $props();

  const isCustom = $derived(!!value && !presets.includes(value));
</script>

<div data-slot="color-swatches" class="flex flex-wrap gap-1.5 items-center">
  {#each presets as color (color)}
    <button
      type="button"
      onclick={() => onchange(color)}
      title={color}
      class="w-6 h-6 rounded-full border-2 transition-all cursor-pointer
             {value === color ? 'border-accent scale-110' : 'border-transparent hover:border-background-border'}"
      style="background-color:{color}"
    ></button>
  {/each}
  <label
    title="Custom color"
    class="w-6 h-6 rounded-full border-2 cursor-pointer flex items-center justify-center overflow-hidden
           {isCustom ? 'border-accent scale-110' : 'border-background-border hover:border-accent/50 bg-background-subtle'}"
    style={isCustom ? `background-color:${value}` : ""}
  >
    {#if !isCustom}
      <span class="font-mono text-foreground-faint text-xs leading-none select-none">+</span>
    {/if}
    <input
      type="color"
      class="sr-only"
      value={value ?? "#4a90c4"}
      onchange={(e) => onchange((e.target as HTMLInputElement).value)}
    />
  </label>
</div>
