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
  import type { SceneRef } from "$lib/editor/scene-block.svelte";
  import type { Scene, SceneSlot } from "$lib/types/ledger";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import { tick } from "svelte";
  import {
    DEFAULT_SCENE_ICON,
    sceneIcon,
    sceneThumbColors,
  } from "$lib/components/panes/thumbnail-presets";
  import VolumeSlider from "$lib/components/VolumeSlider.svelte";
  import NowPlayingBars from "$lib/components/NowPlayingBars.svelte";

  // The reference's record, taken as one prop bag: the connector mounts a block with its
  // record spread over the props, so the rest element *is* the record and nothing here
  // re-lists it (#209).
  //
  // `sceneName` is carried and never read, and that is the decision rather than an
  // oversight (#185): the name in the file is a copy the database owns, and a stale
  // copy *lies*. Every name on screen below comes from the store, so the cached one
  // has no path to being believed — it is held only because the record holds it, and a
  // field this view dropped would be one the next commit wrote back stale.
  let {
    onUpdate,
    ...attrs
  }: SceneRef & {
    onUpdate: (partial: Partial<SceneRef>) => void;
  } = $props();

  // The internal copy, updated by setAttrs() on undo/redo. One record, so there is no
  // field an undo can leave behind.
  // svelte-ignore state_referenced_locally
  let ref = $state<SceneRef>({ ...attrs });

  export function setAttrs(next: SceneRef) {
    ref = next;
  }

  // Whether the mixer panel is open. View state, and it stays that way (#185):
  // it used to be an `expanded` attribute written into the note, which is UI state
  // persisted into the GM's file — ADR-0016 §6 forbids it, and it meant collapsing
  // a mixer was an edit that synced to every other machine.
  let expanded = $state(false);

  // ── Placeholder search ────────────────────────────────────────────────────

  let searchQuery = $state("");
  const filteredScenes = $derived(
    scenes.scenes.filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  // The name written into the fence beside the id comes from the store, never from
  // the file — a scene the picker just listed is one the store has a live name for.
  function selectScene(scene: Scene) {
    onUpdate({ sceneId: scene.id, sceneName: scene.name });
  }

  async function createNewScene() {
    try {
      const trimmed = searchQuery.trim();
      const name = trimmed || "New Scene";
      const scene = await scenes.createScene(name);
      onUpdate({ sceneId: scene.id, sceneName: scene.name });
      searchQuery = "";
    } catch (e) {
      console.error("create scene failed:", e);
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
    reloadSlots(ref.sceneId);
  });

  const thisScene = $derived(scenes.scenes.find((s) => s.id === ref.sceneId) ?? null);
  const isThisSceneActive = $derived(
    ref.sceneId !== null && audioEngine.isSceneActive(ref.sceneId),
  );
  const isThisSceneLoading = $derived(audioEngine.loadingSceneId === ref.sceneId);
  // Every state here is THIS scene's. `isScenePlaying` stays true through a pause — the
  // engine's playing flag only drops on stop — so the block used to read a paused scene
  // as playing: its button kept saying Pause, kept pausing, and the scene could not be
  // resumed from the note. And the button's label read the engine's global paused flag,
  // so with another scene paused this one announced "Resume". Scoped as the scene
  // editor scopes them.
  const isThisScenePaused = $derived(isThisSceneActive && audioEngine.isScenePaused);
  const isThisScenePlaying = $derived(
    ref.sceneId !== null && audioEngine.isScenePlaying(ref.sceneId) && !isThisScenePaused,
  );
  const showBars = $derived(isThisScenePlaying);
  const sceneLabel = $derived(thisScene?.name ?? "scene");

  // Scene thumbnail chip (color + icon), the same colours the dashboard card wears
  // (`sceneThumbColors`): the GM's chosen colour, or neutral Iron Raised when none was
  // chosen — never a hue the app picked to tell scenes apart. An unresolved reference
  // is neutral too.
  const chipColors = $derived(
    thisScene
      ? sceneThumbColors(thisScene)
      : { bg: "var(--background-elevated)", fg: "var(--foreground-muted)" },
  );
  const chipColor = $derived(chipColors.bg);
  const chipIconColor = $derived(chipColors.fg);
  const ChipIcon = $derived(thisScene ? sceneIcon(thisScene) : DEFAULT_SCENE_ICON);

  // ── Pause / Resume / Stop (parity with ScenePane) ────────────────────────

  // While the scene loads, a click is ignored rather than the button disabled: disabling
  // the button under a keyboard GM's focus dropped their focus to the page.
  function handlePlayPause() {
    if (ref.sceneId === null || isThisSceneLoading) return;
    if (isThisScenePlaying) {
      audioEngine.pauseScene();
    } else if (isThisScenePaused) {
      audioEngine.resumeScene();
    } else {
      audioEngine.playScene(ref.sceneId);
    }
  }

  let playButton = $state<HTMLButtonElement | null>(null);

  // Stop leaves the strip once the scene stops; focus goes to Play rather than the page.
  async function handleStopScene(e: MouseEvent) {
    const hadFocus = document.activeElement === e.currentTarget;
    audioEngine.stopAll();
    if (hadFocus) {
      await tick();
      playButton?.focus();
    }
  }

  function openInScenesTab() {
    if (!thisScene) return;
    tabs.openTab({ type: "scene", id: thisScene.id, title: thisScene.name });
  }

  function unbindScene() {
    onUpdate({ sceneId: null, sceneName: "" });
  }

  function toggleExpanded() {
    expanded = !expanded;
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

  function handleSlotVolumeInput(value: number, slot: SceneSlot) {
    slotDisplayVols.set(slot.id, value);
    audioEngine.setSlotVolume(slot.id, value);
    slotMutedVolumes.delete(slot.id);
  }

  async function handleSlotVolumeChange(value: number, slot: SceneSlot) {
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

  // A track's play button plays that track on its own while the scene is stopped, as in
  // the scene editor; while the scene is active it brings the track in or out. It used to
  // call resume on a track that had never started, which does nothing.
  async function toggleSlotPlayback(slot: SceneSlot) {
    if (busySlots.has(slot.id) || ref.sceneId === null) return;
    busySlots.add(slot.id);
    try {
      if (!isThisSceneActive) {
        await audioEngine.previewSlot(ref.sceneId, slot.id);
      } else if (audioEngine.isSlotPlaying(slot.id)) {
        await audioEngine.pauseSlot(slot.id);
      } else {
        await audioEngine.resumeSlot(slot.id);
      }
    } finally {
      busySlots.delete(slot.id);
    }
  }

  // A track muted while the scene was stopped stays muted when it starts. The engine has
  // no state for a stopped scene's tracks, so the mute was only drawn — the track then
  // played at full volume under a slider showing 0.
  $effect(() => {
    if (!isThisSceneActive) return;
    for (const id of slotMutedVolumes.keys()) audioEngine.setSlotVolume(id, 0);
  });

  async function toggleLoop(slot: SceneSlot) {
    try {
      await api.updateSceneSlot(
        slot.id,
        slot.label,
        audioEngine.slotVolume(slot.id) ?? slot.volume,
        !slot.loop,
        slot.slot_order,
        !!slot.shuffle,
      );
      if (ref.sceneId !== null) {
        scenes.invalidateSlots(ref.sceneId);
        await reloadSlots(ref.sceneId);
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
        audioEngine.slotVolume(slot.id) ?? slot.volume,
        slot.loop,
        slot.slot_order,
        !slot.shuffle,
      );
      if (ref.sceneId !== null) {
        scenes.invalidateSlots(ref.sceneId);
        await reloadSlots(ref.sceneId);
      }
    } catch (e) {
      console.error("Failed to toggle shuffle:", e);
    }
  }
</script>

{#if ref.sceneId === null}
  <!-- ── Placeholder: scene picker ─────────────────────────────────────────── -->
  <div class="my-1 rounded-lg border border-border bg-card/40 px-3 py-2.5 select-none">
    <!-- Search. Every control here binds a scene, so a `/scene` inserted by accident
         used to strand the picker in the note — hence the trash can that sat beside the
         search field. Delete on the gutter handle's menu reaches a sealed block now
         (#194), so this is a search field and nothing else. -->
    <div class="relative mb-1.5">
      <Search
        class="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50 pointer-events-none"
      />
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
    <div class="max-h-40 overflow-y-auto flex flex-col" role="listbox" aria-label="Scenes">
      {#if scenes.scenes.length === 0}
        <p class="px-2 py-2 font-sans text-xs text-muted-foreground/50">
          No scenes yet. Create one to get started.
        </p>
      {:else if filteredScenes.length === 0}
        <p class="px-2 py-2 font-sans text-xs text-muted-foreground/50">No scenes match.</p>
      {:else}
        {#each filteredScenes as scene (scene.id)}
          {@const RowIcon = sceneIcon(scene)}
          {@const rowBg = sceneThumbColors(scene).bg}
          {@const rowFg = sceneThumbColors(scene).fg}
          <button
            type="button"
            role="option"
            aria-selected="false"
            onclick={() => selectScene(scene)}
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
        <span
          >Create scene <span class="font-heading text-foreground">“{searchQuery.trim()}”</span
          ></span
        >
      {:else}
        <span>Create new scene</span>
      {/if}
    </button>
  </div>
{:else}
  <!-- ── Active: compact strip + expandable mixer ───────────────────────────── -->
  <div
    class="my-1 rounded-lg border bg-card/40 select-none overflow-hidden transition-colors duration-200
           {isThisScenePlaying
      ? 'border-primary/60'
      : isThisSceneLoading
        ? 'border-primary/30'
        : 'border-border'}"
  >
    <!-- Compact strip -->
    <div class="flex items-center gap-2 px-2.5 py-2">
      <!-- Play / Pause / Loading (primary toggle) -->
      <button
        bind:this={playButton}
        onclick={handlePlayPause}
        aria-disabled={isThisSceneLoading}
        class="shrink-0 flex items-center justify-center size-6 rounded-sm
               hover:bg-muted transition-colors aria-disabled:cursor-wait"
        aria-label={isThisScenePlaying
          ? `Pause ${sceneLabel}`
          : isThisScenePaused
            ? `Resume ${sceneLabel}`
            : `Play ${sceneLabel}`}
      >
        {#if isThisSceneLoading}
          <LoaderCircle class="size-3.5 text-muted-foreground animate-spin" />
        {:else if isThisScenePlaying}
          <Pause class="size-3 text-foreground" />
        {:else}
          <Play
            class="size-3.5 {isThisSceneActive ? 'text-foreground' : 'text-muted-foreground'}"
          />
        {/if}
      </button>

      <!-- Stop (only when active) -->
      {#if isThisSceneActive}
        <button
          onclick={handleStopScene}
          class="shrink-0 flex items-center justify-center size-6 rounded-sm
                 hover:bg-muted transition-colors"
          aria-label="Stop {sceneLabel}"
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
               {isThisScenePlaying
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground'}"
        aria-label="Open {thisScene?.name ?? 'scene'} in Scenes"
      >
        <span class="truncate">{thisScene?.name ?? "Unknown scene"}</span>
        <ExternalLink class="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
      </button>

      <!-- Playing indicator -->
      {#if showBars}
        <NowPlayingBars />
      {/if}

      <!-- Master mute toggle -->
      <button
        onclick={() => audioEngine.toggleMasterMute()}
        class="shrink-0 flex items-center justify-center size-6 rounded-sm
               hover:bg-muted transition-colors"
        aria-label={audioEngine.isMasterMuted ? "Unmute" : "Mute all"}
      >
        {#if audioEngine.isMasterMuted}
          <VolumeOff class="size-3 text-muted-foreground/50" />
        {:else}
          <Volume2 class="size-3 text-muted-foreground/60" />
        {/if}
      </button>

      <VolumeSlider
        value={audioEngine.masterVolume}
        label="Master volume"
        active={audioEngine.isPlaying}
        oninput={(v) => audioEngine.setMasterVolume(v)}
      />

      <!-- Change scene (return to picker). It used to stand beside a trash can, and the
           distinction between them was worth the two buttons: unbinding leaves the block
           waiting for a scene, removal took it out of the note. Only the unbinding is a
           scene-block gesture — Delete lives on the gutter handle's menu now (#194), and
           neither one touches the scene in the Scenes pane. -->
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
        aria-label={expanded ? "Collapse mixer" : "Expand mixer"}
        aria-expanded={expanded}
      >
        {#if expanded}
          <ChevronUp class="size-3.5 text-muted-foreground" />
        {:else}
          <ChevronDown class="size-3.5 text-muted-foreground" />
        {/if}
      </button>
    </div>

    <!-- Expandable mixer panel — grid-rows slide (snaps under reduced-motion) -->
    <div
      class="mixer-panel grid transition-[grid-template-rows] duration-200 ease-out overflow-hidden"
      style="grid-template-rows: {expanded ? '1fr' : '0fr'}"
    >
      <!-- `inert` while collapsed: a closed mixer's controls were still Tab stops, invisible
           ones, and arrow keys changed a volume nobody could see. -->
      <div class="min-h-0" inert={!expanded}>
        <div class="border-t border-border/50 px-1 py-1">
          {#if slotsLoading}
            <div class="space-y-1.5 px-2 py-1.5" aria-hidden="true">
              {#each { length: 2 } as _, i (i)}
                <div class="h-8 rounded-md bg-muted/50 animate-pulse"></div>
              {/each}
            </div>
          {:else if activeSlots.length === 0}
            <p class="px-2 py-2 font-sans text-xs text-muted-foreground/50">
              No tracks yet. <button
                class="underline-offset-2 hover:underline"
                onclick={openInScenesTab}>Open this scene</button
              > to add some.
            </p>
          {:else}
            {#each activeSlots as slot (slot.id)}
              {@const isPlaying = audioEngine.isSlotPlaying(slot.id)}
              {@const displayVol = getSlotDisplayVolume(slot)}
              {@const isMuted = slotMutedVolumes.has(slot.id)}
              {@const isSpotify = slot.source === "spotify"}
              {@const isPlaylist = isPlaylistSlot(slot)}

              <div class="group rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors">
                <!-- Row 1: source pill + label + play/pause -->
                <div class="flex items-center gap-2 min-w-0 mb-1">
                  <span
                    class="shrink-0 inline-flex items-center justify-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground leading-none"
                    >{isSpotify ? "Spotify" : "Local"}</span
                  >
                  <span class="flex-1 truncate font-sans text-xs text-foreground">{slot.label}</span
                  >
                  <button
                    onclick={() => toggleSlotPlayback(slot)}
                    disabled={busySlots.has(slot.id)}
                    class="shrink-0 flex items-center justify-center size-5 rounded-sm
                           hover:bg-muted transition-colors disabled:opacity-40"
                    aria-label={isPlaying
                      ? `Pause ${slot.label}`
                      : isThisSceneActive
                        ? `Play ${slot.label}`
                        : `Play ${slot.label} on its own`}
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

                  <VolumeSlider
                    value={displayVol}
                    label="{slot.label} volume"
                    active={isPlaying}
                    oninput={(v) => handleSlotVolumeInput(v, slot)}
                    onchange={(v) => handleSlotVolumeChange(v, slot)}
                  />

                  <div class="ml-auto flex items-center gap-1.5">
                    <!-- Loop -->
                    <button
                      onclick={() => toggleLoop(slot)}
                      class="shrink-0 flex items-center justify-center size-5 rounded-sm
                             hover:bg-muted transition-colors"
                      aria-label={slot.loop
                        ? `Disable loop for ${slot.label}`
                        : `Enable loop for ${slot.label}`}
                      aria-pressed={slot.loop}
                    >
                      <Repeat
                        class="size-3 {slot.loop ? 'text-primary' : 'text-muted-foreground/30'}"
                      />
                    </button>

                    <!-- Shuffle (Spotify playlists only) -->
                    {#if isPlaylist}
                      <button
                        onclick={() => toggleShuffle(slot)}
                        class="shrink-0 flex items-center justify-center size-5 rounded-sm
                               hover:bg-muted transition-colors"
                        aria-label={slot.shuffle
                          ? `Disable shuffle for ${slot.label}`
                          : `Enable shuffle for ${slot.label}`}
                        aria-pressed={!!slot.shuffle}
                      >
                        <Shuffle
                          class="size-3 {slot.shuffle
                            ? 'text-primary'
                            : 'text-muted-foreground/30'}"
                        />
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
  @media (prefers-reduced-motion: reduce) {
    .mixer-panel {
      transition: none;
    }
  }
</style>
