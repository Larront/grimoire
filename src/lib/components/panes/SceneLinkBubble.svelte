<!-- src/lib/components/panes/SceneLinkBubble.svelte
     The inline hover toolbar for a PDF Scene-link (issue #104): Play/Stop the
     linked Scene (reflecting active state), adjust global master volume, show the
     Scene's name (click → open it in Scenes), re-link to a different Scene via a
     change-dropdown (the same searchable picker, including ＋ New scene), and
     Remove the link. Master volume is global (no per-link override). -->
<script lang="ts">
  import { Play, Square, Trash2, Volume2, ChevronDown } from "@lucide/svelte";
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { sceneIcon, sceneLinkHue } from "./thumbnail-presets";
  import { wash } from "$lib/color";
  import ScenePicker from "./ScenePicker.svelte";
  import VolumeSlider from "$lib/components/VolumeSlider.svelte";
  import type { SceneWithCount } from "$lib/types/ledger";

  let {
    scene,
    onChangeScene,
    onNewScene,
    onRemove,
  }: {
    scene: SceneWithCount;
    onChangeScene: (sceneId: number) => void;
    onNewScene: () => void;
    onRemove: () => void;
  } = $props();

  const isPlaying = $derived(audioEngine.isScenePlaying(scene.id));
  // The chip pairs with the underline on the page: the same hue, as a wash behind the
  // icon and in the icon itself.
  const hue = $derived(sceneLinkHue(scene));
  const chipBg = $derived(wash(hue, 0.18));
  const chipFg = $derived(hue);
  const ChipIcon = $derived(sceneIcon(scene));

  let changeOpen = $state(false);

  function togglePlay() {
    if (isPlaying) audioEngine.stopAll();
    else audioEngine.playScene(scene.id);
  }

  function openScene() {
    tabs.openTab({ type: "scene", id: scene.id, title: scene.name });
  }

  function changeScene(sceneId: number) {
    changeOpen = false;
    onChangeScene(sceneId);
  }

  function newScene() {
    changeOpen = false;
    onNewScene();
  }
</script>

<div class="relative">
  <div
    class="flex items-center gap-1.5 rounded-lg border border-border bg-popover px-1.5 py-1"
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
      class="max-w-40 truncate text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      aria-label="Open {scene.name} in Scenes"
    >
      {scene.name}
    </button>

    <!-- Change-Scene dropdown: same searchable picker, re-links this span. -->
    <button
      type="button"
      onclick={() => (changeOpen = !changeOpen)}
      class="flex size-6 shrink-0 items-center justify-center rounded-sm hover:bg-muted transition-colors"
      aria-label="Change Scene"
      aria-expanded={changeOpen}
    >
      <ChevronDown class="size-3.5 text-muted-foreground" />
    </button>

    <div class="mx-0.5 h-4 w-px bg-border"></div>

    <!-- Master volume (global; no per-link override). -->
    <Volume2 class="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
    <VolumeSlider
      value={audioEngine.masterVolume}
      label="Master volume"
      active={audioEngine.isPlaying}
      oninput={(v) => audioEngine.setMasterVolume(v)}
    />

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

  {#if changeOpen}
    <div class="absolute left-0 top-full z-20 mt-1">
      <ScenePicker onSelect={changeScene} onNewScene={newScene} />
    </div>
  {/if}
</div>
