<script lang="ts">
  interface Props {
    value?: string | null;
    presets: readonly string[];
    onchange: (color: string) => void;
  }

  let { value = null, presets, onchange }: Props = $props();

  const isCustom = $derived(!!value && !presets.includes(value));
</script>

<div data-slot="color-swatches" class="flex flex-wrap gap-1.5 items-center">
  {#each presets as color (color)}
    <button
      type="button"
      onclick={() => onchange(color)}
      title={color}
      class="w-6 h-6 rounded-full border-2 transition-[border-color,transform] cursor-pointer
             {value === color
        ? 'border-primary scale-110'
        : 'border-transparent hover:border-background-border'}"
      style="background-color:{color}"
    ></button>
  {/each}
  <label
    title="Custom color"
    class="w-6 h-6 rounded-full border-2 cursor-pointer flex items-center justify-center overflow-hidden
           {isCustom
      ? 'border-primary scale-110'
      : 'border-background-border hover:border-primary/50 bg-background-subtle'}"
    style={isCustom ? `background-color:${value}` : ""}
  >
    {#if !isCustom}
      <span class="font-mono text-foreground-faint text-xs leading-none select-none">+</span>
    {/if}
    <!-- The native picker has to open ON something, and with nothing chosen that was a
         hardcoded cold blue belonging to no palette in the app (#222). The row's own
         first swatch is the honest answer: it is where the entity started, so opening
         the custom picker no longer proposes a colour the GM could not have reached. -->
    <input
      type="color"
      class="sr-only"
      value={value ?? presets[0]}
      onchange={(e) => onchange((e.target as HTMLInputElement).value)}
    />
  </label>
</div>
