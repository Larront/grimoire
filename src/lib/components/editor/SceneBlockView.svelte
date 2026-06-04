<!-- src/lib/components/editor/SceneBlockView.svelte -->
<script lang="ts">
  import { scenes } from "$lib/stores/scenes.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
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
    ChevronLeft,
    Plus,
    ExternalLink,
  } from "@lucide/svelte";
  import { audioEngine, isPlaylistSlot } from "$lib/stores/audio-engine.svelte";
  import { api } from "$lib/api";
  import type { SceneSlot } from "$lib/types/ledger";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import { ICON_MAP, ACCENT_BG, ACCENT_FG } from "$lib/components/panes/thumbnail-presets";
  import { toastError } from "$lib/toast";

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

  async function createNewScene() {
    try {
      const trimmed = searchQuery.trim();
      const name = trimmed || "New Scene";
      const scene = await scenes.createScene(name);
      onUpdate({ sceneId: scene.id, expanded: false });
      searchQuery = "";
    } catch (e) {
      console.error("create scene failed:", e);
      toastError("Failed to create scene.");
    }
  }

  // ── Active state ──────────────────────────────────────────────────────────

  let activeSlots = $state<SceneSlot[]>([]);
  let slotsLoading = $state(false);
  let lastLoadedSceneId: number | null = null;

  async function reloadSlots(id: number | null) {
    if (id === null) {
      activeSlots = [];
      slotsLoading = false;
      lastLoadedSceneId = null;
      return;
    }
    if (id !== lastLoadedSceneId) slotsLoading = true;
    const fetched = await scenes.getSlots(id);
    activeSlots = fetched;
    for (const slot of fetched) {
      slotDisplayVols.set(slot.id, slot.volume);
    }
    slotsLoading = false;
    lastLoadedSceneId = id;
  }

  $effect(() => {
    reloadSlots(_sceneId);
  });

  const thisScene = $derived(scenes.scenes.find((s) => s.id === _sceneId) ?? null);
  const isThisSceneActive = $derived(audioEngine.activeSceneId === _sceneId);
  const isThisSceneLoading = $derived(audioEngine.loadingSceneId === _sceneId);
  const isThisScenePlaying = $derived(isThisSceneActive && audioEngine.isPlaying);
  const showBars = $derived(
    isThisSceneActive && (audioEngine.isPlaying || audioEngine.isCrossfading),
  );

  // Scene thumbnail chip (color + icon — falls back to deterministic accent
  // when the scene has none set, matching ScenesDashboard's `cardBg/cardFg`).
  const chipColor = $derived(
    thisScene
      ? (thisScene.thumbnail_color ?? ACCENT_BG[thisScene.id % ACCENT_BG.length])
      : ACCENT_BG[0],
  );
  const chipIconColor = $derived(
    thisScene ? ACCENT_FG[thisScene.id % ACCENT_FG.length] : ACCENT_FG[0],
  );
  const ChipIcon = $derived(
    thisScene?.thumbnail_icon
      ? (ICON_MAP[thisScene.thumbnail_icon] ?? Music2)
      : Music2,
  );

  // ── Pause / Resume / Stop (parity with ScenePane) ────────────────────────

  let scenePaused = $state(false);

  $effect(() => {
    if (!isThisScenePlaying) scenePaused = false;
  });

  async function handlePauseScene() {
    for (const [slotId, state] of audioEngine.slotStates) {
      if (state.playing) await audioEngine.pauseSlot(slotId);
    }
    scenePaused = true;
  }

  async function handleResumeScene() {
    for (const [slotId, state] of audioEngine.slotStates) {
      if (!state.playing) await audioEngine.resumeSlot(slotId);
    }
    scenePaused = false;
  }

  function handlePlayPause() {
    if (_sceneId === null || isThisSceneLoading) return;
    if (isThisScenePlaying) {
      handlePauseScene();
    } else if (isThisSceneActive && scenePaused) {
      handleResumeScene();
    } else {
      audioEngine.playScene(_sceneId);
    }
  }

  function handleStopScene() {
    scenePaused = false;
    audioEngine.stopAll();
    masterMutedVolume = null;
  }

  function openInScenesTab() {
    if (!thisScene) return;
    tabs.openTab({ type: "scene", id: thisScene.id, title: thisScene.name });
  }

  function unbindScene() {
    onUpdate({ sceneId: null, expanded: false });
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
      await api.updateSceneSlot(
        slot.id,
        slot.label,
        value,
        slot.loop,
        slot.slot_order,
        !!slot.shuffle,
      );
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
      await api.updateSceneSlot(
        slot.id,
        slot.label,
        audioEngine.slotStates.get(slot.id)?.volume ?? slot.volume,
        !slot.loop,
        slot.slot_order,
        !!slot.shuffle,
      );
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
      await api.updateSceneSlot(
        slot.id,
        slot.label,
        audioEngine.slotStates.get(slot.id)?.volume ?? slot.volume,
        slot.loop,
        slot.slot_order,
        !slot.shuffle,
      );
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
  <div class="my-1 rounded-md border border-border/60 bg-card px-3 py-2.5 select-none">
    <!-- Search -->
    <div class="relative mb-1.5">
      <Search class="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50 pointer-events-none" />
      <input
        type="text"
        placeholder="Search scenes…"
        bind:value={searchQuery}
        class="w-full pl-6 pr-2 py-1 font-sans text-xs bg-background border border-border/50
               rounded-md text-foreground placeholder:text-muted-foreground/40
               focus:outline-none focus:border-primary/60 transition-colors"
      />
    </div>

    <!-- Scene list -->
    <div
      class="max-h-40 overflow-y-auto flex flex-col"
      role="listbox"
      aria-label="Scenes"
    >
      {#if scenes.scenes.length === 0}
        <p class="px-2 py-2 font-sans text-xs text-muted-foreground/50">
          No scenes yet. Create one to get started.
        </p>
      {:else if filteredScenes.length === 0}
        <p class="px-2 py-2 font-sans text-xs text-muted-foreground/50">
          No scenes match.
        </p>
      {:else}
        {#each filteredScenes as scene (scene.id)}
          {@const RowIcon = scene.thumbnail_icon ? (ICON_MAP[scene.thumbnail_icon] ?? Music2) : Music2}
          {@const rowBg = scene.thumbnail_color ?? ACCENT_BG[scene.id % ACCENT_BG.length]}
          {@const rowFg = ACCENT_FG[scene.id % ACCENT_FG.length]}
          <button
            type="button"
            role="option"
            aria-selected="false"
            onclick={() => selectScene(scene.id)}
            class="group w-full text-left flex items-center gap-2.5 px-2 py-1.5 rounded-md
                   text-muted-foreground cursor-pointer transition-colors
                   hover:bg-primary/10 hover:text-foreground
                   focus-visible:bg-primary/10 focus-visible:text-foreground
                   focus-visible:outline-none"
          >
            <span
              class="shrink-0 flex size-6 items-center justify-center rounded-sm ring-1 ring-inset ring-transparent transition-[box-shadow] group-hover:ring-primary/30"
              style="background-color: {rowBg}"
              aria-hidden="true"
            >
              <RowIcon class="size-3.5" style="color: {rowFg}" strokeWidth={1.75} />
            </span>
            <span class="truncate font-heading text-sm">{scene.name}</span>
          </button>
        {/each}
      {/if}
    </div>

    <!-- Create new scene -->
    {#if scenes.scenes.length > 0}
      <div class="-mx-3 mt-1.5 mb-1.5 border-t border-border/40"></div>
    {/if}
    <button
      type="button"
      onclick={createNewScene}
      class="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md cursor-pointer
             font-sans text-xs text-muted-foreground transition-colors
             hover:bg-primary/10 hover:text-foreground
             focus-visible:bg-primary/10 focus-visible:text-foreground focus-visible:outline-none"
    >
      <span
        class="shrink-0 flex size-6 items-center justify-center rounded-sm bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <Plus class="size-3.5" strokeWidth={1.75} />
      </span>
      {#if searchQuery.trim()}
        <span>Create scene <span class="font-heading text-foreground">“{searchQuery.trim()}”</span></span>
      {:else}
        <span>Create new scene</span>
      {/if}
    </button>
  </div>

{:else}
  <!-- ── Active: compact strip + expandable mixer ───────────────────────────── -->
  <div
    class="my-1 rounded-md border bg-card select-none overflow-hidden transition-colors duration-200
           {isThisScenePlaying
             ? 'border-primary/25'
             : isThisSceneLoading
               ? 'border-primary/12'
               : 'border-border/60'}"
  >
    <!-- Compact strip -->
    <div class="flex items-center gap-2 px-2.5 py-2">

      <!-- Play / Pause / Loading (primary toggle) -->
      <button
        onclick={handlePlayPause}
        disabled={isThisSceneLoading}
        class="shrink-0 flex items-center justify-center size-6 rounded-sm
               hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label={isThisScenePlaying ? "Pause scene" : scenePaused ? "Resume scene" : "Play scene"}
      >
        {#if isThisSceneLoading}
          <LoaderCircle class="size-3.5 text-muted-foreground animate-spin" />
        {:else if isThisScenePlaying}
          <Pause class="size-3 text-foreground" />
        {:else}
          <Play class="size-3.5 {isThisSceneActive ? 'text-foreground' : 'text-muted-foreground'}" />
        {/if}
      </button>

      <!-- Stop (only when active) -->
      {#if isThisSceneActive}
        <button
          onclick={handleStopScene}
          class="shrink-0 flex items-center justify-center size-6 rounded-sm
                 hover:bg-muted transition-colors"
          aria-label="Stop scene"
        >
          <Square class="size-3 text-muted-foreground" />
        </button>
      {/if}

      <!-- Scene identity chip (color tint + icon) -->
      <span
        class="shrink-0 flex size-5 items-center justify-center rounded-sm"
        style="background-color: {chipColor}"
        aria-hidden="true"
      >
        <ChipIcon class="size-3" style="color: {chipIconColor}" strokeWidth={1.75} />
      </span>

      <!-- Scene name — Metamorphous (world content), clickable → opens scene -->
      <button
        type="button"
        onclick={openInScenesTab}
        class="group flex-1 min-w-0 flex items-center gap-1 text-left
               truncate font-heading text-xs leading-tight transition-colors duration-200
               {isThisScenePlaying ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}"
        aria-label="Open {thisScene?.name ?? 'scene'} in Scenes"
      >
        <span class="truncate">{thisScene?.name ?? "Unknown scene"}</span>
        <ExternalLink class="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
      </button>

      <!-- Playing indicator -->
      {#if showBars}
        <span class="flex items-end gap-[2px] h-3 shrink-0" aria-hidden="true">
          <span class="w-[2.5px] rounded-sm bg-primary/70 now-playing-bar" style="--bar-dur: 620ms; animation-delay: 0ms"></span>
          <span class="w-[2.5px] rounded-sm bg-primary/70 now-playing-bar" style="--bar-dur: 780ms; animation-delay: 80ms"></span>
          <span class="w-[2.5px] rounded-sm bg-primary/70 now-playing-bar" style="--bar-dur: 670ms; animation-delay: 160ms"></span>
          <span class="w-[2.5px] rounded-sm bg-primary/70 now-playing-bar" style="--bar-dur: 730ms; animation-delay: 240ms"></span>
        </span>
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

      <!-- Master volume: visual track + transparent input + visible thumb -->
      <div class="relative flex h-3 w-20 shrink-0 items-center">
        <div class="relative h-1 w-full rounded-full bg-foreground/10 ring-1 ring-inset ring-border/40">
          <div
            class="absolute inset-y-0 left-0 rounded-full bg-primary/50 transition-[width] duration-75"
            style="width: {displayMasterVolume * 100}%"
          ></div>
          <div
            class="pointer-events-none absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-primary ring-1 ring-card transition-[left] duration-75"
            style="left: calc({displayMasterVolume * 100}% - 6px)"
            aria-hidden="true"
          ></div>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={displayMasterVolume}
          class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label="Master volume"
          aria-valuetext="{Math.round(displayMasterVolume * 100)}%"
          oninput={handleMasterVolumeInput}
        />
      </div>

      <!-- Change scene (return to picker) -->
      <button
        onclick={unbindScene}
        class="shrink-0 flex items-center justify-center size-6 rounded-sm
               hover:bg-muted transition-colors"
        aria-label="Change scene"
        title="Change scene"
      >
        <ChevronLeft class="size-3.5 text-muted-foreground" />
      </button>

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

    <!-- Expandable mixer panel — grid-rows slide (snaps under reduced-motion) -->
    <div
      class="mixer-panel grid transition-[grid-template-rows] duration-200 ease-out overflow-hidden"
      style="grid-template-rows: {_expanded ? '1fr' : '0fr'}"
    >
      <div class="min-h-0">
        <div class="border-t border-border/50 px-1 py-1">
          {#if slotsLoading}
            <div class="space-y-1.5 px-2 py-1.5" aria-hidden="true">
              {#each { length: 2 } as _, i (i)}
                <div class="h-8 rounded-md bg-muted/50 animate-pulse"></div>
              {/each}
            </div>
          {:else if activeSlots.length === 0}
            <p class="px-2 py-2 font-sans text-xs text-muted-foreground/50">
              No tracks yet. <button class="underline-offset-2 hover:underline" onclick={openInScenesTab}>Open this scene</button> to add some.
            </p>
          {:else}
            {#each activeSlots as slot (slot.id)}
              {@const slotState = audioEngine.slotStates.get(slot.id)}
              {@const isPlaying = slotState?.playing ?? false}
              {@const displayVol = getSlotDisplayVolume(slot)}
              {@const isMuted = slotMutedVolumes.has(slot.id)}
              {@const isSpotify = slot.source === "spotify"}
              {@const isPlaylist = isPlaylistSlot(slot)}

              <div class="group rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors">
                <!-- Row 1: source pill + label + play/pause -->
                <div class="flex items-center gap-2 min-w-0 mb-1">
                  <span
                    class="shrink-0 inline-flex items-center justify-center min-w-12 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-muted-foreground leading-none"
                  >{isSpotify ? "Spotify" : "Local"}</span>
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

                <!-- Row 2: [mute + volume] left, [loop + shuffle] right -->
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

                  <!-- Volume: visual track + transparent input + visible thumb -->
                  <div class="relative flex h-3 w-20 shrink-0 items-center">
                    <div class="relative h-1 w-full rounded-full bg-foreground/10 ring-1 ring-inset ring-border/40">
                      <div
                        class="absolute inset-y-0 left-0 rounded-full bg-primary/50 transition-[width] duration-75"
                        style="width: {displayVol * 100}%"
                      ></div>
                      <div
                        class="pointer-events-none absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-primary ring-1 ring-card transition-[left] duration-75"
                        style="left: calc({displayVol * 100}% - 6px)"
                        aria-hidden="true"
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

                  <div class="ml-auto flex items-center gap-1.5">
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
    .mixer-panel {
      transition: none;
    }
  }
</style>
