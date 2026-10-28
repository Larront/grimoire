<script lang="ts">
  // A scene's picture, colour and icon: the body of the Appearance popover, in the
  // Scene pane's header and on a dashboard card's menu. It was the pane's own until
  // the 2026-10 design review, when the card's "Customise" submenu — three windows,
  // one per choice, none marking the current one — was replaced by it.
  import { ImagePlus, X } from "@lucide/svelte";
  import { scenes } from "$lib/stores/scenes.svelte";
  import { Button } from "$lib/components/ui/button";
  import ColorPicker from "$lib/components/ColorPicker.svelte";
  import { storedColorHex } from "$lib/color";
  import { changeThumbnail, removeThumbnail } from "$lib/utils/thumbnail-actions";
  import { ICON_OPTIONS, DEFAULT_SCENE_ICON } from "$lib/components/panes/thumbnail-presets";
  import type { Scene } from "$lib/types/ledger";

  interface Props {
    scene: Pick<Scene, "id" | "thumbnail_path" | "thumbnail_color" | "thumbnail_icon">;
    /** Each colour as the GM drags, before it is saved. */
    oncolorinput?: (hex: string) => void;
    /** A colour saved, or cleared (`null`). */
    oncolorsaved?: (color: string | null) => void;
  }

  let { scene, oncolorinput, oncolorsaved }: Props = $props();

  async function applyColor(color: string | null) {
    try {
      await scenes.applyThumbnailColor(scene.id, color);
    } catch (e) {
      console.error("update thumbnail color failed:", e);
    } finally {
      oncolorsaved?.(color);
    }
  }

  async function applyIcon(icon: string | null) {
    try {
      await scenes.applyThumbnailIcon(scene.id, icon);
    } catch (e) {
      console.error("update thumbnail icon failed:", e);
    }
  }
</script>

<!-- Picture -->
<section class="flex flex-col gap-1.5">
  <h3 class="text-xs font-semibold text-muted-foreground">Picture</h3>
  <div class="flex gap-2">
    <Button
      data-edit-thumbnail-btn
      variant="outline"
      size="sm"
      onclick={() => changeThumbnail(scene.id)}
    >
      <ImagePlus class="size-3.5" />
      {scene.thumbnail_path ? "Change picture" : "Choose picture"}
    </Button>
    {#if scene.thumbnail_path}
      <Button
        data-remove-thumbnail-btn
        variant="ghost"
        size="sm"
        onclick={() => removeThumbnail(scene.id)}
      >
        <X class="size-3.5" />
        Remove
      </Button>
    {/if}
  </div>
</section>

<!-- Colour: any colour, picked freely, or none. Saved when the GM lets go. -->
<section class="flex flex-col gap-1.5">
  <h3 class="text-xs font-semibold text-muted-foreground">Colour</h3>
  <ColorPicker
    value={storedColorHex(scene.thumbnail_color)}
    oninput={(hex) => oncolorinput?.(hex)}
    onchange={applyColor}
  />
</section>

<!-- Icon -->
<section class="flex flex-col gap-1.5">
  <h3 class="text-xs font-semibold text-muted-foreground">Icon</h3>
  <div data-icon-picker class="grid grid-cols-6 gap-1">
    <button
      type="button"
      data-icon-btn="default"
      aria-label="Default (music note)"
      aria-pressed={!scene.thumbnail_icon}
      title="Default"
      class="flex size-9 items-center justify-center rounded-md transition-colors
             {!scene.thumbnail_icon
        ? 'bg-primary/12 text-foreground ring-1 ring-primary'
        : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'}"
      onclick={() => applyIcon(null)}
    >
      <DEFAULT_SCENE_ICON class="size-4" />
    </button>
    {#each ICON_OPTIONS as { name, label, icon: Icon } (name)}
      {@const chosen = scene.thumbnail_icon === name}
      <button
        type="button"
        data-icon-btn={name}
        aria-label={label}
        aria-pressed={chosen}
        title={label}
        class="flex size-9 items-center justify-center rounded-md transition-colors
               {chosen
          ? 'bg-primary/12 text-foreground ring-1 ring-primary'
          : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'}"
        onclick={() => applyIcon(name)}
      >
        <Icon class="size-4" />
      </button>
    {/each}
  </div>
</section>
