# Sidebar Mini Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mini music player pinned to the sidebar footer that shows the active scene, provides master/per-track playback controls, and expands to reveal individual track management.

**Architecture:** Three new Svelte 5 components (`MiniPlayer`, `MiniPlayerTrack`, `MiniPlayerVisualizer`) integrated into `AppSidebar.svelte`'s footer. All state comes from existing `audioEngine` and `scenes` stores — no new stores or backend changes needed. The player reads `audioEngine.activeSceneId` + `audioEngine.slotStates` for live playback state, and `scenes.getSlots()` for track metadata. Volume/mute are transient (component-local); loop/shuffle changes persist to the DB via `invoke("update_scene_slot", ...)` matching the existing pattern in the scene detail page.

**Tech Stack:** Svelte 5 runes, shadcn-svelte sidebar primitives, Lucide icons, Tailwind CSS, existing `audioEngine` + `scenes` stores, Canvas API for visualizer.

---

### Task 1: MiniPlayerVisualizer — tiny equalizer bars

**Files:**
- Create: `src/lib/components/sidebar/MiniPlayerVisualizer.svelte`

This is a small canvas-based component that renders 4 animated equalizer bars using the `audioEngine.analyserNode`. It gives the "alive and playing" feel without being decorative noise.

- [ ] **Step 1: Create the visualizer component**

```svelte
<!-- src/lib/components/sidebar/MiniPlayerVisualizer.svelte -->
<script lang="ts">
  import { audioEngine } from "$lib/stores/audio-engine.svelte";

  let canvas = $state<HTMLCanvasElement | null>(null);
  let animationId = $state(0);

  const BAR_COUNT = 4;
  const BAR_GAP = 2;
  const BAR_WIDTH = 3;
  const WIDTH = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP;
  const HEIGHT = 16;

  function draw() {
    const analyser = audioEngine.analyserNode;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !analyser) {
      // Draw idle bars (small static height)
      if (ctx) {
        ctx.clearRect(0, 0, WIDTH, HEIGHT);
        const style = getComputedStyle(canvas!);
        ctx.fillStyle = style.getPropertyValue("color");
        for (let i = 0; i < BAR_COUNT; i++) {
          const x = i * (BAR_WIDTH + BAR_GAP);
          ctx.fillRect(x, HEIGHT - 2, BAR_WIDTH, 2);
        }
      }
      animationId = requestAnimationFrame(draw);
      return;
    }

    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);

    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const style = getComputedStyle(canvas!);
    ctx.fillStyle = style.getPropertyValue("color");

    // Sample a few frequency bins spread across the spectrum
    const binStep = Math.floor(data.length / (BAR_COUNT + 1));
    for (let i = 0; i < BAR_COUNT; i++) {
      const binIndex = (i + 1) * binStep;
      const value = data[binIndex] / 255;
      const barHeight = Math.max(2, value * HEIGHT);
      const x = i * (BAR_WIDTH + BAR_GAP);
      ctx.fillRect(x, HEIGHT - barHeight, BAR_WIDTH, barHeight);
    }

    animationId = requestAnimationFrame(draw);
  }

  $effect(() => {
    if (canvas && audioEngine.isPlaying) {
      animationId = requestAnimationFrame(draw);
      return () => cancelAnimationFrame(animationId);
    }
  });
</script>

<canvas
  bind:this={canvas}
  width={WIDTH}
  height={HEIGHT}
  class="text-primary"
  style="width: {WIDTH}px; height: {HEIGHT}px;"
></canvas>
```

- [ ] **Step 2: Verify visually**

Run `bun run tauri dev`, play a scene from the scene detail page, and temporarily render `<MiniPlayerVisualizer />` anywhere to confirm the bars animate. Check that:
- Bars respond to audio frequency
- When nothing plays, bars show at minimum 2px height
- Color matches `--primary`

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/sidebar/MiniPlayerVisualizer.svelte
git commit -m "feat: add MiniPlayerVisualizer canvas equalizer component"
```

---

### Task 2: MiniPlayerTrack — per-track row in expanded view

**Files:**
- Create: `src/lib/components/sidebar/MiniPlayerTrack.svelte`

Each track row shows: source icon, label, play/pause, mute, volume slider, loop toggle. Spotify tracks additionally get skip prev/next and shuffle. Fits the 256px sidebar width.

- [ ] **Step 1: Create the track component**

```svelte
<!-- src/lib/components/sidebar/MiniPlayerTrack.svelte -->
<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import { scenes } from "$lib/stores/scenes.svelte";
  import type { SceneSlot } from "$lib/types/vault";
  import {
    Play,
    Pause,
    Repeat,
    Shuffle,
    SkipBack,
    SkipForward,
    Volume2,
    VolumeOff,
    Music2,
  } from "@lucide/svelte";

  let { slot }: { slot: SceneSlot } = $props();

  let mutedVolume = $state<number | null>(null);

  let slotState = $derived(audioEngine.slotStates.get(slot.id));
  let isSlotPlaying = $derived(slotState?.playing ?? false);
  let currentVolume = $derived(slotState?.volume ?? slot.volume);
  let isMuted = $derived(mutedVolume !== null);
  let isSpotify = $derived(slot.source === "spotify");
  let isPlaylist = $derived(
    isSpotify &&
      (slot.source_id.includes(":playlist:") ||
        slot.source_id.includes(":album:"))
  );

  async function togglePlayback() {
    if (isSlotPlaying) {
      await audioEngine.pauseSlot(slot.id);
    } else {
      await audioEngine.resumeSlot(slot.id);
    }
  }

  function toggleMute() {
    if (mutedVolume !== null) {
      // Unmute — restore saved volume
      audioEngine.setSlotVolume(slot.id, mutedVolume);
      mutedVolume = null;
    } else {
      // Mute — save current and zero out
      mutedVolume = currentVolume;
      audioEngine.setSlotVolume(slot.id, 0);
    }
  }

  function handleVolumeInput(e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    audioEngine.setSlotVolume(slot.id, value);
    // Clear mute state if user manually adjusts
    if (mutedVolume !== null) mutedVolume = null;
  }

  async function handleVolumeChange(e: Event) {
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
      console.error("Failed to save volume:", err);
    }
  }

  async function toggleLoop() {
    try {
      await invoke("update_scene_slot", {
        id: slot.id,
        label: slot.label,
        volume: slot.volume,
        loop: !slot.loop,
        slotOrder: slot.slot_order,
        shuffle: !!slot.shuffle,
      });
      if (audioEngine.activeSceneId) {
        scenes.invalidateSlots(audioEngine.activeSceneId);
      }
    } catch (e) {
      console.error("Failed to toggle loop:", e);
    }
  }

  async function toggleShuffle() {
    try {
      await invoke("update_scene_slot", {
        id: slot.id,
        label: slot.label,
        volume: slot.volume,
        loop: slot.loop,
        slotOrder: slot.slot_order,
        shuffle: !slot.shuffle,
      });
      if (audioEngine.activeSceneId) {
        scenes.invalidateSlots(audioEngine.activeSceneId);
      }
    } catch (e) {
      console.error("Failed to toggle shuffle:", e);
    }
  }
</script>

<div class="group flex flex-col gap-1.5 rounded-md px-2 py-1.5 hover:bg-sidebar-accent/50 transition-colors">
  <!-- Row 1: source icon + label + play/pause -->
  <div class="flex items-center gap-2 min-w-0">
    {#if isSpotify}
      <span class="shrink-0 rounded-full bg-green-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-green-400 leading-none">S</span>
    {:else}
      <Music2 class="size-3 shrink-0 text-muted-foreground/50" />
    {/if}

    <span class="flex-1 truncate text-xs text-sidebar-foreground">{slot.label}</span>

    <button
      class="shrink-0 flex items-center justify-center size-5 rounded-sm hover:bg-sidebar-accent transition-colors"
      onclick={togglePlayback}
      aria-label={isSlotPlaying ? "Pause" : "Play"}
    >
      {#if isSlotPlaying}
        <Pause class="size-3 text-sidebar-foreground" />
      {:else}
        <Play class="size-3 text-sidebar-foreground" />
      {/if}
    </button>
  </div>

  <!-- Row 2: mute + volume slider + loop (+ shuffle/skip for spotify playlists) -->
  <div class="flex items-center gap-1.5">
    <button
      class="shrink-0 flex items-center justify-center size-5 rounded-sm hover:bg-sidebar-accent transition-colors"
      onclick={toggleMute}
      aria-label={isMuted ? "Unmute" : "Mute"}
    >
      {#if isMuted}
        <VolumeOff class="size-3 text-muted-foreground/50" />
      {:else}
        <Volume2 class="size-3 text-muted-foreground/70" />
      {/if}
    </button>

    <!-- Volume slider -->
    <div class="relative flex flex-1 items-center">
      <div class="relative h-1 w-full rounded-full bg-sidebar-accent">
        <div
          class="absolute inset-y-0 left-0 rounded-full bg-primary/50"
          style="width: {(isMuted ? 0 : currentVolume) * 100}%"
        ></div>
      </div>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={isMuted ? 0 : currentVolume}
        class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        oninput={handleVolumeInput}
        onchange={handleVolumeChange}
      />
    </div>

    <!-- Loop toggle -->
    <button
      class="shrink-0 flex items-center justify-center size-5 rounded-sm hover:bg-sidebar-accent transition-colors"
      onclick={toggleLoop}
      aria-label="Toggle loop"
    >
      <Repeat class="size-3 {slot.loop ? 'text-primary' : 'text-muted-foreground/30'}" />
    </button>

    <!-- Spotify playlist controls -->
    {#if isPlaylist}
      <button
        class="shrink-0 flex items-center justify-center size-5 rounded-sm hover:bg-sidebar-accent transition-colors"
        onclick={toggleShuffle}
        aria-label="Toggle shuffle"
      >
        <Shuffle class="size-3 {slot.shuffle ? 'text-primary' : 'text-muted-foreground/30'}" />
      </button>
    {/if}
  </div>

  <!-- Row 3: Spotify skip controls (only when playing a playlist) -->
  {#if isSpotify && isPlaylist && isSlotPlaying}
    <div class="flex items-center justify-center gap-1">
      <button
        class="flex items-center justify-center size-5 rounded-sm hover:bg-sidebar-accent transition-colors"
        onclick={() => audioEngine.skipPrev()}
        aria-label="Previous track"
      >
        <SkipBack class="size-3 text-sidebar-foreground" />
      </button>
      <button
        class="flex items-center justify-center size-5 rounded-sm hover:bg-sidebar-accent transition-colors"
        onclick={() => audioEngine.skipNext()}
        aria-label="Next track"
      >
        <SkipForward class="size-3 text-sidebar-foreground" />
      </button>
    </div>
  {/if}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/sidebar/MiniPlayerTrack.svelte
git commit -m "feat: add MiniPlayerTrack component for per-track controls"
```

---

### Task 3: MiniPlayer — main orchestrator component

**Files:**
- Create: `src/lib/components/sidebar/MiniPlayer.svelte`

This is the main component. It sits in the sidebar footer and has three states:
1. **Inactive** — no scene playing, shows nothing (zero height)
2. **Collapsed** — scene name, visualizer, play/pause, stop, master volume with mute, expand chevron
3. **Expanded** — collapsed controls + scrollable track list

- [ ] **Step 1: Create the MiniPlayer component**

```svelte
<!-- src/lib/components/sidebar/MiniPlayer.svelte -->
<script lang="ts">
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import { scenes } from "$lib/stores/scenes.svelte";
  import type { SceneSlot } from "$lib/types/vault";
  import MiniPlayerTrack from "./MiniPlayerTrack.svelte";
  import MiniPlayerVisualizer from "./MiniPlayerVisualizer.svelte";
  import {
    Play,
    Pause,
    Square,
    Volume2,
    VolumeOff,
    ChevronUp,
    LoaderCircle,
  } from "@lucide/svelte";

  let expanded = $state(false);
  let masterMutedVolume = $state<number | null>(null);
  let activeSlots = $state<SceneSlot[]>([]);

  let sceneName = $derived(
    scenes.scenes.find((s) => s.id === audioEngine.activeSceneId)?.name ?? "Unknown Scene"
  );
  let isActive = $derived(audioEngine.activeSceneId !== null);
  let isMasterMuted = $derived(masterMutedVolume !== null);

  // Load slots when active scene changes
  $effect(() => {
    const sceneId = audioEngine.activeSceneId;
    if (sceneId) {
      scenes.getSlots(sceneId).then((slots) => {
        activeSlots = slots;
      });
    } else {
      activeSlots = [];
      expanded = false;
    }
  });

  // Reset expanded state when scene stops
  $effect(() => {
    if (!audioEngine.isPlaying) {
      expanded = false;
    }
  });

  function togglePlayPause() {
    if (!audioEngine.activeSceneId) return;
    // Pause all slots vs resume all
    for (const [slotId, state] of audioEngine.slotStates.entries()) {
      if (audioEngine.isPlaying && state.playing) {
        audioEngine.pauseSlot(slotId);
      } else if (!audioEngine.isPlaying || !state.playing) {
        audioEngine.resumeSlot(slotId);
      }
    }
  }

  function handleStop() {
    audioEngine.stopAll();
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

  // Determine if *all* active slots are paused (to show play vs pause)
  let allPaused = $derived(() => {
    if (audioEngine.slotStates.size === 0) return true;
    for (const state of audioEngine.slotStates.values()) {
      if (state.playing) return false;
    }
    return true;
  });
</script>

{#if isActive}
  <div class="border-t border-sidebar-border">
    <!-- Collapsed: always-visible controls -->
    <div class="px-2 pt-2 pb-1.5">
      <!-- Scene name + visualizer + crossfade indicator -->
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
        >
          <ChevronUp
            class="size-3.5 text-muted-foreground transition-transform duration-200 {expanded ? '' : 'rotate-180'}"
          />
        </button>
      </div>

      <!-- Transport: play/pause, stop, mute, master volume -->
      <div class="flex items-center gap-1">
        <!-- Play / Pause -->
        <button
          class="shrink-0 flex items-center justify-center size-6 rounded-sm hover:bg-sidebar-accent transition-colors"
          onclick={togglePlayPause}
          aria-label={allPaused() ? "Resume" : "Pause"}
        >
          {#if allPaused()}
            <Play class="size-3.5 text-sidebar-foreground" />
          {:else}
            <Pause class="size-3.5 text-sidebar-foreground" />
          {/if}
        </button>

        <!-- Stop -->
        <button
          class="shrink-0 flex items-center justify-center size-6 rounded-sm hover:bg-sidebar-accent transition-colors"
          onclick={handleStop}
          aria-label="Stop"
        >
          <Square class="size-3 text-sidebar-foreground" />
        </button>

        <!-- Mute -->
        <button
          class="shrink-0 flex items-center justify-center size-6 rounded-sm hover:bg-sidebar-accent transition-colors"
          onclick={toggleMasterMute}
          aria-label={isMasterMuted ? "Unmute" : "Mute"}
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
              style="width: {(isMasterMuted ? 0 : audioEngine.masterVolume) * 100}%"
            ></div>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={isMasterMuted ? 0 : audioEngine.masterVolume}
            class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            oninput={handleMasterVolumeInput}
          />
        </div>
      </div>
    </div>

    <!-- Expanded: track list -->
    <div
      class="grid transition-[grid-template-rows] duration-200 ease-out"
      style="grid-template-rows: {expanded ? '1fr' : '0fr'}"
    >
      <div class="overflow-hidden">
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/sidebar/MiniPlayer.svelte
git commit -m "feat: add MiniPlayer sidebar component with collapsed/expanded states"
```

---

### Task 4: Integrate MiniPlayer into AppSidebar

**Files:**
- Modify: `src/lib/components/sidebar/AppSidebar.svelte`

Add the MiniPlayer above the vault info in the sidebar footer. It should only render when a vault is open.

- [ ] **Step 1: Add MiniPlayer import and render**

In `AppSidebar.svelte`, add the import at the top of the script:

```ts
import MiniPlayer from "./MiniPlayer.svelte";
```

Replace the `<Sidebar.Footer>` section with:

```svelte
<Sidebar.Footer>
  <MiniPlayer />
  <div
    class="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground"
  >
    <FolderOpen class="size-3.5 shrink-0" />
    <span class="flex-1 truncate">{vaultName()}</span>
    <Tooltip.Root>
      <Tooltip.Trigger
        class={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        aria-label="Settings"
        onclick={() => goto("/settings")}
      >
        <Settings class="size-3.5" />
      </Tooltip.Trigger>
      <Tooltip.Content side="top">Settings</Tooltip.Content>
    </Tooltip.Root>
  </div>
</Sidebar.Footer>
```

- [ ] **Step 2: Verify the full flow**

Run `bun run tauri dev` and test:
1. Open a vault — mini player should NOT appear (no scene active)
2. Navigate to a scene and click Play — mini player appears in sidebar footer
3. Collapsed state shows: scene name, visualizer bars, play/pause, stop, mute, master volume
4. Click expand chevron — track list slides open with `grid-template-rows` transition
5. Each track shows: source badge, label, play/pause, mute, volume, loop
6. Spotify playlist tracks show shuffle toggle and skip controls when playing
7. Click Stop — mini player disappears
8. Master mute: click speaker icon, volume bar goes to 0, audio silences; click again to restore
9. Per-track mute: same behavior per track
10. Per-track volume: drag slider, audio adjusts in real-time
11. Loop toggle: persists to DB (verify by refreshing page)
12. Cross-fade: play one scene, then play another from the sidebar favorites — crossfade spinner appears briefly

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/sidebar/AppSidebar.svelte
git commit -m "feat: integrate MiniPlayer into sidebar footer"
```

---

### Task 5: Polish and edge cases

**Files:**
- Modify: `src/lib/components/sidebar/MiniPlayer.svelte`
- Modify: `src/lib/components/sidebar/MiniPlayerTrack.svelte`

Handle edge cases discovered during testing:

- [ ] **Step 1: Sidebar collapsed (icon) mode**

When the sidebar is in icon mode (48px width), the full mini player won't fit. The sidebar uses `group-data-[collapsible=icon]` to hide content. Verify that the mini player gracefully hides or shows only a play/pause icon in this mode. The sidebar's built-in `group-data-[collapsible=icon]:hidden` class on content sections handles this — confirm the footer behaves the same way. If not, add:

```svelte
<!-- In MiniPlayer.svelte, wrap the full player -->
<div class="group-data-[collapsible=icon]:hidden">
  <!-- ... existing content ... -->
</div>
```

- [ ] **Step 2: Slot data freshness**

When the user edits a track on the `/scene/[id]` page (rename, delete, add), the mini player's `activeSlots` could go stale. Add a reactive refresh:

In `MiniPlayer.svelte`, update the slot-loading effect to also react to `scenes.scenes` (which changes when `scenes.load()` is called after mutations):

```ts
$effect(() => {
  const sceneId = audioEngine.activeSceneId;
  // Also depend on scenes list to refresh when slots are mutated
  scenes.scenes;
  if (sceneId) {
    scenes.getSlots(sceneId).then((slots) => {
      activeSlots = slots;
    });
  } else {
    activeSlots = [];
    expanded = false;
  }
});
```

- [ ] **Step 3: Verify edge cases**

1. Play a scene, expand tracks, navigate to that scene's detail page, delete a track — mini player track list updates
2. Play a scene, collapse sidebar to icon mode — player hides gracefully
3. Play a scene with only one local track — no skip/shuffle controls visible
4. Play a scene with a Spotify playlist — shuffle + skip controls appear
5. Rapidly toggle mute on/off — volume restores correctly each time

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/sidebar/MiniPlayer.svelte src/lib/components/sidebar/MiniPlayerTrack.svelte
git commit -m "fix: handle sidebar icon mode and slot data freshness in mini player"
```
