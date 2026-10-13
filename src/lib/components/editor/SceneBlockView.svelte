<!-- src/lib/components/editor/SceneBlockView.svelte -->
<script lang="ts">
  import { scenes } from "$lib/stores/scenes.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import {
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
    ArrowLeftRight,
    Columns2,
    CircleAlert,
  } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import * as Popover from "$lib/components/ui/popover";
  import ScenePicker from "$lib/components/panes/ScenePicker.svelte";
  import { audioEngine, isPlaylistSlot } from "$lib/stores/audio-engine.svelte";
  import { api } from "$lib/api";
  import type { SceneRef } from "$lib/editor/scene-block.svelte";
  import type { SceneSlot } from "$lib/types/ledger";
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

  // ── Choosing a scene ──────────────────────────────────────────────────────

  // The name written into the fence beside the id comes from the store, never from
  // the file — a scene the picker just listed is one the store has a live name for.
  function bindScene(id: number) {
    const scene = scenes.scenes.find((s) => s.id === id);
    if (scene) onUpdate({ sceneId: scene.id, sceneName: scene.name });
  }

  // A scene made here is empty, so it opens beside the note: adding its tracks is the
  // GM's next step, and it is one gesture away rather than a trip to find it.
  async function createAndBind(name: string) {
    try {
      const scene = await scenes.createScene(name || "New Scene");
      onUpdate({ sceneId: scene.id, sceneName: scene.name });
      tabs.openTabOpposite({ type: "scene", id: scene.id, title: scene.name });
    } catch (e) {
      console.error("create scene failed:", e);
    }
  }

  // The picker takes focus when it appears because of something the GM just did —
  // `/scene` typed in the editor, or "Choose a scene" on a deleted one — and not when a
  // note that happens to hold an empty block is opened.
  let focusPicker = $state(
    typeof document !== "undefined" && !!document.activeElement?.closest(".ProseMirror"),
  );

  // A deleted scene's block offers to choose another: back to the picker, focused.
  function chooseAnother() {
    focusPicker = true;
    onUpdate({ sceneId: null, sceneName: "" });
  }

  let changeOpen = $state(false);

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
  // Every state here is THIS scene's, from the engine's one answer for it (`sceneState`),
  // as the scene editor's are. The block used to read a paused scene as playing — the
  // engine's playing flag stays up through a pause — so its button kept saying Pause and
  // the scene could not be resumed from the note.
  const sceneState = $derived(audioEngine.sceneState(ref.sceneId));
  const isThisSceneLoading = $derived(sceneState === "loading");
  const isThisScenePaused = $derived(sceneState === "paused");
  const isThisScenePlaying = $derived(sceneState === "playing");
  const showBars = $derived(isThisScenePlaying);
  const sceneLabel = $derived(thisScene?.name ?? "scene");
  // A scene with no tracks has nothing to play; starting it would silently stop whatever
  // the room is hearing. Play is unavailable and the strip offers to add tracks.
  const isEmpty = $derived(!slotsLoading && activeSlots.length === 0);

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
    if (isEmpty && !isThisSceneActive) return;
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

  // Beside the note, not in its place: opening the scene used to replace the note the GM
  // was reading at the table.
  function openBeside() {
    if (!thisScene) return;
    tabs.openTabOpposite({ type: "scene", id: thisScene.id, title: thisScene.name });
  }

  function toggleExpanded() {
    expanded = !expanded;
  }

  // ── Per-slot controls ─────────────────────────────────────────────────────

  // slot.id → volume shown in the fill bar (updated immediately on drag)
  let slotDisplayVols = new SvelteMap<number, number>();
  // slot.ids with in-flight play/pause toggle
  let busySlots = new SvelteSet<number>();

  // A track's mute is the engine's, shared with the mini player, and kept for a scene
  // that has not started; its level is untouched by it, and moving the slider unmutes.
  function getSlotDisplayVolume(slot: SceneSlot): number {
    if (audioEngine.isSlotMuted(slot.id)) return 0;
    return slotDisplayVols.get(slot.id) ?? slot.volume;
  }

  function handleSlotVolumeInput(value: number, slot: SceneSlot) {
    slotDisplayVols.set(slot.id, value);
    audioEngine.setSlotVolume(slot.id, value);
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

<div class="@container my-3">
  {#if ref.sceneId === null}
    <!-- ── No scene chosen: the shared picker, inside the block's own frame ────────── -->
    <div class="rounded-lg border border-border bg-card/40 p-2 select-none">
      <p class="px-1 pb-1.5 text-xs font-semibold text-muted-foreground">
        Choose a scene to play from this note
      </p>
      <ScenePicker
        tint="scene"
        framed={false}
        autofocus={focusPicker}
        onSelect={bindScene}
        onNewScene={createAndBind}
      />
    </div>
  {:else if !thisScene && scenes.isLoading}
    <div class="h-11 animate-pulse rounded-lg border border-border bg-card/40" aria-hidden="true"></div>
  {:else if !thisScene}
    <!-- ── The scene was deleted. Its own state, not a player whose every control does
         nothing. The name the fence remembers is not shown: a stale copy lies (#185). -->
    <div
      class="flex items-center gap-2.5 rounded-lg border border-border bg-card/40 px-3 py-2 select-none"
      data-scene-missing
    >
      <CircleAlert class="size-4 shrink-0 text-muted-foreground" />
      <p class="min-w-0 flex-1 text-sm text-muted-foreground">This scene no longer exists.</p>
      <Button variant="outline" size="sm" onclick={chooseAnother}>Choose a scene</Button>
    </div>
  {:else}
    <!-- ── Compact strip + expandable mixer ─────────────────────────────────────── -->
    <div
      class="overflow-hidden rounded-lg border bg-card/40 select-none transition-colors duration-200
             {isThisScenePlaying ? 'border-primary/60' : 'border-border'}"
    >
      <div class="flex items-center gap-1 px-1.5 py-1.5">
        <!-- Play / Pause / Resume: the strip's one keyboard play control. -->
        <button
          bind:this={playButton}
          onclick={handlePlayPause}
          aria-disabled={isThisSceneLoading || (isEmpty && !isThisSceneActive)}
          title={isEmpty && !isThisSceneActive ? "No tracks yet" : undefined}
          class="flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted
                 aria-disabled:cursor-default aria-disabled:opacity-50
                 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          aria-label={isThisScenePlaying
            ? `Pause ${sceneLabel}`
            : isThisScenePaused
              ? `Resume ${sceneLabel}`
              : `Play ${sceneLabel}`}
        >
          {#if isThisSceneLoading}
            <LoaderCircle class="size-4 animate-spin text-muted-foreground" />
          {:else if isThisScenePlaying}
            <Pause class="size-4 text-foreground" />
          {:else}
            <Play class="size-4 text-foreground" />
          {/if}
        </button>

        {#if isThisSceneActive}
          <button
            onclick={handleStopScene}
            class="flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted
                   focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            aria-label="Stop {sceneLabel}"
          >
            <Square class="size-3.5 text-muted-foreground" />
          </button>
        {/if}

        <!-- The scene itself — chip and name — is the play target for the pointer, as a
             dashboard card's picture and a PDF passage are. Not a second Tab stop: the
             button beside it is the keyboard's. -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div
          class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 transition-colors
                 {isEmpty && !isThisSceneActive ? '' : 'cursor-pointer hover:bg-muted/60'}"
          onclick={handlePlayPause}
        >
          <span
            class="flex size-6 shrink-0 items-center justify-center rounded-sm"
            style="background-color: {chipColor}"
            aria-hidden="true"
          >
            <ChipIcon class="size-3.5" style="color: {chipIconColor}" strokeWidth={1.75} />
          </span>
          <span class="font-heading min-w-0 truncate text-sm leading-tight text-foreground">
            {thisScene.name}
          </span>
          {#if showBars}
            <NowPlayingBars />
          {/if}
        </div>

        {#if isEmpty}
          <button
            type="button"
            onclick={openBeside}
            class="shrink-0 rounded-sm px-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline
                   focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            No tracks · Add some
          </button>
        {/if}

        <button
          onclick={openBeside}
          class="flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted
                 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          aria-label="Open {sceneLabel} beside this note"
          title="Open beside this note"
        >
          <!-- Two equal columns, no direction: the scene opens in the other pane, which
               may be left or right of this one. -->
          <Columns2 class="size-3.5 text-muted-foreground" />
        </button>

        <!-- Change scene: a dropdown that keeps the current scene until another is
             chosen. It used to unbind at once, 32px from Expand, leaving the GM a picker
             with no way back but Ctrl+Z. -->
        <Popover.Root bind:open={changeOpen}>
          <Popover.Trigger>
            {#snippet child({ props })}
              <button
                {...props}
                class="flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted
                       focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                aria-label="Change scene"
                title="Change scene"
              >
                <ArrowLeftRight class="size-3.5 text-muted-foreground" />
              </button>
            {/snippet}
          </Popover.Trigger>
          <Popover.Content align="end" class="w-64 p-1.5">
            <ScenePicker
              tint="scene"
              framed={false}
              currentSceneId={thisScene.id}
              onSelect={(id) => {
                changeOpen = false;
                bindScene(id);
              }}
              onNewScene={(name) => {
                changeOpen = false;
                void createAndBind(name);
              }}
              onCancel={() => (changeOpen = false)}
            />
          </Popover.Content>
        </Popover.Root>

        <button
          onclick={toggleExpanded}
          class="flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted
                 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          aria-label={expanded ? "Collapse mixer" : "Expand mixer"}
          aria-expanded={expanded}
        >
          {#if expanded}
            <ChevronUp class="size-4 text-muted-foreground" />
          {:else}
            <ChevronDown class="size-4 text-muted-foreground" />
          {/if}
        </button>
      </div>

      <!-- Expandable mixer panel — grid-rows slide (snaps under reduced-motion) -->
      <div
        class="mixer-panel grid transition-[grid-template-rows] duration-200 ease-out overflow-hidden"
        style="grid-template-rows: {expanded ? '1fr' : '0fr'}"
      >
        <!-- `inert` while collapsed: a closed mixer's controls were still Tab stops,
             invisible ones, and arrow keys changed a volume nobody could see. -->
        <div class="min-h-0" inert={!expanded}>
          <div class="border-t border-border px-1 py-1">
            {#if slotsLoading}
              <div class="space-y-1 px-1 py-1" aria-hidden="true">
                {#each { length: 2 } as _, i (i)}
                  <div class="h-8 animate-pulse rounded-md bg-muted/50"></div>
                {/each}
              </div>
            {:else if activeSlots.length === 0}
              <p class="px-2 py-2 text-xs text-muted-foreground">
                No tracks yet. <button
                  class="rounded-sm text-foreground underline underline-offset-2
                         focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                  onclick={openBeside}>Add tracks</button
                > in the scene editor.
              </p>
            {:else}
              {#each activeSlots as slot (slot.id)}
                {@const isPlaying = isThisSceneActive && audioEngine.isSlotPlaying(slot.id)}
                {@const displayVol = getSlotDisplayVolume(slot)}
                {@const isMuted = audioEngine.isSlotMuted(slot.id)}
                {@const isPlaylist = isPlaylistSlot(slot)}

                <!-- One row per track, as in the scene editor. -->
                <div class="flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-muted/50">
                  <button
                    onclick={() => toggleSlotPlayback(slot)}
                    aria-disabled={busySlots.has(slot.id)}
                    class="flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted
                           focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                    aria-label={isPlaying
                      ? `Pause ${slot.label}`
                      : isThisSceneActive
                        ? `Play ${slot.label}`
                        : `Play ${slot.label} on its own`}
                  >
                    {#if isPlaying}
                      <Pause class="size-3.5 text-foreground" />
                    {:else}
                      <Play class="size-3.5 text-muted-foreground" />
                    {/if}
                  </button>

                  <!-- Skip, for a playlist that is sounding: they act on the playing queue,
                       so they appear with it, in the row rather than as a row of their own. -->
                  {#if isPlaylist && isPlaying}
                    <button
                      onclick={() => audioEngine.skipPrev()}
                      class="flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted
                             focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                      aria-label="Previous track in {slot.label}"
                    >
                      <SkipBack class="size-3.5 text-muted-foreground" />
                    </button>
                    <button
                      onclick={() => audioEngine.skipNext()}
                      class="flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted
                             focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                      aria-label="Next track in {slot.label}"
                    >
                      <SkipForward class="size-3.5 text-muted-foreground" />
                    </button>
                  {/if}

                  <span class="min-w-0 flex-1 truncate px-1 text-sm text-foreground">{slot.label}</span>
                  <span
                    class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] leading-none font-medium text-muted-foreground @max-md:hidden"
                    >{slot.source === "spotify" ? "Spotify" : "Local"}</span
                  >

                  <button
                    onclick={() => audioEngine.toggleSlotMute(slot.id)}
                    class="flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted
                           focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                    aria-label="Mute {slot.label}"
                    aria-pressed={isMuted}
                  >
                    {#if isMuted}
                      <VolumeOff class="size-3.5 text-muted-foreground" />
                    {:else}
                      <Volume2 class="size-3.5 text-muted-foreground" />
                    {/if}
                  </button>

                  <VolumeSlider
                    class="w-24 @max-sm:w-14"
                    value={displayVol}
                    label="{slot.label} volume"
                    active={isPlaying}
                    oninput={(v) => handleSlotVolumeInput(v, slot)}
                    onchange={(v) => handleSlotVolumeChange(v, slot)}
                  />

                  <!-- Loop and shuffle: named once and pressed or not, rather than a label
                       that changed underneath an aria-pressed saying the same thing. Off is
                       Ember Muted, the app's resting colour for a live control; 30% read as
                       disabled. Shuffle only for a Spotify playlist. -->
                  <button
                    onclick={() => toggleLoop(slot)}
                    class="flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted
                           focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                    aria-label="Loop {slot.label}"
                    aria-pressed={slot.loop}
                    title="Loop"
                  >
                    <Repeat class="size-3.5 {slot.loop ? 'text-primary' : 'text-muted-foreground'}" />
                  </button>
                  {#if isPlaylist}
                    <button
                      onclick={() => toggleShuffle(slot)}
                      class="flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted
                             focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                      aria-label="Shuffle {slot.label}"
                      aria-pressed={!!slot.shuffle}
                      title="Shuffle"
                    >
                      <Shuffle
                        class="size-3.5 {slot.shuffle ? 'text-primary' : 'text-muted-foreground'}"
                      />
                    </button>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  @media (prefers-reduced-motion: reduce) {
    .mixer-panel {
      transition: none;
    }
  }
</style>
