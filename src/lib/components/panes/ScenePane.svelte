<script lang="ts">
  import { untrack } from "svelte";
  import { invoke, convertFileSrc } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import { remove } from "@tauri-apps/plugin-fs";
  import { scenes } from "$lib/stores/scenes.svelte";
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { Button } from "$lib/components/ui/button";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Rename from "$lib/components/ui/rename";
  import Input from "$lib/components/ui/input/input.svelte";
  import {
    Music2,
    Plus,
    Trash2,
    Pencil,
    Play,
    Square,
    Volume2,
    Repeat,
    Shuffle,
    Pause,
    LoaderCircle,
    SkipBack,
    SkipForward,
    Palette,
    Image as ImageIcon,
    X,
  } from "@lucide/svelte";
  import type { SceneSlot, SpotifyAuthStatus } from "$lib/types/vault";
  import {
    getSpotifyStatus,
    connectSpotify,
  } from "$lib/utils/spotify-auth";
  import { COLOR_PRESETS, ACCENT_BG, ACCENT_FG, ICON_OPTIONS, ICON_MAP } from "./thumbnail-presets";

  interface Props {
    sceneId: number;
    pane: 'left' | 'right';
  }
  let { sceneId, pane }: Props = $props();

  // ---- Scene lookup ----
  let scene = $derived(scenes.scenes.find((s) => s.id === sceneId) ?? null);

  // ---- Hero header ----

  let heroColor = $derived(scene ? (scene.thumbnail_color ?? ACCENT_BG[scene.id % 5]) : ACCENT_BG[0]);
  let heroIconColor = $derived(scene ? ACCENT_FG[scene.id % 5] : ACCENT_FG[0]);
  let thumbnailUrl = $state<string | null>(null);

  $effect(() => {
    const path = scene?.thumbnail_path;
    if (path) {
      invoke<string>("get_audio_absolute_path", { relativePath: path })
        .then((abs) => { thumbnailUrl = convertFileSrc(abs); })
        .catch(() => { thumbnailUrl = null; });
    } else {
      thumbnailUrl = null;
    }
  });

  // ---- Thumbnail pickers ----
  let colorPickerOpen = $state(false);
  let iconPickerOpen = $state(false);

  async function applyColor(color: string | null) {
    if (!scene) return;
    try {
      await invoke("update_scene_thumbnail", {
        id: scene.id,
        thumbnailColor: color,
        thumbnailIcon: scene.thumbnail_icon,
        thumbnailPath: scene.thumbnail_path,
      });
      await scenes.load();
    } catch (e) {
      console.error("update thumbnail color failed:", e);
    } finally {
      colorPickerOpen = false;
    }
  }

  async function applyIcon(icon: string | null) {
    if (!scene) return;
    try {
      await invoke("update_scene_thumbnail", {
        id: scene.id,
        thumbnailColor: scene.thumbnail_color,
        thumbnailIcon: icon,
        thumbnailPath: scene.thumbnail_path,
      });
      await scenes.load();
    } catch (e) {
      console.error("update thumbnail icon failed:", e);
    } finally {
      iconPickerOpen = false;
    }
  }

  async function changeThumbnail() {
    if (!scene) return;
    const picked = await open({
      title: "Choose Thumbnail Image",
      filters: [{ name: "Image", extensions: ["jpg", "jpeg", "png", "webp", "gif"] }],
    });
    if (!picked || typeof picked !== "string") return;
    const oldPath = scene.thumbnail_path;
    try {
      const relativePath = await invoke<string>("copy_thumbnail_file", { absolutePath: picked });
      await invoke("update_scene_thumbnail", {
        id: scene.id,
        thumbnailColor: scene.thumbnail_color,
        thumbnailIcon: scene.thumbnail_icon,
        thumbnailPath: relativePath,
      });
      await scenes.load();
      if (oldPath) {
        try {
          const abs = await invoke<string>("get_audio_absolute_path", { relativePath: oldPath });
          if (abs) await remove(abs);
        } catch { /* non-critical */ }
      }
    } catch (e) {
      console.error("change thumbnail failed:", e);
    }
  }

  async function removeThumbnail() {
    if (!scene) return;
    const oldPath = scene.thumbnail_path;
    try {
      await invoke("update_scene_thumbnail", {
        id: scene.id,
        thumbnailColor: scene.thumbnail_color,
        thumbnailIcon: scene.thumbnail_icon,
        thumbnailPath: null,
      });
      await scenes.load();
      if (oldPath) {
        try {
          const abs = await invoke<string>("get_audio_absolute_path", { relativePath: oldPath });
          if (abs) await remove(abs);
        } catch { /* non-critical */ }
      }
    } catch (e) {
      console.error("remove thumbnail failed:", e);
    }
  }

  // ---- Tab title sync ----
  $effect(() => {
    if (scene) {
      const name = scene.name;
      untrack(() => tabs.updateTabTitle('scene', sceneId, name));
    }
  });

  // ---- Scene name editing ----
  let draftName = $state("");
  let isSavingName = $state(false);

  $effect(() => {
    if (scene && !isSavingName) draftName = scene.name;
  });

  async function commitName() {
    if (!scene) return;
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === scene.name) {
      draftName = scene.name;
      return;
    }
    isSavingName = true;
    try {
      await invoke("update_scene", { id: scene.id, name: trimmed });
      await scenes.load();
    } catch (e) {
      console.error("name save failed:", e);
      draftName = scene.name;
    } finally {
      isSavingName = false;
    }
  }

  function handleNameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
    if (e.key === "Escape") {
      if (scene) draftName = scene.name;
      (e.target as HTMLInputElement).blur();
    }
  }

  // ---- Slots ----
  let slots = $state<SceneSlot[]>([]);
  let slotsLoading = $state(true);
  let lastLoadedSceneId = $state<number | null>(null);

  $effect(() => {
    const id = scene?.id;
    if (id && id !== lastLoadedSceneId) {
      lastLoadedSceneId = id;
      slotsLoading = true;
      scenes.getSlots(id).then((s) => {
        slots = s;
        slotsLoading = false;
      });
    }
  });

  // ---- Playback derived state ----
  let isThisScenePlaying = $derived(
    audioEngine.activeSceneId === scene?.id && audioEngine.isPlaying
  );
  let isThisSceneLoading = $derived(
    audioEngine.loadingSceneId === scene?.id
  );

  // ---- Play / Stop ----
  async function handlePlayStop() {
    if (!scene) return;
    if (isThisScenePlaying) {
      audioEngine.stopAll();
    } else {
      await audioEngine.playScene(scene.id);
    }
  }

  // ---- Scene pause / resume ----
  let scenePaused = $state(false);

  $effect(() => {
    if (!isThisScenePlaying) scenePaused = false;
  });

  async function handlePause() {
    for (const [slotId, state] of audioEngine.slotStates) {
      if (state.playing) await audioEngine.pauseSlot(slotId);
    }
    scenePaused = true;
  }

  async function handleResume() {
    for (const [slotId, state] of audioEngine.slotStates) {
      if (!state.playing) await audioEngine.resumeSlot(slotId);
    }
    scenePaused = false;
  }

  function handleStop() {
    scenePaused = false;
    audioEngine.stopAll();
  }

  // ---- Master volume ----
  function handleMasterVolumeInput(e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    audioEngine.setMasterVolume(value);
  }

  // ---- Slot volume ----
  function handleSlotVolumeInput(slot: SceneSlot, e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    const idx = slots.findIndex((s) => s.id === slot.id);
    if (idx !== -1) slots[idx] = { ...slots[idx], volume: value };
    if (isThisScenePlaying) audioEngine.setSlotVolume(slot.id, value);
  }

  async function handleSlotVolumeChange(slot: SceneSlot, e: Event) {
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

  // ---- Slot play/pause ----
  function getSlotPlaying(slotId: number): boolean {
    const state = audioEngine.slotStates.get(slotId);
    return state?.playing ?? false;
  }

  async function toggleSlotPlayback(slotId: number) {
    if (getSlotPlaying(slotId)) {
      await audioEngine.pauseSlot(slotId);
    } else {
      await audioEngine.resumeSlot(slotId);
    }
  }

  // ---- Toggle loop / shuffle ----
  async function toggleLoop(slot: SceneSlot) {
    if (!scene) return;
    try {
      await invoke("update_scene_slot", {
        id: slot.id,
        label: slot.label,
        volume: slot.volume,
        loop: !slot.loop,
        slotOrder: slot.slot_order,
        shuffle: !!slot.shuffle,
      });
      scenes.invalidateSlots(scene.id);
      slots = await scenes.getSlots(scene.id);
    } catch (e) {
      console.error("Failed to toggle loop:", e);
    }
  }

  async function toggleShuffle(slot: SceneSlot) {
    if (!scene) return;
    try {
      await invoke("update_scene_slot", {
        id: slot.id,
        label: slot.label,
        volume: slot.volume,
        loop: slot.loop,
        slotOrder: slot.slot_order,
        shuffle: !slot.shuffle,
      });
      scenes.invalidateSlots(scene.id);
      slots = await scenes.getSlots(scene.id);
    } catch (e) {
      console.error("Failed to toggle shuffle:", e);
    }
  }

  // ---- Slot rename ----
  let renamingSlotId = $state<number | null>(null);
  let renameSlotValue = $state("");

  function startSlotRename(slot: SceneSlot) {
    renameSlotValue = slot.label;
    renamingSlotId = slot.id;
  }

  async function handleSlotRename(slotId: number, newLabel: string) {
    const trimmed = newLabel.trim();
    if (!trimmed) {
      renamingSlotId = null;
      return;
    }
    const slot = slots.find((s) => s.id === slotId);
    if (!slot || !scene) return;
    try {
      await invoke("update_scene_slot", {
        id: slotId,
        label: trimmed,
        volume: slot.volume,
        loop: slot.loop,
        slotOrder: slot.slot_order,
        shuffle: !!slot.shuffle,
      });
      scenes.invalidateSlots(scene.id);
      slots = await scenes.getSlots(scene.id);
    } catch (e) {
      console.error("Failed to rename slot:", e);
    } finally {
      renamingSlotId = null;
    }
  }

  // ---- Delete slot ----
  let deleteSlotTarget = $state<SceneSlot | null>(null);

  async function confirmDeleteSlot() {
    if (!deleteSlotTarget || !scene) return;
    try {
      await invoke("delete_scene_slot", { id: deleteSlotTarget.id });
      scenes.invalidateSlots(scene.id);
      slots = await scenes.getSlots(scene.id);
      await scenes.load();
    } catch (e) {
      console.error("Failed to delete slot:", e);
    } finally {
      deleteSlotTarget = null;
    }
  }

  // ---- Add track dialog ----
  let addDialogOpen = $state(false);
  let addTab = $state<"local" | "spotify">("local");
  let addLabel = $state("");
  let addLoop = $state(true);
  let addShuffle = $state(false);
  let addSourcePath = $state("");
  let addFileName = $state("");
  let addSpotifyUri = $state("");
  let isAdding = $state(false);

  // ---- Spotify auth for add dialog ----
  let spotifyAuth = $state<SpotifyAuthStatus | null>(null);
  let spotifyAuthChecked = $state(false);
  let isSpotifyConnecting = $state(false);

  $effect(() => {
    if (addTab === "spotify" && !spotifyAuthChecked) {
      getSpotifyStatus().then((status) => {
        spotifyAuth = status;
        spotifyAuthChecked = true;
      });
    }
  });

  async function handleInlineSpotifyConnect() {
    isSpotifyConnecting = true;
    try {
      spotifyAuth = await connectSpotify();
    } catch (e) {
      console.error("Spotify connection failed:", e);
    } finally {
      isSpotifyConnecting = false;
    }
  }

  function parseSpotifyInput(
    input: string,
  ): { uri: string; type: string; id: string } | null {
    // Accept Spotify URLs: https://open.spotify.com/track/ID?si=...
    const urlMatch = input.match(
      /open\.spotify\.com\/(track|playlist|album)\/([A-Za-z0-9]+)/,
    );
    if (urlMatch) {
      return {
        uri: `spotify:${urlMatch[1]}:${urlMatch[2]}`,
        type: urlMatch[1],
        id: urlMatch[2],
      };
    }
    // Accept raw URIs: spotify:track:ID, spotify:playlist:ID, spotify:album:ID
    // Also handles playlist_v2 by normalizing to playlist
    const uriMatch = input.match(
      /^spotify:(track|playlist(?:_v2)?|album):([A-Za-z0-9]+)$/,
    );
    if (uriMatch) {
      const type = uriMatch[1].replace("playlist_v2", "playlist");
      return {
        uri: `spotify:${type}:${uriMatch[2]}`,
        type,
        id: uriMatch[2],
      };
    }
    return null;
  }

  let parsedSpotifyInput = $derived(parseSpotifyInput(addSpotifyUri.trim()));

  let canAdd = $derived(
    addLabel.trim() !== "" &&
      (addTab === "local" ? !!addSourcePath : !!parsedSpotifyInput)
  );

  function resetAddDialog() {
    addDialogOpen = false;
    addTab = "local";
    addLabel = "";
    addLoop = true;
    addShuffle = false;
    addSourcePath = "";
    addFileName = "";
    addSpotifyUri = "";
    spotifyAuthChecked = false;
  }

  async function handleFilePick() {
    const picked = await open({
      title: "Choose Audio File",
      filters: [
        {
          name: "Audio",
          extensions: ["mp3", "wav", "ogg", "flac", "m4a", "aac"],
        },
      ],
    });
    if (picked && typeof picked === "string") {
      addSourcePath = picked;
      const parts = picked.replace(/\\/g, "/").split("/");
      addFileName = parts[parts.length - 1];
      if (!addLabel) addLabel = addFileName.replace(/\.[^/.]+$/, "");
    }
  }

  async function handleAddTrack() {
    if (!scene || isAdding) return;
    isAdding = true;
    try {
      let sourceId: string;
      let source: string;
      if (addTab === "local") {
        sourceId = await invoke<string>("copy_audio_file", {
          absolutePath: addSourcePath,
        });
        source = "local";
      } else {
        const parsed = parseSpotifyInput(addSpotifyUri.trim());
        if (!parsed) return;
        sourceId = parsed.uri;
        source = "spotify";
        // Auto-fetch label from Spotify if user didn't provide one
        if (!addLabel.trim()) {
          try {
            const token = await invoke<string>("spotify_get_access_token");
            const apiType = parsed.type === "track" ? "tracks" : parsed.type === "playlist" ? "playlists" : "albums";
            const fields = parsed.type === "playlist" ? "?fields=name" : "";
            const res = await fetch(`https://api.spotify.com/v1/${apiType}/${parsed.id}${fields}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
              const data = await res.json();
              addLabel = data.name ?? `Spotify ${parsed.type}`;
            }
          } catch {
            addLabel = `Spotify ${parsed.type}`;
          }
        }
      }
      await invoke("create_scene_slot", {
        sceneId: scene.id,
        source,
        sourceId,
        label: addLabel.trim() || "Untitled",
        volume: 0.8,
        loop: addLoop,
        slotOrder: slots.length,
        shuffle: addShuffle,
      });
      scenes.invalidateSlots(scene.id);
      slots = await scenes.getSlots(scene.id);
      await scenes.load();
      resetAddDialog();
    } catch (e) {
      console.error("Failed to add track:", e);
    } finally {
      isAdding = false;
    }
  }
</script>

<div class="flex flex-1 flex-col overflow-y-auto">
  {#if scenes.isLoading}
    <!-- Loading state -->
    <div class="flex flex-1 items-center justify-center">
      <LoaderCircle class="size-8 animate-spin text-muted-foreground" />
    </div>
  {:else if !scene}
    <!-- Not found state -->
    <div class="flex flex-1 flex-col items-center justify-center">
      <p class="text-sm text-muted-foreground">Scene not found</p>
    </div>
  {:else}
    <!-- HERO HEADER -->
    {@const HeroIcon = (scene.thumbnail_icon && ICON_MAP[scene.thumbnail_icon]) ?? Music2}
    <div
      data-hero-header
      class="group relative flex min-h-52 flex-col justify-end overflow-hidden"
      style="background-color: {heroColor}; {thumbnailUrl ? `background-image: url(${thumbnailUrl}); background-size: cover; background-position: center;` : ''}"
    >
      <!-- Gradient overlay for legibility (stronger on images) -->
      <div class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent"></div>

      <!-- Icon — always rendered per ADR-0002 -->
      <div
        data-hero-icon
        data-icon-name={scene.thumbnail_icon ?? "Music2"}
        class="pointer-events-none absolute top-5 right-6"
      >
        <HeroIcon
          class="size-14 opacity-70"
          strokeWidth={1.5}
          style="color: {thumbnailUrl ? 'white' : heroIconColor}; {thumbnailUrl ? 'filter: drop-shadow(0 2px 8px rgba(0,0,0,0.6))' : ''}"
        />
      </div>

      <!-- Thumbnail edit buttons (visible on hover) -->
      <div class="absolute top-3 left-3 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          data-edit-thumbnail-btn
          class="flex items-center gap-1 rounded-md bg-black/40 px-2 py-1 text-xs text-white backdrop-blur-sm transition-colors hover:bg-black/60"
          onclick={changeThumbnail}
        >
          <ImageIcon class="size-3" />
          Image
        </button>
        {#if scene?.thumbnail_path}
          <button
            data-remove-thumbnail-btn
            class="flex items-center gap-1 rounded-md bg-black/40 px-2 py-1 text-xs text-white backdrop-blur-sm transition-colors hover:bg-black/60"
            onclick={removeThumbnail}
          >
            <X class="size-3" />
            Remove
          </button>
        {/if}
        <button
          data-edit-color-btn
          class="flex items-center gap-1 rounded-md bg-black/40 px-2 py-1 text-xs text-white backdrop-blur-sm transition-colors hover:bg-black/60"
          onclick={() => (colorPickerOpen = true)}
        >
          <Palette class="size-3" />
          Color
        </button>
        <button
          data-edit-icon-btn
          class="flex items-center gap-1 rounded-md bg-black/40 px-2 py-1 text-xs text-white backdrop-blur-sm transition-colors hover:bg-black/60"
          onclick={() => (iconPickerOpen = true)}
        >
          <HeroIcon class="size-3" />
          Icon
        </button>
      </div>

      <!-- Scene name (editable) -->
      <div class="relative z-10 px-8 pb-5">
        <input
          data-scene-name
          bind:value={draftName}
          class="font-heading w-full bg-transparent border-none outline-none p-0 text-3xl leading-tight tracking-tight placeholder:opacity-40 focus:ring-0"
          style="color: {thumbnailUrl ? 'white' : 'var(--foreground)'}; {thumbnailUrl ? 'text-shadow: 0 2px 8px rgba(0,0,0,0.5)' : ''}"
          placeholder="Untitled Scene"
          onblur={commitName}
          onkeydown={handleNameKeydown}
        />
      </div>
    </div>

    <!-- CONTROLS BAR -->
    <div class="flex items-center justify-between border-b border-border/60 px-8 py-3">
      <!-- Playback controls -->
      <div class="flex items-center gap-3">
        {#if isThisSceneLoading || audioEngine.isCrossfading}
          <Button variant="secondary" size="sm" disabled>
            <LoaderCircle class="size-3.5 animate-spin" />
            Loading...
          </Button>
        {:else if scenePaused}
          <Button variant="default" size="sm" onclick={handleResume}>
            <Play class="size-3.5" />
            Resume
          </Button>
          <Button variant="secondary" size="sm" onclick={handleStop}>
            <Square class="size-3.5" />
            Stop
          </Button>
        {:else if isThisScenePlaying}
          <Button variant="secondary" size="sm" onclick={handlePause}>
            <Pause class="size-3.5" />
            Pause
          </Button>
          <Button variant="secondary" size="sm" onclick={handlePlayStop}>
            <Square class="size-3.5" />
            Stop
          </Button>
        {:else}
          <Button variant="default" size="sm" onclick={handlePlayStop}>
            <Play class="size-3.5" />
            Play Scene
          </Button>
        {/if}

      </div>

      <!-- Master volume -->
      <div class="flex items-center gap-2">
        <Volume2 class="size-4 text-muted-foreground" />
        <div class="relative flex items-center">
          <div class="relative h-1 w-28 rounded-full bg-muted">
            <div
              class="absolute inset-y-0 left-0 rounded-full bg-primary/50"
              style="width: {audioEngine.masterVolume * 100}%"
            ></div>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={audioEngine.masterVolume}
            class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            oninput={handleMasterVolumeInput}
          />
        </div>
      </div>
    </div>

    <!-- SLOT LIST -->
    <div class="mx-auto w-full max-w-3xl px-8 pt-6 pb-20">
      {#if slotsLoading}
          <div class="space-y-3">
            {#each { length: 3 } as _, i (i)}
              <div class="h-14 animate-pulse rounded-lg bg-muted"></div>
            {/each}
          </div>
        {:else if slots.length === 0}
          <!-- Empty state -->
          <div class="flex flex-col items-center justify-center py-20">
            <div
              class="flex size-14 items-center justify-center rounded-xl bg-primary/10"
            >
              <Music2 class="size-7 text-primary/60" strokeWidth={1.5} />
            </div>
            <h2 class="mt-5 font-heading text-lg text-foreground">
              No tracks yet
            </h2>
            <p
              class="mt-2 max-w-sm text-center text-sm text-muted-foreground"
            >
              Add audio tracks to build your soundscape. Layer ambient sounds,
              music, and effects.
            </p>
            <Button
              variant="outline"
              size="sm"
              class="mt-5"
              onclick={() => (addDialogOpen = true)}
            >
              <Plus class="size-3.5" />
              Add Track
            </Button>
          </div>
        {:else}
          <div class="space-y-2">
            {#each slots as slot (slot.id)}
              <ContextMenu.Root>
                <ContextMenu.Trigger>
                  <div
                    class="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-card/50 hover:bg-card transition-colors"
                  >
                    <!-- Playback group: skip-back · play/pause · skip-forward -->
                    <div class="flex shrink-0 items-center gap-1">
                      {#if slot.source_id.startsWith("spotify:playlist:")}
                        {#if isThisScenePlaying}
                          <Button data-slot-skip-controls variant="ghost" size="icon" class="size-7 shrink-0" onclick={() => audioEngine.skipPrev()}>
                            <SkipBack class="size-3.5" />
                          </Button>
                        {:else}
                          <div data-slot-skip-controls class="flex size-7 shrink-0 items-center justify-center">
                            <SkipBack class="size-3.5 text-muted-foreground/30" />
                          </div>
                        {/if}
                      {:else}
                        <div class="size-7 shrink-0"></div>
                      {/if}

                      {#if isThisScenePlaying}
                        <Button variant="ghost" size="icon" class="size-7 shrink-0" onclick={() => toggleSlotPlayback(slot.id)}>
                          {#if getSlotPlaying(slot.id)}
                            <Pause class="size-3.5 text-foreground" />
                          {:else}
                            <Play class="size-3.5 text-foreground" />
                          {/if}
                        </Button>
                      {:else}
                        <div class="flex size-7 shrink-0 items-center justify-center">
                          <Play class="size-3.5 text-muted-foreground/30" />
                        </div>
                      {/if}

                      {#if slot.source_id.startsWith("spotify:playlist:")}
                        {#if isThisScenePlaying}
                          <Button variant="ghost" size="icon" class="size-7 shrink-0" onclick={() => audioEngine.skipNext()}>
                            <SkipForward class="size-3.5" />
                          </Button>
                        {:else}
                          <div class="flex size-7 shrink-0 items-center justify-center">
                            <SkipForward class="size-3.5 text-muted-foreground/30" />
                          </div>
                        {/if}
                      {:else}
                        <div class="size-7 shrink-0"></div>
                      {/if}
                    </div>

                    <!-- Source indicator -->
                    {#if slot.source === "spotify"}
                      <span
                        class="shrink-0 rounded-full bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium text-green-400"
                        >Spotify</span
                      >
                    {:else}
                      <Music2
                        class="size-3.5 shrink-0 text-muted-foreground/40"
                      />
                    {/if}

                    <!-- Label (renameable) -->
                    <div class="min-w-0 flex-1">
                      <Rename.Root
                        this="span"
                        class="truncate text-sm text-foreground"
                        inputClass="bg-transparent px-0 py-0 text-sm"
                        bind:value={
                          () =>
                            renamingSlotId === slot.id
                              ? renameSlotValue
                              : slot.label,
                          (val) => {
                            renameSlotValue = val;
                          }
                        }
                        bind:mode={
                          () =>
                            renamingSlotId === slot.id ? "edit" : "view",
                          (val) => {
                            if (val === "view") renamingSlotId = null;
                          }
                        }
                        onSave={(val) => handleSlotRename(slot.id, val)}
                        onCancel={() => {
                          renamingSlotId = null;
                        }}
                      />
                    </div>

                    <!-- Volume slider -->
                    <div class="relative flex shrink-0 items-center">
                      <div class="relative h-1 w-24 rounded-full bg-muted">
                        <div
                          class="absolute inset-y-0 left-0 rounded-full bg-primary/50"
                          style="width: {slot.volume * 100}%"
                        ></div>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={slot.volume}
                        class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        oninput={(e) => handleSlotVolumeInput(slot, e)}
                        onchange={(e) => handleSlotVolumeChange(slot, e)}
                      />
                    </div>

                    <!-- Loop toggle -->
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-7 shrink-0"
                      onclick={() => toggleLoop(slot)}
                    >
                      <Repeat
                        class="size-3.5 {slot.loop
                          ? 'text-primary'
                          : 'text-muted-foreground/30'}"
                      />
                    </Button>

                    <!-- Shuffle toggle -->
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-7 shrink-0"
                      onclick={() => toggleShuffle(slot)}
                    >
                      <Shuffle
                        class="size-3.5 {!!slot.shuffle
                          ? 'text-primary'
                          : 'text-muted-foreground/30'}"
                      />
                    </Button>

                  </div>
                </ContextMenu.Trigger>
                <ContextMenu.Content>
                  <ContextMenu.Item onclick={() => startSlotRename(slot)}>
                    <Pencil class="size-4" />
                    Rename
                  </ContextMenu.Item>
                  <ContextMenu.Separator />
                  <ContextMenu.Item
                    variant="destructive"
                    onclick={() => (deleteSlotTarget = slot)}
                  >
                    <Trash2 class="size-4" />
                    Delete
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Root>
            {/each}
          </div>

          <!-- Add track button -->
          <button
            onclick={() => (addDialogOpen = true)}
            class="w-full mt-3 py-3 rounded-lg border border-dashed border-border/60 text-sm text-muted-foreground hover:border-primary/30 hover:text-foreground transition-colors"
          >
            <Plus class="size-4 inline" />
            Add Track
          </button>
      {/if}
    </div>
  {/if}
</div>

<!-- Color picker dialog -->
<Dialog.Root open={colorPickerOpen} onOpenChange={(o) => { colorPickerOpen = o; }}>
  <Dialog.Content style="max-width: 18rem">
    <Dialog.Header>
      <Dialog.Title>Choose color</Dialog.Title>
    </Dialog.Header>
    <div data-color-picker class="flex flex-col gap-3">
      <div class="grid grid-cols-5 gap-2">
        {#each COLOR_PRESETS as preset (preset.name)}
          <button
            data-color-swatch={preset.name}
            aria-label={preset.label}
            class="size-9 rounded-lg border-2 border-transparent transition-all hover:scale-110 hover:border-foreground/30"
            style="background: {preset.swatch}"
            onclick={() => applyColor(preset.bg)}
          ></button>
        {/each}
      </div>
      <Button variant="ghost" size="sm" class="self-start text-muted-foreground" onclick={() => applyColor(null)}>
        Reset to default
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>

<!-- Icon picker dialog -->
<Dialog.Root open={iconPickerOpen} onOpenChange={(o) => { iconPickerOpen = o; }}>
  <Dialog.Content style="max-width: 22rem">
    <Dialog.Header>
      <Dialog.Title>Choose icon</Dialog.Title>
    </Dialog.Header>
    <div data-icon-picker class="flex flex-col gap-3">
      <div class="grid grid-cols-5 gap-2">
        {#each ICON_OPTIONS as { name, icon: Icon } (name)}
          <button
            data-icon-btn={name}
            aria-label={name}
            class="flex size-10 items-center justify-center rounded-lg border border-transparent bg-muted/50 transition-all hover:border-primary/30 hover:bg-muted"
            onclick={() => applyIcon(name)}
          >
            <Icon class="size-5 text-foreground/70" />
          </button>
        {/each}
      </div>
      <Button variant="ghost" size="sm" class="self-start text-muted-foreground" onclick={() => applyIcon(null)}>
        Reset to default
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>

<!-- Add Track dialog -->
<AlertDialog.Root
  open={addDialogOpen}
  onOpenChange={(o) => {
    if (!o) resetAddDialog();
  }}
>
  <AlertDialog.Content style="max-width: 28rem">
    <AlertDialog.Header>
      <AlertDialog.Title>Add Track</AlertDialog.Title>
    </AlertDialog.Header>

    <!-- Tab buttons -->
    <div class="flex border-b border-border">
      <button
        class="flex-1 px-4 py-2 text-sm transition-colors {addTab === 'local'
          ? 'border-b-2 border-primary text-primary font-medium'
          : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => (addTab = "local")}
      >
        Local File
      </button>
      <button
        class="flex-1 px-4 py-2 text-sm transition-colors {addTab === 'spotify'
          ? 'border-b-2 border-primary text-primary font-medium'
          : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => (addTab = "spotify")}
      >
        Spotify
      </button>
    </div>

    <!-- Tab content -->
    {#if addTab === "local"}
      <div class="space-y-4 pt-4">
        {#if addFileName}
          <div
            class="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm"
          >
            <Music2 class="size-4 text-primary/60" />
            <span class="flex-1 truncate text-foreground">{addFileName}</span>
            <Button variant="ghost" size="xs" onclick={handleFilePick}
              >Change</Button
            >
          </div>
        {:else}
          <button
            onclick={handleFilePick}
            class="w-full rounded-lg border border-dashed border-border p-6 text-center hover:border-primary/30 transition-colors"
          >
            <Music2 class="size-6 mx-auto text-muted-foreground/60 mb-2" />
            <div class="text-sm text-muted-foreground">
              Choose an audio file
            </div>
            <div class="text-xs text-muted-foreground/60 mt-1">
              mp3, wav, ogg, flac
            </div>
          </button>
        {/if}
      </div>
    {:else}
      <div class="space-y-4 pt-4">
        {#if !spotifyAuthChecked}
          <div class="flex items-center justify-center py-6">
            <LoaderCircle class="size-4 animate-spin text-muted-foreground" />
          </div>
        {:else if !spotifyAuth?.is_connected}
          <div
            class="flex flex-col items-center gap-3 rounded-xl bg-card/50 border border-border p-6 text-center"
          >
            <span class="text-sm text-foreground font-medium">
              Connect Spotify to add tracks
            </span>
            <span class="text-xs text-muted-foreground max-w-[280px]">
              Link your Spotify Premium account to add tracks and playlists to
              your scenes.
            </span>
            <Button
              size="sm"
              onclick={handleInlineSpotifyConnect}
              disabled={isSpotifyConnecting}
            >
              {#if isSpotifyConnecting}
                <LoaderCircle class="size-3.5 animate-spin" />
                Connecting...
              {:else}
                Connect Spotify
              {/if}
            </Button>
            <span class="text-[10px] text-foreground-muted">
              Open Settings from the icon rail to manage integrations.
            </span>
          </div>
        {:else}
          <div>
            <label
              for="add-spotify-uri"
              class="text-xs text-muted-foreground mb-1.5 block"
            >
              Spotify URI
            </label>
            <Input
              id="add-spotify-uri"
              bind:value={addSpotifyUri}
              placeholder="Paste Spotify link or URI..."
            />
          </div>
        {/if}
      </div>
    {/if}

    <!-- Shared fields -->
    <div class="space-y-3 pt-3">
      <div>
        <label for="add-track-label" class="text-xs text-muted-foreground mb-1.5 block">Label</label>
        <Input id="add-track-label" bind:value={addLabel} placeholder="Track name" />
      </div>
      <div class="flex items-center gap-4">
        <label class="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" bind:checked={addLoop} class="accent-primary" />
          Loop
        </label>
        <label class="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            bind:checked={addShuffle}
            class="accent-primary"
          />
          Shuffle
        </label>
      </div>
    </div>

    <AlertDialog.Footer>
      <AlertDialog.Cancel onclick={resetAddDialog}>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={handleAddTrack}
        disabled={!canAdd || isAdding}
      >
        {#if isAdding}Adding...{:else}Add{/if}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<!-- Delete slot confirmation -->
<AlertDialog.Root
  open={deleteSlotTarget !== null}
  onOpenChange={(o) => {
    if (!o) deleteSlotTarget = null;
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete track</AlertDialog.Title>
      <AlertDialog.Description>
        Are you sure you want to delete
        <span class="font-medium text-foreground"
          >{deleteSlotTarget?.label}</span
        >? This action cannot be undone.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action variant="destructive" onclick={confirmDeleteSlot}>
        Delete
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
