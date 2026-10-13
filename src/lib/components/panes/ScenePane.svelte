<script lang="ts">
  import { tick, untrack } from "svelte";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { api } from "$lib/api";
  import { scenes } from "$lib/stores/scenes.svelte";
  import { audioEngine, isPlaylistSlot } from "$lib/stores/audio-engine.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { Button } from "$lib/components/ui/button";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Rename from "$lib/components/ui/rename";
  import * as Popover from "$lib/components/ui/popover";
  import * as Tabs from "$lib/components/ui/tabs";
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
    ImagePlus,
    X,
    ChevronLeft,
    VolumeOff,
    Ellipsis,
    CircleX,
  } from "@lucide/svelte";
  import type { SceneSlot, SpotifyAuthStatus } from "$lib/types/ledger";
  import { getSpotifyStatus, connectSpotify } from "$lib/utils/spotify-auth";
  import { changeThumbnail, removeThumbnail } from "$lib/utils/thumbnail-actions";
  import {
    ICON_OPTIONS,
    DEFAULT_SCENE_ICON,
    sceneIcon,
    sceneThumbColors,
  } from "./thumbnail-presets";
  import ColorPicker from "$lib/components/ColorPicker.svelte";
  import { sceneColorHex } from "$lib/color";
  import { open } from "@tauri-apps/plugin-dialog";
  import VolumeSlider from "$lib/components/VolumeSlider.svelte";
  import NowPlayingBars from "$lib/components/NowPlayingBars.svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { toastUndo } from "$lib/toast";

  interface Props {
    sceneId: number;
    pane: "left" | "right";
  }
  let { sceneId, pane }: Props = $props();

  // ---- Scene lookup ----
  let scene = $derived(scenes.scenes.find((s) => s.id === sceneId) ?? null);

  // ---- Hero header ----

  // The scene's own colours, as its dashboard card and the in-note player draw them —
  // or, while the GM drags the colour picker, the colour under their hand.
  let draftColor = $state<string | null>(null);
  let heroColors = $derived(
    scene
      ? sceneThumbColors({ thumbnail_color: draftColor ?? scene.thumbnail_color })
      : { bg: "var(--background-elevated)", fg: "var(--foreground-muted)" },
  );
  let heroColor = $derived(heroColors.bg);
  let heroIconColor = $derived(heroColors.fg);
  let thumbnailUrl = $state<string | null>(null);

  $effect(() => {
    const path = scene?.thumbnail_path;
    if (path) {
      api
        .getAudioAbsolutePath(path)
        .then((abs) => {
          thumbnailUrl = convertFileSrc(abs);
        })
        .catch(() => {
          thumbnailUrl = null;
        });
    } else {
      thumbnailUrl = null;
    }
  });

  // ---- Appearance ----
  // Picture, colour and icon live in one popover anchored to an always-visible button.
  // They used to be three buttons that appeared only on hover — so a keyboard user's
  // first three Tab stops were invisible — each opening a modal that did not mark the
  // current choice. The popover stays open as choices land, so a GM can try a colour
  // against the icon without reopening anything.
  let appearanceOpen = $state(false);
  let appearancePanel = $state<HTMLElement | null>(null);

  async function applyColor(color: string | null) {
    if (!scene) return;
    try {
      await scenes.applyThumbnailColor(scene.id, color);
    } catch (e) {
      console.error("update thumbnail color failed:", e);
    } finally {
      // Hand the header back to the stored colour — unless the GM has already moved on
      // to another one while this save was in flight.
      if (draftColor === color || color === null) draftColor = null;
    }
  }

  async function applyIcon(icon: string | null) {
    if (!scene) return;
    try {
      await scenes.applyThumbnailIcon(scene.id, icon);
    } catch (e) {
      console.error("update thumbnail icon failed:", e);
    }
  }

  // ---- Tab title sync ----
  $effect(() => {
    if (scene) {
      const name = scene.name;
      untrack(() => tabs.updateTabTitle("scene", sceneId, name));
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
      await scenes.updateScene(scene.id, trimmed);
    } catch (e) {
      console.error("name save failed:", e);
      draftName = scene.name;
    } finally {
      isSavingName = false;
    }
  }

  // A scene just made from "New Scene" opens with its placeholder name selected, so the
  // GM's first keystroke names it rather than hunting for the field.
  let nameInput = $state<HTMLInputElement | null>(null);
  let offeredRename = false;
  const PLACEHOLDER_NAMES = ["New Scene", "Untitled Scene"];

  $effect(() => {
    if (offeredRename || !scene || slotsLoading || !nameInput) return;
    offeredRename = true;
    if (slots.length === 0 && PLACEHOLDER_NAMES.includes(scene.name)) {
      nameInput.focus();
      nameInput.select();
    }
  });

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
  // Every one of these asks about THIS scene. The paused check used to be the engine's
  // global one, so with Boss Battle paused, Town Market's editor offered "Resume" — and
  // resumed the boss music. The in-note player has always scoped it; now both do.
  let isThisSceneActive = $derived(scene !== null && audioEngine.isSceneActive(scene.id));
  let isThisSceneLoading = $derived(scene !== null && audioEngine.loadingSceneId === scene.id);
  let isThisScenePaused = $derived(isThisSceneActive && audioEngine.isScenePaused);
  let isThisScenePlaying = $derived(
    scene !== null && audioEngine.isScenePlaying(scene.id) && !isThisScenePaused,
  );
  let hasTracks = $derived(!slotsLoading && slots.length > 0);

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

  async function handlePause() {
    await audioEngine.pauseScene();
  }

  async function handleResume() {
    await audioEngine.resumeScene();
  }

  function handleStop() {
    audioEngine.stopAll();
  }

  // ---- Slot volume ----
  function handleSlotVolumeInput(slot: SceneSlot, value: number) {
    const idx = slots.findIndex((s) => s.id === slot.id);
    if (idx !== -1) slots[idx] = { ...slots[idx], volume: value };
    if (isThisSceneActive) audioEngine.setSlotVolume(slot.id, value);
  }

  async function handleSlotVolumeChange(slot: SceneSlot, value: number) {
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
      console.error("Failed to save volume:", err);
    }
  }

  // ---- Slot play/pause ----
  // slot ids with a play/pause in flight, so a double click is one toggle
  let busySlots = new SvelteSet<number>();

  async function playSlot(slot: SceneSlot) {
    if (!scene || busySlots.has(slot.id)) return;
    busySlots.add(slot.id);
    try {
      if (!isThisSceneActive) {
        await audioEngine.previewSlot(scene.id, slot.id);
      } else if (audioEngine.isSlotPlaying(slot.id)) {
        await audioEngine.pauseSlot(slot.id);
      } else {
        await audioEngine.resumeSlot(slot.id);
      }
    } finally {
      busySlots.delete(slot.id);
    }
  }

  // ---- Toggle loop / shuffle ----
  async function toggleLoop(slot: SceneSlot) {
    if (!scene) return;
    try {
      slots = await scenes.updateSlot(scene.id, slot.id, {
        label: slot.label,
        volume: slot.volume,
        loop: !slot.loop,
        slotOrder: slot.slot_order,
        shuffle: !!slot.shuffle,
      });
    } catch (e) {
      console.error("Failed to toggle loop:", e);
    }
  }

  async function toggleShuffle(slot: SceneSlot) {
    if (!scene) return;
    try {
      slots = await scenes.updateSlot(scene.id, slot.id, {
        label: slot.label,
        volume: slot.volume,
        loop: slot.loop,
        slotOrder: slot.slot_order,
        shuffle: !slot.shuffle,
      });
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

  // Leaving the field unmounts it, and focus fell to the page. Put it back on the row's
  // menu button — unless the GM left by clicking something else, which keeps its focus.
  async function endSlotRename(slotId: number) {
    renamingSlotId = null;
    await tick();
    if (document.activeElement === document.body || document.activeElement === null) {
      document.querySelector<HTMLElement>(`[data-slot-menu="${slotId}"]`)?.focus();
    }
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
      slots = await scenes.updateSlot(scene.id, slotId, {
        label: trimmed,
        volume: slot.volume,
        loop: slot.loop,
        slotOrder: slot.slot_order,
        shuffle: !!slot.shuffle,
      });
    } catch (e) {
      console.error("Failed to rename slot:", e);
    } finally {
      endSlotRename(slotId);
    }
  }

  // ---- Remove slot ----
  // An undo toast rather than a confirmation dialog (DESIGN.md: modals are
  // disproportionate for this). The row leaves at once and falls silent; nothing is
  // removed until the undo window closes, so Undo is a cancelled timer. Removing a track
  // only takes it out of the scene — its audio file stays in the ledger — which the old
  // dialog's "This action cannot be undone" made sound otherwise.
  let pendingRemoval = new SvelteSet<number>();
  let visibleSlots = $derived(slots.filter((s) => !pendingRemoval.has(s.id)));

  function deleteSlot(slot: SceneSlot) {
    if (!scene) return;
    const sceneId = scene.id;
    const wasPlaying = audioEngine.isSceneActive(sceneId) && audioEngine.isSlotPlaying(slot.id);
    pendingRemoval.add(slot.id);
    if (wasPlaying) void audioEngine.pauseSlot(slot.id);
    toastUndo(
      `Removed "${slot.label}" from the scene`,
      async () => {
        try {
          slots = await scenes.deleteSlot(sceneId, slot.id);
        } catch (e) {
          console.error("Failed to delete slot:", e);
        } finally {
          pendingRemoval.delete(slot.id);
        }
      },
      () => {
        pendingRemoval.delete(slot.id);
        if (wasPlaying && audioEngine.isSceneActive(sceneId)) void audioEngine.resumeSlot(slot.id);
      },
    );
  }

  // ---- Add track dialog ----
  let addDialogOpen = $state(false);
  // "local" | "spotify" — a string because the tabs primitive binds one.
  let addTab = $state("local");
  let addLabel = $state("");
  let addLoop = $state(true);
  let addShuffle = $state(false);
  let addSourcePath = $state("");
  let addFileName = $state("");
  // A track can be chosen via the OS picker (path → copyAudioFile) or dropped onto
  // the box (bytes → copyAudioBytes). The dropped File is held until "Add" so both
  // paths defer the copy to the same moment; whichever was set last wins.
  let addDroppedFile = $state<File | null>(null);
  let isAudioDropTarget = $state(false);
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

  function parseSpotifyInput(input: string): { uri: string; type: string; id: string } | null {
    // Accept Spotify URLs: https://open.spotify.com/track/ID?si=...
    const urlMatch = input.match(/open\.spotify\.com\/(track|playlist|album)\/([A-Za-z0-9]+)/);
    if (urlMatch) {
      return {
        uri: `spotify:${urlMatch[1]}:${urlMatch[2]}`,
        type: urlMatch[1],
        id: urlMatch[2],
      };
    }
    // Accept raw URIs: spotify:track:ID, spotify:playlist:ID, spotify:album:ID
    // Also handles playlist_v2 by normalizing to playlist
    const uriMatch = input.match(/^spotify:(track|playlist(?:_v2)?|album):([A-Za-z0-9]+)$/);
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

  let spotifyInputInvalid = $derived(
    addTab === "spotify" && addSpotifyUri.trim() !== "" && !parsedSpotifyInput,
  );

  // A Spotify track may be added unnamed: it takes its name from Spotify. Requiring a
  // name here was what kept that lookup in handleAddTrack from ever running.
  let canAdd = $derived(
    addTab === "local"
      ? (!!addSourcePath || !!addDroppedFile) && addLabel.trim() !== ""
      : !!parsedSpotifyInput,
  );

  // Why Add is disabled, said beside it rather than left to guess.
  let addBlockedReason = $derived.by(() => {
    if (canAdd) return null;
    if (addTab === "local") {
      return addSourcePath || addDroppedFile ? "Give the track a name." : "Choose a file to add.";
    }
    if (!spotifyAuth?.is_connected || spotifyInputInvalid) return null;
    return "Paste a Spotify link to add.";
  });

  function resetAddDialog() {
    addDialogOpen = false;
    addTab = "local";
    addLabel = "";
    addLoop = true;
    addShuffle = false;
    addSourcePath = "";
    addFileName = "";
    addDroppedFile = null;
    isAudioDropTarget = false;
    addSpotifyUri = "";
    spotifyAuthChecked = false;
  }

  const AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "flac", "m4a", "aac"];

  function isAudioFile(file: File): boolean {
    if (file.type.startsWith("audio/")) return true;
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    return AUDIO_EXTENSIONS.includes(ext);
  }

  // Drop sets the dropped File and clears any picked path (last choice wins).
  function selectDroppedFile(file: File) {
    addDroppedFile = file;
    addSourcePath = "";
    addFileName = file.name;
    if (!addLabel) addLabel = file.name.replace(/\.[^/.]+$/, "");
  }

  function handleAudioDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    isAudioDropTarget = true;
  }

  function handleAudioDrop(e: DragEvent) {
    isAudioDropTarget = false;
    const audio = Array.from(e.dataTransfer?.files ?? []).find(isAudioFile);
    if (!audio) return;
    e.preventDefault();
    selectDroppedFile(audio);
  }

  async function handleFilePick() {
    const picked = await open({
      title: "Choose Audio File",
      filters: [
        {
          name: "Audio",
          extensions: AUDIO_EXTENSIONS,
        },
      ],
    });
    if (picked && typeof picked === "string") {
      addSourcePath = picked;
      addDroppedFile = null;
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
        if (addDroppedFile) {
          const bytes = Array.from(new Uint8Array(await addDroppedFile.arrayBuffer()));
          sourceId = await api.copyAudioBytes(bytes, addDroppedFile.name);
        } else {
          sourceId = await api.copyAudioFile(addSourcePath);
        }
        source = "local";
      } else {
        const parsed = parseSpotifyInput(addSpotifyUri.trim());
        if (!parsed) return;
        sourceId = parsed.uri;
        source = "spotify";
        // Auto-fetch label from Spotify if user didn't provide one
        if (!addLabel.trim()) {
          try {
            const token = await api.spotifyGetAccessToken();
            const apiType =
              parsed.type === "track"
                ? "tracks"
                : parsed.type === "playlist"
                  ? "playlists"
                  : "albums";
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
      slots = await scenes.addSlot(scene.id, {
        source,
        sourceId,
        label: addLabel.trim() || "Untitled",
        volume: 0.8,
        loop: addLoop,
        slotOrder: slots.length,
        shuffle: source === "spotify" && parseSpotifyInput(sourceId)?.type === "playlist" && addShuffle,
      });
      resetAddDialog();
    } catch (e) {
      console.error("Failed to add track:", e);
    } finally {
      isAdding = false;
    }
  }
</script>

<div data-pane-scroll class="@container flex flex-1 flex-col overflow-y-auto">
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
    <!-- HERO HEADER
         A shorter band than it was (208px → 128px): the scene's picture and name still
         open the editor, but Play and the tracks are no longer a quarter of the way down
         the pane. Its content sits on the same column as the transport and the tracks, so
         the name, "All Scenes" and the first track share a left edge. -->
    {@const HeroIcon = sceneIcon(scene)}
    <div
      data-hero-header
      class="relative shrink-0 overflow-hidden"
      style="background-color: {heroColor}; {thumbnailUrl
        ? `background-image: url(${thumbnailUrl}); background-size: cover; background-position: center;`
        : ''}"
    >
      <!-- Legibility over the GM's picture. Only over a picture: on a plain colour it
           only muddied the colour they chose. -->
      {#if thumbnailUrl}
        <div
          class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent"
        ></div>
      {/if}

      <div class="relative mx-auto flex min-h-32 w-full max-w-3xl items-end gap-3 px-8 pt-8 pb-5">
        <!-- Icon — always rendered per ADR-0002 -->
        <div
          data-hero-icon
          data-icon-name={scene.thumbnail_icon ?? "Music2"}
          class="pointer-events-none mb-1 shrink-0"
        >
          <HeroIcon
            class="size-8"
            strokeWidth={1.5}
            style="color: {thumbnailUrl ? 'white' : heroIconColor}; {thumbnailUrl
              ? 'filter: drop-shadow(0 2px 8px rgba(0,0,0,0.6))'
              : ''}"
          />
        </div>

        <!-- Scene name (editable). H1 on the type scale; a long name ends in an ellipsis
             at rest and scrolls while it is being edited. -->
        <input
          bind:this={nameInput}
          data-scene-name
          aria-label="Scene name"
          bind:value={draftName}
          class="font-heading min-w-0 flex-1 truncate rounded-sm border-none bg-transparent p-0 text-[1.75rem] leading-tight tracking-tight
                 placeholder:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          style="color: {thumbnailUrl ? 'white' : 'var(--foreground)'}; {thumbnailUrl
            ? 'text-shadow: 0 2px 8px rgba(0,0,0,0.5)'
            : ''}"
          placeholder="Untitled Scene"
          onblur={commitName}
          onkeydown={handleNameKeydown}
        />

        <!-- Appearance. A control over the GM's imagery, so it takes the floating
             treatment (DESIGN.md §4) and is always there to find. -->
        <Popover.Root bind:open={appearanceOpen}>
          <Popover.Trigger
            data-appearance-btn
            class="mb-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-popover px-2.5 text-[0.8125rem] font-medium text-foreground
                   shadow-float ring-1 ring-foreground/10 transition-colors hover:bg-muted
                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Palette class="size-3.5 text-muted-foreground" />
            <span class="@max-md:sr-only">Appearance</span>
          </Popover.Trigger>
          <!-- Focus lands on the panel, not its first button: opened by mouse, a ring on
               "Choose picture" read as that being the current choice. Tab walks in from
               here. -->
          <Popover.Content
            align="end"
            class="flex w-72 flex-col gap-4"
            bind:ref={appearancePanel}
            tabindex={-1}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              appearancePanel?.focus();
            }}
          >
            <!-- Picture -->
            <section class="flex flex-col gap-1.5">
              <h3 class="text-xs font-semibold text-muted-foreground">Picture</h3>
              <div class="flex gap-2">
                <Button
                  data-edit-thumbnail-btn
                  variant="outline"
                  size="sm"
                  onclick={() => changeThumbnail(scene.id)}
                >
                  <ImagePlus class="size-3.5" />
                  {scene.thumbnail_path ? "Change picture" : "Choose picture"}
                </Button>
                {#if scene.thumbnail_path}
                  <Button
                    data-remove-thumbnail-btn
                    variant="ghost"
                    size="sm"
                    onclick={() => removeThumbnail(scene.id)}
                  >
                    <X class="size-3.5" />
                    Remove
                  </Button>
                {/if}
              </div>
            </section>

            <!-- Colour: any colour, picked freely, or none. The header follows the drag
                 and the scene saves when the GM lets go. -->
            <section class="flex flex-col gap-1.5">
              <h3 class="text-xs font-semibold text-muted-foreground">Color</h3>
              <ColorPicker
                value={sceneColorHex(scene.thumbnail_color)}
                oninput={(hex) => (draftColor = hex)}
                onchange={applyColor}
              />
            </section>

            <!-- Icon -->
            <section class="flex flex-col gap-1.5">
              <h3 class="text-xs font-semibold text-muted-foreground">Icon</h3>
              <div data-icon-picker class="grid grid-cols-6 gap-1">
                <button
                  type="button"
                  data-icon-btn="default"
                  aria-label="Default (music note)"
                  aria-pressed={!scene.thumbnail_icon}
                  title="Default"
                  class="flex size-9 items-center justify-center rounded-md transition-colors
                         {!scene.thumbnail_icon
                    ? 'bg-primary/12 text-foreground ring-1 ring-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
                  onclick={() => applyIcon(null)}
                >
                  <DEFAULT_SCENE_ICON class="size-4" />
                </button>
                {#each ICON_OPTIONS as { name, label, icon: Icon } (name)}
                  {@const chosen = scene.thumbnail_icon === name}
                  <button
                    type="button"
                    data-icon-btn={name}
                    aria-label={label}
                    aria-pressed={chosen}
                    title={label}
                    class="flex size-9 items-center justify-center rounded-md transition-colors
                           {chosen
                      ? 'bg-primary/12 text-foreground ring-1 ring-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
                    onclick={() => applyIcon(name)}
                  >
                    <Icon class="size-4" />
                  </button>
                {/each}
              </div>
            </section>
          </Popover.Content>
        </Popover.Root>
      </div>
    </div>

    <!-- TRANSPORT
         Pinned under the header while the tracks scroll: at the table, Play and Stop must
         not scroll away with a long track list. -->
    <div class="sticky top-0 z-10 shrink-0 border-b border-border bg-background">
      <div class="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 px-8 py-3">
        <Button
          variant="ghost"
          size="sm"
          class="-ml-2.5 text-muted-foreground"
          onclick={() => tabs.openTab({ type: "scenes", id: 0, title: "All Scenes" })}
        >
          <ChevronLeft class="size-3.5" />
          All Scenes
        </Button>
        <div class="h-4 w-px bg-border"></div>

        {#if isThisSceneLoading}
          <Button variant="secondary" size="sm" disabled>
            <LoaderCircle class="size-3.5 animate-spin" />
            Loading…
          </Button>
        {:else if isThisScenePaused}
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
          <Button variant="secondary" size="sm" onclick={handleStop}>
            <Square class="size-3.5" />
            Stop
          </Button>
          <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <NowPlayingBars />
            Playing
          </span>
        {:else}
          <!-- With no tracks there is nothing to play, and a crimson button that did
               nothing was the loudest thing on an empty scene. -->
          <Button
            variant="default"
            size="sm"
            disabled={!hasTracks}
            title={hasTracks ? undefined : "Add a track first"}
            onclick={handlePlayStop}
          >
            <Play class="size-3.5" />
            Play Scene
          </Button>
        {/if}

        <!-- Master volume — every scene, not this one, so it says so. -->
        <div class="ml-auto flex items-center gap-1.5">
          <span class="text-xs font-semibold text-muted-foreground @max-md:sr-only">Master</span>
          <button
            type="button"
            class="flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted
                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onclick={() => audioEngine.toggleMasterMute()}
            aria-label={audioEngine.isMasterMuted ? "Unmute all" : "Mute all"}
            aria-pressed={audioEngine.isMasterMuted}
            title={audioEngine.isMasterMuted ? "Unmute all" : "Mute all"}
          >
            {#if audioEngine.isMasterMuted}
              <VolumeOff class="size-4 text-muted-foreground" />
            {:else}
              <Volume2 class="size-4 text-muted-foreground" />
            {/if}
          </button>
          <VolumeSlider
            class="w-28 @max-md:w-20"
            value={audioEngine.masterVolume}
            label="Master volume"
            active={audioEngine.isPlaying}
            oninput={(v) => audioEngine.setMasterVolume(v)}
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
        <!-- Empty state: a Metamorphous headline, one orienting line, one action
             (DESIGN.md §6). Add Track is the primary here — it is the only next step, and
             Play is disabled until there is something to play. -->
        <div class="flex flex-col items-center justify-center py-16 text-center">
          <div class="flex size-12 items-center justify-center rounded-lg bg-muted">
            <DEFAULT_SCENE_ICON class="size-6 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <h2 class="font-heading mt-5 text-[1.375rem] leading-tight font-normal text-foreground">
            No tracks yet
          </h2>
          <p class="mt-2 max-w-sm text-sm text-muted-foreground">
            Layer rain, a crowd and music. They all play together when you press Play.
          </p>
          <Button size="sm" class="mt-5" onclick={() => (addDialogOpen = true)}>
            <Plus class="size-3.5" />
            Add Track
          </Button>
        </div>
      {:else}
        <div class="space-y-2">
          {#each visibleSlots as slot (slot.id)}
            {@const slotPlaying = isThisSceneActive && audioEngine.isSlotPlaying(slot.id)}
            {@const playlist = isPlaylistSlot(slot)}
            <ContextMenu.Root>
              <ContextMenu.Trigger>
                <div
                  data-slot-row
                  class="flex items-center gap-2 rounded-lg bg-card/50 py-2 pr-2 pl-1.5 transition-colors hover:bg-card"
                >
                  <!-- Play this track. While the scene is stopped it previews the track on
                       its own; while the scene is active it brings the track in or out. It
                       used to be a faint glyph that did nothing until the whole scene
                       played. -->
                  <Button
                    variant="ghost"
                    size="icon"
                    class="size-8 shrink-0"
                    disabled={busySlots.has(slot.id) || isThisSceneLoading}
                    aria-label={slotPlaying
                      ? `Pause ${slot.label}`
                      : isThisSceneActive
                        ? `Play ${slot.label}`
                        : `Play ${slot.label} on its own`}
                    title={isThisSceneActive ? undefined : "Play this track on its own"}
                    onclick={() => playSlot(slot)}
                  >
                    {#if slotPlaying}
                      <Pause class="size-3.5 text-foreground" />
                    {:else}
                      <Play class="size-3.5 text-muted-foreground" />
                    {/if}
                  </Button>

                  <!-- Skip, for a playlist that is sounding: they act on the playing queue,
                       so they appear with it rather than as placeholders. -->
                  {#if playlist && slotPlaying}
                    <div data-slot-skip-controls class="flex shrink-0 items-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        class="size-7"
                        aria-label="Previous track in {slot.label}"
                        onclick={() => audioEngine.skipPrev()}
                      >
                        <SkipBack class="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="size-7"
                        aria-label="Next track in {slot.label}"
                        onclick={() => audioEngine.skipNext()}
                      >
                        <SkipForward class="size-3.5" />
                      </Button>
                    </div>
                  {/if}

                  <!-- Label: click (or F2 from the row's menu button) to rename. -->
                  <div class="flex min-w-0 flex-1 items-center gap-2">
                    <Rename.Root
                      this="span"
                      class="min-w-0 cursor-text truncate text-sm {slotPlaying
                        ? 'text-foreground'
                        : 'text-foreground/90'}"
                      inputClass="w-full bg-transparent px-0 py-0 text-sm"
                      bind:value={
                        () => (renamingSlotId === slot.id ? renameSlotValue : slot.label),
                        (val) => {
                          renameSlotValue = val;
                        }
                      }
                      bind:mode={
                        () => (renamingSlotId === slot.id ? "edit" : "view"),
                        (val) => {
                          // Both directions: the field enters editing itself when its text
                          // is clicked, and ignoring that snapped it straight back, which
                          // is why renaming only worked from the context menu.
                          if (val === "edit") startSlotRename(slot);
                          else if (renamingSlotId === slot.id) endSlotRename(slot.id);
                        }
                      }
                      onSave={(val) => handleSlotRename(slot.id, val)}
                      onCancel={() => endSlotRename(slot.id)}
                    />
                    <span
                      class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground @max-md:hidden"
                      >{slot.source === "spotify" ? "Spotify" : "Local"}</span
                    >
                  </div>

                  <VolumeSlider
                    class="w-24 @max-sm:w-14"
                    value={slot.volume}
                    label="{slot.label} volume"
                    active={slotPlaying}
                    oninput={(v) => handleSlotVolumeInput(slot, v)}
                    onchange={(v) => handleSlotVolumeChange(slot, v)}
                  />

                  <!-- Loop and shuffle. Their OFF state was `text-muted-foreground/30`,
                       which measures about 1.6:1 on Iron Dark — under the 3:1 that
                       WCAG 1.4.11 asks of a control's own graphics, and reading as
                       disabled when the control is live and one click from changing
                       what the table hears. Ember Muted is the resting state for an
                       enabled-but-inactive control everywhere else in the app.

                       `aria-pressed` because these are toggles and were announcing
                       state only through a label that changed underneath. Shuffle
                       only for a Spotify playlist, the one source it means anything
                       for — as the in-note player already does. -->
                  <Button
                    variant="ghost"
                    size="icon"
                    class="size-7 shrink-0"
                    aria-label="Loop {slot.label}"
                    aria-pressed={!!slot.loop}
                    title="Loop"
                    onclick={() => toggleLoop(slot)}
                  >
                    <Repeat
                      class="size-3.5 {slot.loop ? 'text-primary' : 'text-muted-foreground'}"
                    />
                  </Button>

                  {#if playlist}
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-7 shrink-0"
                      aria-label="Shuffle {slot.label}"
                      aria-pressed={!!slot.shuffle}
                      title="Shuffle"
                      onclick={() => toggleShuffle(slot)}
                    >
                      <Shuffle
                        class="size-3.5 {slot.shuffle ? 'text-primary' : 'text-muted-foreground'}"
                      />
                    </Button>
                  {/if}

                  <!-- The row's menu, findable without a right-click. -->
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger
                      data-slot-menu={slot.id}
                      class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors
                             hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      aria-label="More for {slot.label}"
                      onkeydown={(e: KeyboardEvent) => {
                        if (e.key === "F2") {
                          e.preventDefault();
                          startSlotRename(slot);
                        } else if (e.key === "Delete") {
                          e.preventDefault();
                          deleteSlot(slot);
                        }
                      }}
                    >
                      <Ellipsis class="size-4" />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end">
                      <DropdownMenu.Item onclick={() => startSlotRename(slot)}>
                        <Pencil class="size-4" />
                        Rename
                        <DropdownMenu.Shortcut>F2</DropdownMenu.Shortcut>
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item variant="destructive" onclick={() => deleteSlot(slot)}>
                        <Trash2 class="size-4" />
                        Remove from scene
                        <DropdownMenu.Shortcut>Del</DropdownMenu.Shortcut>
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </div>
              </ContextMenu.Trigger>
              <ContextMenu.Content>
                <ContextMenu.Item onclick={() => startSlotRename(slot)}>
                  <Pencil class="size-4" />
                  Rename
                </ContextMenu.Item>
                <ContextMenu.Separator />
                <ContextMenu.Item variant="destructive" onclick={() => deleteSlot(slot)}>
                  <Trash2 class="size-4" />
                  Remove from scene
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Root>
          {/each}
        </div>

        <!-- Add track button -->
        <button
          onclick={() => (addDialogOpen = true)}
          class="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-3 text-sm text-muted-foreground transition-colors
                 hover:border-foreground/30 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Plus class="size-4" />
          Add Track
        </button>
      {/if}
    </div>
  {/if}
</div>

<!-- Add Track dialog -->
<Dialog.Root
  open={addDialogOpen}
  onOpenChange={(o) => {
    if (!o) resetAddDialog();
  }}
>
  <Dialog.Content style="max-width: 28rem">
    <Dialog.Header>
      <Dialog.Title>Add Track</Dialog.Title>
    </Dialog.Header>

    <!-- Source. The shared tabs primitive rather than hand-built buttons: it is a real
         tablist to assistive tech, and its selected tab is not crimson text, which the
         Signal Rule keeps off small type (3.1:1 on the dialog). -->
    <Tabs.Root bind:value={addTab}>
      <Tabs.List class="w-full">
        <Tabs.Trigger value="local">Local file</Tabs.Trigger>
        <Tabs.Trigger value="spotify">Spotify</Tabs.Trigger>
      </Tabs.List>
    </Tabs.Root>

    <!-- One height for both tabs, so switching does not make the dialog jump. -->
    <div class="flex min-h-56 flex-col gap-4">
      {#if addTab === "local"}
        <div
          role="presentation"
          ondragover={handleAudioDragOver}
          ondragleave={() => (isAudioDropTarget = false)}
          ondrop={handleAudioDrop}
        >
          {#if addFileName}
            <div
              class="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm transition-colors {isAudioDropTarget
                ? 'ring-2 ring-foreground/30'
                : ''}"
            >
              <Music2 class="size-4 shrink-0 text-muted-foreground" />
              <span class="flex-1 truncate text-foreground">{addFileName}</span>
              <Button variant="ghost" size="xs" onclick={handleFilePick}>Change</Button>
            </div>
          {:else}
            <button
              type="button"
              onclick={handleFilePick}
              class="group w-full cursor-pointer rounded-lg border border-dashed p-6 text-center transition-colors
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring {isAudioDropTarget
                ? 'border-foreground/40 bg-muted/60'
                : 'border-border hover:border-foreground/30 hover:bg-muted/40'}"
            >
              <Music2
                class="mx-auto mb-2 size-6 text-muted-foreground transition-colors group-hover:text-foreground"
              />
              <div class="text-sm font-medium text-foreground">
                {isAudioDropTarget ? "Drop to add" : "Choose an audio file"}
              </div>
              <div class="mt-1 text-xs text-muted-foreground">
                or drop one here · MP3, WAV, OGG, FLAC, M4A or AAC
              </div>
            </button>
          {/if}
        </div>
      {:else if !spotifyAuthChecked}
        <div class="flex flex-1 items-center justify-center">
          <LoaderCircle class="size-4 animate-spin text-muted-foreground" />
        </div>
      {:else if !spotifyAuth?.is_connected}
        <div
          class="flex flex-col items-center gap-3 rounded-lg border border-border bg-card/50 p-6 text-center"
        >
          <span class="text-sm font-medium text-foreground">Connect Spotify to add tracks</span>
          <span class="max-w-[280px] text-xs text-muted-foreground">
            Link a Spotify Premium account to add tracks, albums and playlists to your scenes.
          </span>
          <Button size="sm" onclick={handleInlineSpotifyConnect} disabled={isSpotifyConnecting}>
            {#if isSpotifyConnecting}
              <LoaderCircle class="size-3.5 animate-spin" />
              Connecting…
            {:else}
              Connect Spotify
            {/if}
          </Button>
          <span class="text-xs text-muted-foreground">
            You can manage the connection in Settings → Integrations.
          </span>
        </div>
      {:else}
        <div class="flex flex-col gap-1.5">
          <label for="add-spotify-uri" class="text-xs font-semibold text-muted-foreground">
            Link or URI
          </label>
          <Input
            id="add-spotify-uri"
            bind:value={addSpotifyUri}
            placeholder="https://open.spotify.com/playlist/…"
            aria-invalid={spotifyInputInvalid}
            aria-describedby={spotifyInputInvalid ? "add-spotify-uri-error" : undefined}
          />
          {#if spotifyInputInvalid}
            <p id="add-spotify-uri-error" class="flex items-center gap-1.5 text-xs text-error">
              <CircleX class="size-3.5 shrink-0" />
              That isn't a Spotify track, album or playlist link.
            </p>
          {/if}
        </div>
      {/if}

      <!-- Name and options, once there is something to name. -->
      {#if addTab === "local" || spotifyAuth?.is_connected}
        <div class="flex flex-col gap-1.5">
          <label for="add-track-label" class="text-xs font-semibold text-muted-foreground">
            Name
          </label>
          <Input
            id="add-track-label"
            bind:value={addLabel}
            placeholder={addTab === "spotify" ? "Uses the name on Spotify if left blank" : "Track name"}
          />
        </div>
        <div class="flex items-center gap-5">
          <label class="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" bind:checked={addLoop} class="accent-primary" />
            Loop
          </label>
          {#if addTab === "spotify" && parsedSpotifyInput?.type === "playlist"}
            <label class="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" bind:checked={addShuffle} class="accent-primary" />
              Shuffle
            </label>
          {/if}
        </div>
      {/if}
    </div>

    <Dialog.Footer class="items-center">
      {#if addBlockedReason}
        <p class="mr-auto text-xs text-muted-foreground">{addBlockedReason}</p>
      {/if}
      <Button variant="ghost" onclick={resetAddDialog}>Cancel</Button>
      <Button onclick={handleAddTrack} disabled={!canAdd || isAdding}>
        {#if isAdding}Adding…{:else}Add{/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
