<!--
  @component
  The mini player: the scene that is playing, in the sidebar's footer, for a GM whose
  eyes are on a note. Two rows — the scene (open it, or open its tracks), then the
  transport and the master volume — and nothing else in the footer. The tracks float
  above the page in a panel of their own rather than folding open here: open in the
  footer they took nearly half the window and pushed the file tree out of sight.

  It names the scene the GM last chose — the one starting during a crossfade, not the
  one fading out — and its crimson means sounding, by the engine's one answer for the
  scene (`sceneState`). Stop always works, including mid-crossfade.
-->
<script lang="ts">
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import { scenes } from "$lib/stores/scenes.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import type { SceneSlot } from "$lib/types/ledger";
  import * as Popover from "$lib/components/ui/popover";
  import VolumeSlider from "$lib/components/VolumeSlider.svelte";
  import NowPlayingBars from "$lib/components/NowPlayingBars.svelte";
  import SceneTrackRow from "$lib/components/SceneTrackRow.svelte";
  import { ListMusic, LoaderCircle, Pause, Play, Square, Volume2, VolumeOff } from "@lucide/svelte";

  const sceneId = $derived(audioEngine.loadingSceneId ?? audioEngine.activeSceneId);
  const scene = $derived(scenes.scenes.find((s) => s.id === sceneId) ?? null);
  const sceneName = $derived(scene?.name ?? "Scene");
  const sceneState = $derived(audioEngine.sceneState(sceneId));
  const isLoading = $derived(sceneState === "loading");
  const isPaused = $derived(sceneState === "paused");

  let tracksOpen = $state(false);
  let slots = $state<SceneSlot[]>([]);

  // This scene's tracks, again whenever any surface changes them.
  $effect(() => {
    const id = sceneId;
    void scenes.slotsRevision;
    if (id === null) {
      slots = [];
      tracksOpen = false;
      return;
    }
    let cancelled = false;
    scenes
      .getSlots(id)
      .then((s) => {
        if (!cancelled) slots = s;
      })
      .catch(() => {
        if (!cancelled) slots = [];
      });
    return () => {
      cancelled = true;
    };
  });

  function openScene() {
    if (!scene) return;
    tabs.navigateOpen({ type: "scene", id: scene.id, title: scene.name });
  }

  // Said once, politely, when the scene or its state changes — a screen reader otherwise
  // hears nothing when a scene starts or pauses from somewhere else.
  const announcement = $derived(
    sceneId === null
      ? ""
      : isLoading
        ? `Starting ${sceneName}`
        : isPaused
          ? `${sceneName} paused`
          : `${sceneName} playing`,
  );

  const button =
    "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-sidebar-accent " +
    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";
</script>

{#if sceneId !== null}
  <!-- Framed as the in-note player is — a raised panel with a crimson border while the
       scene sounds — so it reads as its own thing, not one more row of the footer. -->
  <section
    aria-label="Now playing"
    data-mini-player
    class="mb-2 rounded-lg border bg-card/40 px-1.5 pt-1 pb-1.5 transition-colors duration-200 group-data-[collapsible=icon]:hidden
           {sceneState === 'playing' ? 'border-primary/60' : 'border-border'}"
  >
    <!-- The scene: what it is doing, its name (which opens it), and its tracks. -->
    <div class="flex min-w-0 items-center gap-1">
      <span class="flex w-5 shrink-0 justify-center" aria-hidden="true">
        {#if isLoading}
          <LoaderCircle class="size-3.5 animate-spin text-muted-foreground" />
        {:else if isPaused}
          <Pause class="size-3.5 text-muted-foreground" />
        {:else}
          <NowPlayingBars />
        {/if}
      </span>
      <button
        type="button"
        onclick={openScene}
        class="font-heading min-w-0 flex-1 truncate rounded-md px-1 py-1 text-left text-sm leading-tight text-sidebar-foreground transition-colors hover:bg-sidebar-accent
               focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        title="Open {sceneName}"
      >
        {sceneName}
      </button>
      {#if isPaused}
        <span class="shrink-0 text-[11px] text-muted-foreground">Paused</span>
      {:else if isLoading}
        <span class="shrink-0 text-[11px] text-muted-foreground">Starting</span>
      {/if}

      <Popover.Root bind:open={tracksOpen}>
        <Popover.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              class="{button} {tracksOpen ? 'bg-sidebar-accent' : ''}"
              aria-label="Tracks in {sceneName}"
              title="Tracks"
            >
              <ListMusic class="size-4 text-muted-foreground" />
            </button>
          {/snippet}
        </Popover.Trigger>
        <!-- Beside the sidebar, over the page: the footer stays two rows. -->
        <Popover.Content side="right" align="end" class="@container w-[26rem] p-1.5">
          <p class="truncate px-2 pt-1 pb-1.5 text-xs font-semibold text-muted-foreground">
            Tracks in <span class="font-heading font-normal text-foreground">{sceneName}</span>
          </p>
          {#if slots.length === 0}
            <p class="px-2 pb-1.5 text-xs text-muted-foreground">This scene has no tracks.</p>
          {:else}
            <div class="max-h-80 overflow-y-auto" data-pane-scroll>
              {#each slots as slot (slot.id)}
                <SceneTrackRow {slot} />
              {/each}
            </div>
          {/if}
        </Popover.Content>
      </Popover.Root>
    </div>

    <!-- The transport, then the master volume: every scene's level, so it is named. -->
    <div class="mt-0.5 flex items-center gap-0.5">
      <button
        type="button"
        onclick={() => audioEngine.togglePauseScene()}
        aria-disabled={isLoading}
        class={button}
        aria-label={isPaused ? `Resume ${sceneName}` : `Pause ${sceneName}`}
        title={isPaused ? "Resume" : "Pause"}
      >
        {#if isPaused}
          <Play class="size-3.5 text-sidebar-foreground" />
        {:else}
          <Pause class="size-3.5 text-sidebar-foreground" />
        {/if}
      </button>
      <button
        type="button"
        onclick={() => audioEngine.stopAll()}
        class={button}
        aria-label="Stop {sceneName}"
        title="Stop"
      >
        <Square class="size-3.5 text-sidebar-foreground" />
      </button>

      <span class="mx-1 h-4 w-px shrink-0 bg-sidebar-border" aria-hidden="true"></span>

      <!-- Muted is the state to notice, so it is drawn louder, not quieter. -->
      <button
        type="button"
        onclick={() => audioEngine.toggleMasterMute()}
        class={button}
        aria-label="Mute all"
        aria-pressed={audioEngine.isMasterMuted}
        title={audioEngine.isMasterMuted ? "Unmute all" : "Mute all"}
      >
        {#if audioEngine.isMasterMuted}
          <VolumeOff class="size-3.5 text-sidebar-foreground" />
        {:else}
          <Volume2 class="size-3.5 text-muted-foreground" />
        {/if}
      </button>
      <VolumeSlider
        class="w-auto min-w-0 flex-1 pr-1"
        value={audioEngine.masterVolume}
        label="Master volume"
        active={audioEngine.isSounding && !audioEngine.isMasterMuted}
        oninput={(v) => audioEngine.setMasterVolume(v)}
      />
    </div>
  </section>
{/if}
<!-- Outside the block, so it is already on the page when a scene starts: a live region
     that arrives with its text is not read. -->
<p class="sr-only" aria-live="polite">{announcement}</p>
