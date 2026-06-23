<!-- src/lib/components/panes/SceneLinkBubble.svelte
     The inline hover toolbar for a PDF Scene-link: Play/Stop the linked Scene,
     show its name (click → open in Scenes), and Remove the link. Master volume /
     re-link / new-scene from the design's full toolbar are deferred — this slice
     is the play-and-manage loop the acceptance criteria call for. -->
<script lang="ts">
  import { Play, Square, Trash2, Music2 } from "@lucide/svelte";
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { ICON_MAP, ACCENT_BG, ACCENT_FG } from "./thumbnail-presets";
  import type { SceneWithCount } from "$lib/types/ledger";

  let {
    scene,
    onRemove,
  }: {
    scene: SceneWithCount;
    onRemove: () => void;
  } = $props();

  const isPlaying = $derived(audioEngine.isScenePlaying(scene.id));
  const chipBg = $derived(scene.thumbnail_color ?? ACCENT_BG[scene.id % ACCENT_BG.length]);
  const chipFg = $derived(ACCENT_FG[scene.id % ACCENT_FG.length]);
  const ChipIcon = $derived(scene.thumbnail_icon ? (ICON_MAP[scene.thumbnail_icon] ?? Music2) : Music2);

  function togglePlay() {
    if (isPlaying) audioEngine.stopAll();
    else audioEngine.playScene(scene.id);
  }

  function openScene() {
    tabs.openTab({ type: "scene", id: scene.id, title: scene.name });
  }
</script>

<div
  class="flex items-center gap-1.5 rounded-lg border border-border bg-popover px-1.5 py-1 shadow-md"
  role="toolbar"
  aria-label="Scene-link controls"
>
  <button
    type="button"
    onclick={togglePlay}
    class="flex size-6 shrink-0 items-center justify-center rounded-sm hover:bg-muted transition-colors"
    aria-label={isPlaying ? `Stop ${scene.name}` : `Play ${scene.name}`}
  >
    {#if isPlaying}
      <Square class="size-3 text-foreground" />
    {:else}
      <Play class="size-3.5 text-muted-foreground" />
    {/if}
  </button>

  <span
    class="flex size-5 shrink-0 items-center justify-center rounded-sm"
    style="background-color: {chipBg}"
    aria-hidden="true"
  >
    <ChipIcon class="size-3" style="color: {chipFg}" strokeWidth={1.75} />
  </span>

  <button
    type="button"
    onclick={openScene}
    class="max-w-40 truncate font-heading text-xs text-muted-foreground hover:text-foreground transition-colors"
    aria-label="Open {scene.name} in Scenes"
  >
    {scene.name}
  </button>

  <div class="mx-0.5 h-4 w-px bg-border"></div>

  <button
    type="button"
    onclick={onRemove}
    class="flex size-6 shrink-0 items-center justify-center rounded-sm hover:bg-muted transition-colors"
    aria-label="Remove Scene-link"
  >
    <Trash2 class="size-3 text-muted-foreground" />
  </button>
</div>
