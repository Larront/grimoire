<!-- src/lib/components/editor/SceneBlockView.svelte -->
<script lang="ts">
  import { scenes } from "$lib/stores/scenes.svelte";
  import {
    Search,
    Play,
    Square,
    Volume2,
    VolumeOff,
    ChevronDown,
    ChevronUp,
    Music2,
    Pause,
    Repeat,
    Shuffle,
    SkipBack,
    SkipForward,
    LoaderCircle,
  } from "@lucide/svelte";
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import { invoke } from "@tauri-apps/api/core";
  import type { SceneSlot } from "$lib/types/vault";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";

  let {
    sceneId,
    expanded,
    onUpdate,
  }: {
    sceneId: number | null;
    expanded: boolean;
    onUpdate: (attrs: { sceneId: number | null; expanded: boolean }) => void;
  } = $props();

  // Internal copies updated by setAttrs() on undo/redo
  // svelte-ignore state_referenced_locally
  let _sceneId = $state(sceneId);
  // svelte-ignore state_referenced_locally
  let _expanded = $state(expanded);

  export function setAttrs(newSceneId: number | null, newExpanded: boolean) {
    _sceneId = newSceneId;
    _expanded = newExpanded;
  }

  // ── Placeholder search ────────────────────────────────────────────────────

  let searchQuery = $state("");
  const filteredScenes = $derived(
    scenes.scenes.filter((s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()),
    ),
  );

  function selectScene(id: number) {
    onUpdate({ sceneId: id, expanded: false });
  }

  // ── Active state ──────────────────────────────────────────────────────────

  let activeSlots = $state<SceneSlot[]>([]);

  async function reloadSlots(id: number | null) {
    activeSlots = id === null ? [] : await scenes.getSlots(id);
    for (const slot of activeSlots) {
      slotDisplayVols.set(slot.id, slot.volume);
    }
  }

  $effect(() => {
    reloadSlots(_sceneId);
  });

  const thisScene = $derived(scenes.scenes.find((s) => s.id === _sceneId) ?? null);
  const isThisSceneActive = $derived(audioEngine.activeSceneId === _sceneId);
  const isThisSceneLoading = $derived(audioEngine.loadingSceneId === _sceneId);
  const showBars = $derived(
    isThisSceneActive && (audioEngine.isPlaying || audioEngine.isCrossfading),
  );

  function handlePlayStop() {
    if (_sceneId === null) return;
    if (isThisSceneActive && audioEngine.isPlaying) {
      audioEngine.stopAll();
      masterMutedVolume = null;
    } else {
      audioEngine.playScene(_sceneId);
    }
  }

  function toggleExpanded() {
    onUpdate({ sceneId: _sceneId, expanded: !_expanded });
  }

  // ── Master volume ─────────────────────────────────────────────────────────

  let masterMutedVolume = $state<number | null>(null);
  const isMasterMuted = $derived(masterMutedVolume !== null);
  const displayMasterVolume = $derived(isMasterMuted ? 0 : audioEngine.masterVolume);

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

  // ── Per-slot controls ─────────────────────────────────────────────────────

  // slot.id → volume saved before muting
  let slotMutedVolumes = new SvelteMap<number, number>();
  // slot.id → volume shown in the fill bar (updated immediately on drag)
  let slotDisplayVols = new SvelteMap<number, number>();
  // slot.ids with in-flight play/pause toggle
  let busySlots = new SvelteSet<number>();

  function getSlotDisplayVolume(slot: SceneSlot): number {
    if (slotMutedVolumes.has(slot.id)) return 0;
    return slotDisplayVols.get(slot.id) ?? slot.volume;
  }

  function toggleSlotMute(slot: SceneSlot) {
    if (slotMutedVolumes.has(slot.id)) {
      const savedVol = slotMutedVolumes.get(slot.id)!;
      slotDisplayVols.set(slot.id, savedVol);
      audioEngine.setSlotVolume(slot.id, savedVol);
      slotMutedVolumes.delete(slot.id);
    } else {
      const liveVol = slotDisplayVols.get(slot.id) ?? slot.volume;
      slotMutedVolumes.set(slot.id, liveVol);
      slotDisplayVols.set(slot.id, 0);
      audioEngine.setSlotVolume(slot.id, 0);
    }
  }

  function handleSlotVolumeInput(e: Event, slot: SceneSlot) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    slotDisplayVols.set(slot.id, value);
    audioEngine.setSlotVolume(slot.id, value);
    slotMutedVolumes.delete(slot.id);
  }

  async function handleSlotVolumeChange(e: Event, slot: SceneSlot) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    try {
      await invoke("update_scene_slot", {
        id: slot.id,
        label: slot.label,
        volume: value,
        loop: slot.loop,
        slotOrder: slot.slot_order,
        shuffle: !!slot.shuffle,
      });
    } catch (err) {
      console.error("Failed to save slot volume:", err);
    }
  }

  async function toggleSlotPlayback(slot: SceneSlot) {
    if (busySlots.has(slot.id)) return;
    busySlots.add(slot.id);
    try {
      const state = audioEngine.slotStates.get(slot.id);
      if (state?.playing) {
        await audioEngine.pauseSlot(slot.id);
      } else {
        await audioEngine.resumeSlot(slot.id);
      }
    } finally {
      busySlots.delete(slot.id);
    }
  }

  async function toggleLoop(slot: SceneSlot) {
    try {
      await invoke("update_scene_slot", {
        id: slot.id,
        label: slot.label,
        volume: audioEngine.slotStates.get(slot.id)?.volume ?? slot.volume,
        loop: !slot.loop,
        slotOrder: slot.slot_order,
        shuffle: !!slot.shuffle,
      });
      if (_sceneId !== null) {
        scenes.invalidateSlots(_sceneId);
        await reloadSlots(_sceneId);
      }
    } catch (e) {
      console.error("Failed to toggle loop:", e);
    }
  }

  async function toggleShuffle(slot: SceneSlot) {
    try {
      await invoke("update_scene_slot", {
        id: slot.id,
        label: slot.label,
        volume: audioEngine.slotStates.get(slot.id)?.volume ?? slot.volume,
        loop: slot.loop,
        slotOrder: slot.slot_order,
        shuffle: !slot.shuffle,
      });
      if (_sceneId !== null) {
        scenes.invalidateSlots(_sceneId);
        await reloadSlots(_sceneId);
      }
    } catch (e) {
      console.error("Failed to toggle shuffle:", e);
    }
  }
</script>

{#if _sceneId === null}
  <!-- ── Placeholder: scene picker ─────────────────────────────────────────── -->
  <div class="my-1 rounded border border-border/60 bg-card px-3 py-2.5 select-none">
    <!-- Search -->
    <div class="relative mb-1.5">
      <Search class="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50 pointer-events-none" />
      <input
        type="text"
        placeholder="Search scenes…"
        bind:value={searchQuery}
        class="w-full pl-6 pr-2 py-1 font-sans text-xs bg-background border border-border/50
               rounded text-foreground placeholder:text-muted-foreground/40
               focus:outline-none focus:border-primary/60 transition-colors"
      />
    </div>

    <!-- Scene list -->
    <ul class="max-h-36 overflow-y-auto -mx-0.5">
      {#if scenes.scenes.length === 0}
        <li class="px-2 py-2 font-sans text-xs text-muted-foreground/50">
          No scenes found
        </li>
      {:else if filteredScenes.length === 0}
        <li class="px-2 py-2 font-sans text-xs text-muted-foreground/50">
          No scenes match
        </li>
      {:else}
        {#each filteredScenes as scene (scene.id)}
          <li>
            <button
              onclick={() => selectScene(scene.id)}
              class="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded
                     font-sans text-xs text-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              <Music2 class="size-3 shrink-0 text-muted-foreground/40" />
              {scene.name}
            </button>
          </li>
        {/each}
      {/if}
    </ul>
  </div>

{:else}
  <!-- ── Active: compact strip + expandable mixer ───────────────────────────── -->
  <div
    class="my-1 rounded border bg-card select-none overflow-hidden transition-colors duration-200
           {isThisSceneActive && audioEngine.isPlaying
             ? 'border-primary/25'
             : isThisSceneLoading
               ? 'border-primary/12'
               : 'border-border/60'}"
  >
    <!-- Compact strip -->
    <div class="flex items-center gap-2 px-2.5 py-2">

      <!-- Play / Stop / Loading -->
      <button
        onclick={handlePlayStop}
        disabled={isThisSceneLoading}
        class="shrink-0 flex items-center justify-center size-6 rounded-sm
               hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label={isThisSceneActive && audioEngine.isPlaying ? "Stop scene" : "Play scene"}
      >
        {#if isThisSceneLoading}
          <LoaderCircle class="size-3.5 text-muted-foreground animate-spin" />
        {:else if isThisSceneActive && audioEngine.isPlaying}
          <Square class="size-3 text-foreground" />
        {:else}
          <Play class="size-3.5 text-muted-foreground" />
        {/if}
      </button>

      <!-- Scene name -->
      <span
        class="flex-1 min-w-0 truncate font-sans text-xs transition-colors duration-200
               {isThisSceneActive && audioEngine.isPlaying
                 ? 'text-foreground'
                 : 'text-muted-foreground'}"
      >
        {thisScene?.name ?? "Unknown Scene"}
      </span>

      <!-- Playing indicator -->
      {#if showBars}
        <span class="flex items-end gap-[2px] h-3 shrink-0" aria-hidden="true">
          <span class="w-[2.5px] rounded-sm bg-primary/70 now-playing-bar" style="--bar-dur: 620ms; animation-delay: 0ms"></span>
          <span class="w-[2.5px] rounded-sm bg-primary/70 now-playing-bar" style="--bar-dur: 780ms; animation-delay: 80ms"></span>
          <span class="w-[2.5px] rounded-sm bg-primary/70 now-playing-bar" style="--bar-dur: 670ms; animation-delay: 160ms"></span>
          <span class="w-[2.5px] rounded-sm bg-primary/70 now-playing-bar" style="--bar-dur: 730ms; animation-delay: 240ms"></span>
        </span>
      {:else}
        <Music2
          class="size-3.5 shrink-0 transition-opacity duration-200
                 {isThisSceneActive ? 'text-muted-foreground opacity-50' : 'text-muted-foreground/30'}"
        />
      {/if}

      <!-- Master mute toggle -->
      <button
        onclick={toggleMasterMute}
        class="shrink-0 flex items-center justify-center size-6 rounded-sm
               hover:bg-muted transition-colors"
        aria-label={isMasterMuted ? "Unmute" : "Mute all"}
      >
        {#if isMasterMuted}
          <VolumeOff class="size-3 text-muted-foreground/50" />
        {:else}
          <Volume2 class="size-3 text-muted-foreground/60" />
        {/if}
      </button>

      <!-- Master volume: visual track + transparent input -->
      <div class="relative flex w-16 shrink-0 items-center">
        <div class="relative h-1 w-full rounded-full bg-muted">
          <div
            class="absolute inset-y-0 left-0 rounded-full bg-primary/50 transition-[width] duration-75"
            style="width: {displayMasterVolume * 100}%"
          ></div>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={displayMasterVolume}
          disabled={!isThisSceneActive}
          class="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          aria-label="Master volume"
          aria-valuetext="{Math.round(displayMasterVolume * 100)}%"
          oninput={handleMasterVolumeInput}
        />
      </div>

      <!-- Expand / Collapse -->
      <button
        onclick={toggleExpanded}
        class="shrink-0 flex items-center justify-center size-6 rounded-sm
               hover:bg-muted transition-colors"
        aria-label={_expanded ? "Collapse mixer" : "Expand mixer"}
        aria-expanded={_expanded}
      >
        {#if _expanded}
          <ChevronUp class="size-3.5 text-muted-foreground" />
        {:else}
          <ChevronDown class="size-3.5 text-muted-foreground" />
        {/if}
      </button>
    </div>

    <!-- Expandable mixer panel — grid-rows slide -->
    <div
      class="grid transition-[grid-template-rows] duration-200 ease-out overflow-hidden"
      style="grid-template-rows: {_expanded ? '1fr' : '0fr'}"
    >
      <div class="min-h-0">
        <div class="border-t border-border/50 px-1 py-1">
          {#if activeSlots.length === 0}
            <p class="px-2 py-2 font-sans text-xs text-muted-foreground/50">
              No tracks — add them on the Scenes page.
            </p>
          {:else}
            {#each activeSlots as slot (slot.id)}
              {@const slotState = audioEngine.slotStates.get(slot.id)}
              {@const isPlaying = slotState?.playing ?? false}
              {@const displayVol = getSlotDisplayVolume(slot)}
              {@const isMuted = slotMutedVolumes.has(slot.id)}
              {@const isSpotify = slot.source === "spotify"}
              {@const isPlaylist = isSpotify && (slot.source_id.includes(":playlist:") || slot.source_id.includes(":album:"))}

              <div class="group rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors">
                <!-- Row 1: source badge + label + play/pause -->
                <div class="flex items-center gap-2 min-w-0 mb-1">
                  {#if isSpotify}
                    <span class="shrink-0 rounded-full bg-green-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-green-400 leading-none">S</span>
                  {:else}
                    <Music2 class="size-3 shrink-0 text-muted-foreground/40" />
                  {/if}
                  <span class="flex-1 truncate font-sans text-xs text-foreground">{slot.label}</span>
                  <button
                    onclick={() => toggleSlotPlayback(slot)}
                    disabled={busySlots.has(slot.id)}
                    class="shrink-0 flex items-center justify-center size-5 rounded-sm
                           hover:bg-muted transition-colors disabled:opacity-40"
                    aria-label={isPlaying ? `Pause ${slot.label}` : `Resume ${slot.label}`}
                  >
                    {#if isPlaying}
                      <Pause class="size-3 text-foreground" />
                    {:else}
                      <Play class="size-3 text-muted-foreground" />
                    {/if}
                  </button>
                </div>

                <!-- Row 2: mute + volume slider + loop + shuffle? -->
                <div class="flex items-center gap-1.5">
                  <button
                    onclick={() => toggleSlotMute(slot)}
                    class="shrink-0 flex items-center justify-center size-5 rounded-sm
                           hover:bg-muted transition-colors"
                    aria-label={isMuted ? `Unmute ${slot.label}` : `Mute ${slot.label}`}
                  >
                    {#if isMuted}
                      <VolumeOff class="size-3 text-muted-foreground/50" />
                    {:else}
                      <Volume2 class="size-3 text-muted-foreground/60" />
                    {/if}
                  </button>

                  <!-- Volume: visual track + transparent input -->
                  <div class="relative h-5 flex flex-1 items-center">
                    <div class="relative h-1 w-full rounded-full bg-muted">
                      <div
                        class="absolute inset-y-0 left-0 rounded-full bg-primary/50 transition-[width] duration-75"
                        style="width: {displayVol * 100}%"
                      ></div>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={displayVol}
                      class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      aria-label="{slot.label} volume"
                      aria-valuetext="{Math.round(displayVol * 100)}%"
                      oninput={(e) => handleSlotVolumeInput(e, slot)}
                      onchange={(e) => handleSlotVolumeChange(e, slot)}
                    />
                  </div>

                  <!-- Loop -->
                  <button
                    onclick={() => toggleLoop(slot)}
                    class="shrink-0 flex items-center justify-center size-5 rounded-sm
                           hover:bg-muted transition-colors"
                    aria-label={slot.loop ? `Disable loop for ${slot.label}` : `Enable loop for ${slot.label}`}
                    aria-pressed={slot.loop}
                  >
                    <Repeat class="size-3 {slot.loop ? 'text-primary' : 'text-muted-foreground/30'}" />
                  </button>

                  <!-- Shuffle (Spotify playlists only) -->
                  {#if isPlaylist}
                    <button
                      onclick={() => toggleShuffle(slot)}
                      class="shrink-0 flex items-center justify-center size-5 rounded-sm
                             hover:bg-muted transition-colors"
                      aria-label={slot.shuffle ? `Disable shuffle for ${slot.label}` : `Enable shuffle for ${slot.label}`}
                      aria-pressed={!!slot.shuffle}
                    >
                      <Shuffle class="size-3 {slot.shuffle ? 'text-primary' : 'text-muted-foreground/30'}" />
                    </button>
                  {/if}
                </div>

                <!-- Row 3: Spotify skip controls when playlist is playing -->
                {#if isSpotify && isPlaylist && isPlaying}
                  <div class="flex items-center justify-center gap-1 mt-1">
                    <button
                      onclick={() => audioEngine.skipPrev()}
                      class="flex items-center justify-center size-5 rounded-sm
                             hover:bg-muted transition-colors"
                      aria-label="Previous track"
                    >
                      <SkipBack class="size-3 text-muted-foreground" />
                    </button>
                    <button
                      onclick={() => audioEngine.skipNext()}
                      class="flex items-center justify-center size-5 rounded-sm
                             hover:bg-muted transition-colors"
                      aria-label="Next track"
                    >
                      <SkipForward class="size-3 text-muted-foreground" />
                    </button>
                  </div>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .now-playing-bar {
    height: 100%;
    transform-origin: bottom;
    animation: nowPlaying var(--bar-dur, 700ms) ease-in-out infinite alternate;
  }

  @keyframes nowPlaying {
    from { transform: scaleY(0.2); }
    to   { transform: scaleY(1); }
  }

  @media (prefers-reduced-motion: reduce) {
    .now-playing-bar {
      animation: none;
      transform: scaleY(0.6);
    }
  }
</style>
