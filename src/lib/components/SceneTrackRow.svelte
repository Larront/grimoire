<!--
  @component
  One track of a scene, as a row of live controls: play or pause it, skip a playing
  Spotify playlist, mute it, set its level, loop it (and shuffle a playlist). The in-note
  player's mixer and the mini player's track list both draw their rows with it, so a
  track looks and answers the same wherever the GM reaches for it; they used to keep a
  copy each and the copies drifted — sizes, labels, colours, and a mute each surface kept
  to itself.

  Everything it shows is the engine's or the scenes store's, both shared: a mute or a
  loop changed here shows on every other surface showing the track.
-->
<script lang="ts">
  import { audioEngine, isPlaylistSlot } from "$lib/stores/audio-engine.svelte";
  import { scenes } from "$lib/stores/scenes.svelte";
  import type { SceneSlot } from "$lib/types/ledger";
  import VolumeSlider from "$lib/components/VolumeSlider.svelte";
  import { cn } from "$lib/utils";
  import {
    Pause,
    Play,
    Repeat,
    Shuffle,
    SkipBack,
    SkipForward,
    Volume2,
    VolumeOff,
  } from "@lucide/svelte";

  let { slot, class: className }: { slot: SceneSlot; class?: string } = $props();

  const isSceneActive = $derived(audioEngine.isSceneActive(slot.scene_id));
  const isPlaying = $derived(isSceneActive && audioEngine.isSlotPlaying(slot.id));
  const isMuted = $derived(audioEngine.isSlotMuted(slot.id));
  const isPlaylist = $derived(isPlaylistSlot(slot));

  // The level shown: the engine's while the scene plays, the saved one while it does not,
  // and the dragged one while a slider moves — the engine has no level for a track of a
  // scene that is not playing. A new saved level replaces a dragged one.
  let level = $derived(slot.volume);
  const shownLevel = $derived(isMuted ? 0 : (audioEngine.slotVolume(slot.id) ?? level));

  // A play or pause in flight: a second click is ignored rather than the button
  // disabled, which would drop a keyboard GM's focus to the page.
  let busy = $state(false);

  // While the scene is stopped a track plays on its own, as a preview; while it is
  // active, its button brings the track in or out.
  async function togglePlayback() {
    if (busy) return;
    busy = true;
    try {
      if (!isSceneActive) await audioEngine.previewSlot(slot.scene_id, slot.id);
      else if (audioEngine.isSlotPlaying(slot.id)) await audioEngine.pauseSlot(slot.id);
      else await audioEngine.resumeSlot(slot.id);
    } finally {
      busy = false;
    }
  }

  function setLevel(value: number) {
    level = value;
    audioEngine.setSlotVolume(slot.id, value);
  }

  async function saveLevel(value: number) {
    try {
      await scenes.patchSlot(slot, { volume: value });
    } catch (err) {
      console.error("Failed to save slot volume:", err);
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

  const button =
    "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted " +
    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";
</script>

<div
  class={cn(
    "flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-muted/50",
    className,
  )}
>
  <button
    onclick={togglePlayback}
    aria-disabled={busy}
    class={button}
    aria-label={isPlaying
      ? `Pause ${slot.label}`
      : isSceneActive
        ? `Play ${slot.label}`
        : `Play ${slot.label} on its own`}
    title={isPlaying ? "Pause" : isSceneActive ? "Play" : "Play on its own"}
  >
    {#if isPlaying}
      <Pause class="size-3.5 text-foreground" />
    {:else}
      <Play class="size-3.5 text-muted-foreground" />
    {/if}
  </button>

  <!-- Skip, for a playlist that is sounding: they act on the playing queue, so they
       appear with it, in the row rather than as a row of their own. -->
  {#if isPlaylist && isPlaying}
    <button
      onclick={() => audioEngine.skipPrev()}
      class={button}
      aria-label="Previous track in {slot.label}"
      title="Previous track"
    >
      <SkipBack class="size-3.5 text-muted-foreground" />
    </button>
    <button
      onclick={() => audioEngine.skipNext()}
      class={button}
      aria-label="Next track in {slot.label}"
      title="Next track"
    >
      <SkipForward class="size-3.5 text-muted-foreground" />
    </button>
  {/if}

  <span class="min-w-0 flex-1 truncate px-1 text-sm text-foreground" title={slot.label}
    >{slot.label}</span
  >
  <span
    class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] leading-none font-medium text-muted-foreground @max-md:hidden"
    >{slot.source === "spotify" ? "Spotify" : "Local"}</span
  >

  <!-- Muted is the state to notice, so it is drawn louder, not quieter. -->
  <button
    onclick={() => audioEngine.toggleSlotMute(slot.id)}
    class={button}
    aria-label="Mute {slot.label}"
    aria-pressed={isMuted}
    title={isMuted ? "Unmute" : "Mute"}
  >
    {#if isMuted}
      <VolumeOff class="size-3.5 text-foreground" />
    {:else}
      <Volume2 class="size-3.5 text-muted-foreground" />
    {/if}
  </button>

  <VolumeSlider
    class="w-24 @max-sm:w-14"
    value={shownLevel}
    label="{slot.label} volume"
    active={isPlaying && !isMuted}
    oninput={setLevel}
    onchange={saveLevel}
  />

  <!-- Loop and shuffle: named once and pressed or not, rather than a label that changed
       underneath an aria-pressed saying the same thing. Off is Ember Muted, the app's
       resting colour for a live control; 30% read as disabled. Shuffle only for a
       Spotify playlist. -->
  <button
    onclick={toggleLoop}
    class={button}
    aria-label="Loop {slot.label}"
    aria-pressed={slot.loop}
    title="Loop"
  >
    <Repeat class="size-3.5 {slot.loop ? 'text-primary' : 'text-muted-foreground'}" />
  </button>
  {#if isPlaylist}
    <button
      onclick={toggleShuffle}
      class={button}
      aria-label="Shuffle {slot.label}"
      aria-pressed={!!slot.shuffle}
      title="Shuffle"
    >
      <Shuffle class="size-3.5 {slot.shuffle ? 'text-primary' : 'text-muted-foreground'}" />
    </button>
  {/if}
</div>
