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

  // Fix 1: Reset mute state when slot identity changes
  $effect(() => {
    slot.id; // track slot identity
    mutedVolume = null; // reset mute when a different slot is bound
  });

  // Fix 3: Busy guard to prevent double-invocation
  let busy = $state(false);

  async function togglePlayback() {
    if (busy) return;
    busy = true;
    try {
      if (isSlotPlaying) {
        await audioEngine.pauseSlot(slot.id);
      } else {
        await audioEngine.resumeSlot(slot.id);
      }
    } finally {
      busy = false;
    }
  }

  function toggleMute() {
    if (mutedVolume !== null) {
      audioEngine.setSlotVolume(slot.id, mutedVolume);
      mutedVolume = null;
    } else {
      mutedVolume = currentVolume;
      audioEngine.setSlotVolume(slot.id, 0);
    }
  }

  function handleVolumeInput(e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    audioEngine.setSlotVolume(slot.id, value);
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
        volume: currentVolume,
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
        volume: currentVolume,
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
      aria-label={isSlotPlaying ? "Pause track" : "Play track"}
    >
      {#if isSlotPlaying}
        <Pause class="size-3 text-sidebar-foreground" />
      {:else}
        <Play class="size-3 text-sidebar-foreground" />
      {/if}
    </button>
  </div>

  <!-- Row 2: mute + volume slider + loop (+ shuffle for spotify playlists) -->
  <div class="flex items-center gap-1.5">
    <button
      class="shrink-0 flex items-center justify-center size-5 rounded-sm hover:bg-sidebar-accent transition-colors"
      onclick={toggleMute}
      aria-label={isMuted ? "Unmute track" : "Mute track"}
    >
      {#if isMuted}
        <VolumeOff class="size-3 text-muted-foreground/50" />
      {:else}
        <Volume2 class="size-3 text-muted-foreground/70" />
      {/if}
    </button>

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
        aria-label="Track volume"
        aria-valuetext="{Math.round((isMuted ? 0 : currentVolume) * 100)}%"
      />
    </div>

    <button
      class="shrink-0 flex items-center justify-center size-5 rounded-sm hover:bg-sidebar-accent transition-colors"
      onclick={toggleLoop}
      aria-label={slot.loop ? "Disable loop" : "Enable loop"}
      aria-pressed={slot.loop}
    >
      <Repeat class="size-3 {slot.loop ? 'text-primary' : 'text-muted-foreground/30'}" />
    </button>

    {#if isPlaylist}
      <button
        class="shrink-0 flex items-center justify-center size-5 rounded-sm hover:bg-sidebar-accent transition-colors"
        onclick={toggleShuffle}
        aria-label={slot.shuffle ? "Disable shuffle" : "Enable shuffle"}
        aria-pressed={!!slot.shuffle}
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
