<script lang="ts">
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import { scenes } from "$lib/stores/scenes.svelte";
  import type { SceneSlot } from "$lib/types/vault";
  import MiniPlayerTrack from "./MiniPlayerTrack.svelte";
  import MiniPlayerVisualizer from "./MiniPlayerVisualizer.svelte";
  import { Play, Pause, Square, Volume2, VolumeOff, ChevronUp, LoaderCircle } from "@lucide/svelte";

  let expanded = $state(false);
  let masterMutedVolume = $state<number | null>(null);
  let activeSlots = $state<SceneSlot[]>([]);

  let sceneName = $derived(
    scenes.scenes.find((s) => s.id === audioEngine.activeSceneId)?.name ?? "Unknown Scene"
  );
  let isActive = $derived(audioEngine.activeSceneId !== null);
  let isMasterMuted = $derived(masterMutedVolume !== null);
  let displayVolume = $derived(isMasterMuted ? 0 : audioEngine.masterVolume);

  let allPaused = $derived(
    audioEngine.slotStates.size === 0 ||
    [...audioEngine.slotStates.values()].every((s) => !s.playing)
  );

  $effect(() => {
    const sceneId = audioEngine.activeSceneId;
    scenes.scenes; // reactive dependency for freshness
    let cancelled = false;
    if (sceneId) {
      scenes.getSlots(sceneId).then((s) => {
        if (!cancelled) activeSlots = s;
      }).catch(() => {
        if (!cancelled) activeSlots = [];
      });
    } else {
      activeSlots = [];
      expanded = false;
      masterMutedVolume = null;
    }
    return () => { cancelled = true; };
  });

  async function togglePlayPause() {
    const states = audioEngine.slotStates;
    if (allPaused) {
      for (const [slotId] of states) {
        await audioEngine.resumeSlot(slotId);
      }
    } else {
      for (const [slotId, state] of states) {
        if (state.playing) {
          await audioEngine.pauseSlot(slotId);
        }
      }
    }
  }

  function handleStop() {
    audioEngine.stopAll();
    masterMutedVolume = null;
  }

  function toggleMasterMute() {
    if (masterMutedVolume !== null) {
      audioEngine.setMasterVolume(masterMutedVolume);
      masterMutedVolume = null;
    } else {
      masterMutedVolume = audioEngine.masterVolume;
      audioEngine.setMasterVolume(0);
    }
  }

  function handleMasterVolumeInput(e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    audioEngine.setMasterVolume(value);
    if (masterMutedVolume !== null) masterMutedVolume = null;
  }
</script>

{#if isActive}
  <div class="border-t border-sidebar-border group-data-[collapsible=icon]:hidden">
    <!-- Collapsed controls -->
    <div class="px-2 pt-2 pb-1.5">
      <!-- Row 1: viz + scene name + expand toggle -->
      <div class="flex items-center gap-2 mb-1.5">
        {#if audioEngine.isCrossfading}
          <LoaderCircle class="size-3 shrink-0 animate-spin text-primary/60" />
        {:else}
          <MiniPlayerVisualizer />
        {/if}
        <span class="flex-1 truncate text-xs font-medium text-sidebar-foreground">
          {sceneName}
        </span>
        <button
          class="shrink-0 flex items-center justify-center size-5 rounded-sm hover:bg-sidebar-accent transition-colors"
          onclick={() => (expanded = !expanded)}
          aria-label={expanded ? "Collapse tracks" : "Expand tracks"}
          aria-expanded={expanded}
        >
          <ChevronUp
            class="size-3.5 text-muted-foreground transition-transform duration-200 {expanded ? '' : 'rotate-180'}"
          />
        </button>
      </div>

      <!-- Row 2: transport + master volume -->
      <div class="flex items-center gap-1">
        <button
          class="shrink-0 flex items-center justify-center size-6 rounded-sm hover:bg-sidebar-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          onclick={togglePlayPause}
          disabled={audioEngine.isCrossfading}
          aria-label={allPaused ? "Resume scene" : "Pause scene"}
        >
          {#if allPaused}
            <Play class="size-3.5 text-sidebar-foreground" />
          {:else}
            <Pause class="size-3.5 text-sidebar-foreground" />
          {/if}
        </button>

        <button
          class="shrink-0 flex items-center justify-center size-6 rounded-sm hover:bg-sidebar-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          onclick={handleStop}
          disabled={audioEngine.isCrossfading}
          aria-label="Stop scene"
        >
          <Square class="size-3 text-sidebar-foreground" />
        </button>

        <button
          class="shrink-0 flex items-center justify-center size-6 rounded-sm hover:bg-sidebar-accent transition-colors"
          onclick={toggleMasterMute}
          aria-label={isMasterMuted ? "Unmute" : "Mute all"}
        >
          {#if isMasterMuted}
            <VolumeOff class="size-3.5 text-muted-foreground/50" />
          {:else}
            <Volume2 class="size-3.5 text-muted-foreground/70" />
          {/if}
        </button>

        <!-- Master volume slider -->
        <div class="relative flex flex-1 items-center">
          <div class="relative h-1 w-full rounded-full bg-sidebar-accent">
            <div
              class="absolute inset-y-0 left-0 rounded-full bg-primary/50"
              style="width: {displayVolume * 100}%"
            ></div>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={displayVolume}
            class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Master volume"
            aria-valuetext="{Math.round(displayVolume * 100)}%"
            oninput={handleMasterVolumeInput}
          />
        </div>
      </div>
    </div>

    <!-- Expanded: animated track list -->
    <div
      class="grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out"
      style="grid-template-rows: {expanded ? '1fr' : '0fr'}"
    >
      <div class="min-h-0">
        <div class="max-h-48 overflow-y-auto px-1 pb-1.5">
          <div class="border-t border-sidebar-border/50 pt-1.5">
            {#each activeSlots as slot (slot.id)}
              <MiniPlayerTrack {slot} />
            {/each}
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}
