<!-- src/lib/components/panes/SceneLinkBubble.svelte
     The toolbar a PDF Scene-link opens on hover or focus (issue #104): Play/Stop the
     linked Scene, master volume, the Scene's name (click → open it beside the PDF),
     re-link to a different Scene via a change-dropdown (the same searchable picker,
     including ＋ New scene), and Remove the link. Master volume is global (no per-link
     override). Floating level: popover, border, `shadow-float`. -->
<script lang="ts">
  import { Play, Square, Trash2, Volume2, ChevronDown, TriangleAlert } from "@lucide/svelte";
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { sceneIcon, sceneLinkHue } from "./thumbnail-presets";
  import { wash } from "$lib/color";
  import ScenePicker from "./ScenePicker.svelte";
  import VolumeSlider from "$lib/components/VolumeSlider.svelte";
  import type { SceneWithCount } from "$lib/types/ledger";

  let {
    scene,
    drifted = false,
    onChangeScene,
    onNewScene,
    onRemove,
  }: {
    scene: SceneWithCount;
    /** The passage under this link no longer matches what was linked. */
    drifted?: boolean;
    onChangeScene: (sceneId: number) => void;
    onNewScene: (name: string) => void;
    onRemove: () => void;
  } = $props();

  const sceneState = $derived(audioEngine.sceneState(scene.id));
  const isPlaying = $derived(sceneState === "playing");
  const isEmpty = $derived(scene.slot_count === 0);
  // The chip pairs with the underline on the page: the same hue, as a wash behind the
  // icon and in the icon itself.
  const hue = $derived(sceneLinkHue(scene));
  const ChipIcon = $derived(sceneIcon(scene));

  let changeOpen = $state(false);

  function togglePlay() {
    if (isPlaying) audioEngine.stopAll();
    else if (sceneState === "paused") void audioEngine.resumeScene();
    else if (!isEmpty) void audioEngine.playScene(scene.id);
  }

  // Beside the PDF, not instead of it: opening the scene in this pane replaced the PDF
  // tab with no history, so tweaking a track mid-session lost the adventure and the
  // GM's place in it.
  function openScene() {
    tabs.openTabOpposite({ type: "scene", id: scene.id, title: scene.name });
  }

  function changeScene(sceneId: number) {
    changeOpen = false;
    onChangeScene(sceneId);
  }

  function newScene(name: string) {
    changeOpen = false;
    onNewScene(name);
  }
</script>

<div class="relative">
  <div
    class="flex flex-col rounded-lg border border-border bg-popover shadow-float"
    role="toolbar"
    aria-label="Scene-link controls"
  >
    <div class="flex items-center gap-1.5 px-1.5 py-1">
      <button
        type="button"
        onclick={togglePlay}
        disabled={isEmpty && !isPlaying}
        title={isEmpty && !isPlaying ? "No tracks yet — open the scene to add some" : undefined}
        class="flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-surface-hover
               disabled:cursor-not-allowed disabled:opacity-40
               focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        aria-label={isPlaying ? `Stop ${scene.name}` : `Play ${scene.name}`}
      >
        {#if isPlaying}
          <Square class="size-3.5 text-foreground" />
        {:else}
          <Play class="size-4 text-foreground" />
        {/if}
      </button>

      <span
        class="flex size-5 shrink-0 items-center justify-center rounded-sm"
        style="background-color: {wash(hue, 0.18)}"
        aria-hidden="true"
      >
        <ChipIcon class="size-3" style="color: {hue}" strokeWidth={1.75} />
      </span>

      <!-- The subject of the bubble, so it reads in the foreground. -->
      <button
        type="button"
        onclick={openScene}
        class="max-w-40 truncate rounded-sm text-xs font-semibold text-foreground underline-offset-2 hover:underline
               focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        title="Open {scene.name} beside this PDF"
      >
        {scene.name}
      </button>

      <!-- Change-Scene dropdown: same searchable picker, re-links this span. -->
      <button
        type="button"
        onclick={() => (changeOpen = !changeOpen)}
        class="flex size-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-surface-hover
               focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        aria-label="Change scene"
        aria-expanded={changeOpen}
      >
        <ChevronDown class="size-3.5 text-muted-foreground" />
      </button>

      <div class="mx-0.5 h-4 w-px bg-border"></div>

      <!-- Master volume (global; no per-link override). Crimson only while this link's
           scene is the one playing. -->
      <Volume2 class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <VolumeSlider
        value={audioEngine.masterVolume}
        label="Master volume"
        active={isPlaying}
        oninput={(v) => audioEngine.setMasterVolume(v)}
      />

      <div class="mx-0.5 h-4 w-px bg-border"></div>

      <button
        type="button"
        onclick={onRemove}
        class="flex size-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-surface-hover
               focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        aria-label="Remove Scene-link"
        title="Remove link"
      >
        <Trash2 class="size-3.5 text-muted-foreground" />
      </button>
    </div>

    {#if drifted}
      <p class="flex items-center gap-1.5 border-t border-border px-2 py-1.5 text-xs text-error">
        <TriangleAlert class="size-3.5 shrink-0" />
        The text here has changed since it was linked.
      </p>
    {:else if isEmpty}
      <p class="border-t border-border px-2 py-1.5 text-xs text-muted-foreground">
        No tracks yet. Open the scene to add some.
      </p>
    {/if}
  </div>

  {#if changeOpen}
    <div class="absolute left-0 top-full z-20 mt-1">
      <ScenePicker
        currentSceneId={scene.id}
        onSelect={changeScene}
        onNewScene={newScene}
        onCancel={() => (changeOpen = false)}
      />
    </div>
  {/if}
</div>
