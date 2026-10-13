<script lang="ts">
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import { scenes } from "$lib/stores/scenes.svelte";
  import type { SceneSlot } from "$lib/types/ledger";
  import VolumeSlider from "$lib/components/VolumeSlider.svelte";
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

  let isSlotPlaying = $derived(audioEngine.isSlotPlaying(slot.id));
  let currentVolume = $derived(audioEngine.slotVolume(slot.id) ?? slot.volume);
  let isMuted = $derived(audioEngine.isSlotMuted(slot.id));
  let isSpotify = $derived(slot.source === "spotify");
  let isPlaylist = $derived(
    isSpotify && (slot.source_id.includes(":playlist:") || slot.source_id.includes(":album:")),
  );

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
    audioEngine.toggleSlotMute(slot.id);
  }

  function handleVolumeInput(value: number) {
    audioEngine.setSlotVolume(slot.id, value);
  }

  async function handleVolumeChange(value: number) {
    try {
      await scenes.patchSlot(slot, { volume: value });
    } catch (err) {
      console.error("Failed to save volume:", err);
    }
  }

  async function toggleLoop() {
    try {
      await scenes.patchSlot(slot, { loop: !slot.loop });
    } catch (e) {
      console.error("Failed to toggle loop:", e);
    }
  }

  async function toggleShuffle() {
    try {
      await scenes.patchSlot(slot, { shuffle: !slot.shuffle });
    } catch (e) {
      console.error("Failed to toggle shuffle:", e);
    }
  }
</script>

<div
  class="group flex flex-col gap-1.5 rounded-md px-2 py-1.5 hover:bg-sidebar-accent/50 transition-colors"
>
  <!-- Row 1: source icon + label + play/pause -->
  <div class="flex items-center gap-2 min-w-0">
    {#if isSpotify}
      <span
        class="shrink-0 rounded-full bg-green-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-green-400 leading-none"
        >S</span
      >
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

    <VolumeSlider
      class="w-auto flex-1"
      value={isMuted ? 0 : currentVolume}
      label="{slot.label} volume"
      active={isSlotPlaying}
      oninput={handleVolumeInput}
      onchange={handleVolumeChange}
    />

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
