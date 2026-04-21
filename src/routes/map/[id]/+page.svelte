<script lang="ts">
  import { page } from "$app/state";
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import { maps } from "$lib/stores/maps.svelte";
  import {
    FileXCorner,
    LoaderCircle,
    ImagePlus,
    MapPinPlus,
    ZoomIn,
    ZoomOut,
    X,
  } from "@lucide/svelte";
  import MapCanvas from "$lib/components/map/MapCanvas.svelte";
  import type { Note, Pin, PinCategory } from "$lib/types/vault";
  import PinDetailPanel from "$lib/components/map/PinDetailPanel.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { fly, slide } from "svelte/transition";

  let leafletMap = $state<import("leaflet").Map | null>(null);

  // ── Map data ───────────────────────────────────────────────────────────────
  let mapData = $derived(
    maps.maps.find((m) => m.id === Number(page.params.id)) ?? null,
  );

  // Folder to place image in when assigned (set via ?folder= query param)
  const destFolder = $derived(page.url.searchParams.get("folder") ?? null);

  // ── Per-map state ──────────────────────────────────────────────────────────
  let pins = $state<Pin[]>([]);
  let categories = $state<PinCategory[]>([]);
  let imageDataUrl = $state<string | null>(null);
  let isLoadingData = $state(false);
  let selectedPin = $state<Pin | null>(null);
  let placingMode = $state(false);

  $inspect(selectedPin);

  $effect(() => {
    const m = mapData;
    if (!m) return;

    isLoadingData = true;
    selectedPin = null;
    imageDataUrl = null;
    placingMode = false;

    Promise.all([
      invoke<Pin[]>("get_pins", { mapId: m.id }),
      invoke<PinCategory[]>("get_pin_categories"),
    ])
      .then(([p, c]) => {
        pins = p;
        categories = c;
      })
      .catch(console.error);

    if (m.image_path) {
      invoke<string>("get_map_image_data_url", { mapId: m.id })
        .then((url) => {
          imageDataUrl = url;
        })
        .catch(console.error)
        .finally(() => {
          isLoadingData = false;
        });
    } else {
      isLoadingData = false;
    }
  });

  // ── Title rename ───────────────────────────────────────────────────────────
  let renamingTitle = $state(false);
  let draftTitle = $state("");

  function startTitleRename() {
    if (!mapData) return;
    draftTitle = mapData.title;
    renamingTitle = true;
  }

  async function commitTitleRename() {
    if (!mapData || !draftTitle.trim()) {
      renamingTitle = false;
      return;
    }
    const trimmed = draftTitle.trim();
    if (trimmed === mapData.title) {
      renamingTitle = false;
      return;
    }
    try {
      await invoke("update_map", { map: { ...mapData, title: trimmed } });
      await maps.load();
    } catch {
      /* ignore */
    } finally {
      renamingTitle = false;
    }
  }

  // ── Image assignment ───────────────────────────────────────────────────────
  let isAssigningImage = $state(false);

  async function handleAssignImage() {
    if (!mapData) return;
    const picked = await open({
      title: "Choose Map Image",
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (!picked || typeof picked !== "string") return;

    isAssigningImage = true;
    try {
      await invoke("assign_map_image", {
        mapId: mapData.id,
        sourceImagePath: picked,
        destFolder,
      });
      await maps.load();
      imageDataUrl = await invoke<string>("get_map_image_data_url", {
        mapId: mapData.id,
      });
    } catch (e) {
      console.error("assign image failed:", e);
    } finally {
      isAssigningImage = false;
    }
  }

  // ── Pin operations ─────────────────────────────────────────────────────────
  async function handlePinPlace(x: number, y: number) {
    if (!mapData) return;
    try {
      const pin = await invoke<Pin>("create_pin", {
        mapId: mapData.id,
        x,
        y,
        title: "New Pin",
        description: null,
        categoryId: null,
        noteId: null,
      });
      pins = [pin, ...pins];
      selectedPin = pin;
      placingMode = false;
    } catch (e) {
      console.error("create pin failed:", e);
    }
  }

  async function handlePinMove(pin: Pin, x: number, y: number) {
    try {
      const result = await invoke<Pin>("update_pin", { pin: { ...pin, x, y } });
      pins = pins.map((p) => (p.id === result.id ? result : p));
      if (selectedPin?.id === result.id) selectedPin = result;
    } catch (e) {
      console.error("update pin failed:", e);
    }
  }
</script>

{#if maps.isLoading || isLoadingData}
  <div class="flex h-full items-center justify-center">
    <LoaderCircle class="w-5 h-5 animate-spin text-accent" />
  </div>
{:else if !mapData}
  <div class="flex h-full items-center justify-center">
    <div class="flex flex-col items-center gap-4 text-center max-w-xs">
      <FileXCorner class="w-7 h-7 text-muted-foreground" />
      <p class="font-display text-lg font-semibold">Map not found</p>
      <a href="/" class="text-sm text-accent hover:underline">← Back to vault</a
      >
    </div>
  </div>
{:else if !mapData.image_path}
  <!-- Empty state: no image assigned yet -->
  <div class="flex h-full items-center justify-center">
    <div class="flex flex-col items-center gap-6 text-center max-w-xs">
      <div
        class="flex size-14 items-center justify-center rounded-2xl bg-accent/10 border border-accent/20"
      >
        <ImagePlus class="size-7 text-accent" strokeWidth={1.5} />
      </div>
      <div class="space-y-1.5">
        <p class="font-display text-xl font-semibold">{mapData.title}</p>
        <p class="text-sm text-muted-foreground leading-relaxed">
          Add a background image to start placing pins.
        </p>
      </div>
      <button
        onclick={handleAssignImage}
        disabled={isAssigningImage}
        class="px-5 py-2.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold
               hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {isAssigningImage ? "Copying image…" : "Choose background image"}
      </button>
    </div>
  </div>
{:else}
  <!-- Ready state: full map canvas -->
  <!-- isolate creates a stacking context, containing Leaflet's z-indices (up to 1000)
       within this element so they don't compete with portalled dialogs at the root -->
  <div
    class="relative w-full h-full overflow-hidden isolate {placingMode
      ? 'cursor-crosshair'
      : ''}"
  >
    <!-- Map canvas -->
    <MapCanvas
      map={mapData}
      imageDataUrl={imageDataUrl!}
      {pins}
      {categories}
      selectedPinId={selectedPin?.id ?? null}
      {placingMode}
      onpinplace={handlePinPlace}
      onpinclick={(pin) => {
        selectedPin = pin;
        placingMode = false;
      }}
      onpinmove={handlePinMove}
      onmapclick={() => {
        selectedPin = null;
      }}
      onready={(m) => {
        leafletMap = m;
      }}
    />

    <!-- Title badge -->
    <div class="absolute top-3 left-3 z-1000">
      {#if renamingTitle}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          autofocus
          bind:value={draftTitle}
          onblur={commitTitleRename}
          onkeydown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTitleRename();
            }
            if (e.key === "Escape") renamingTitle = false;
          }}
          class="bg-background/90 backdrop-blur-sm border border-border rounded-lg px-3 py-1.5
                 font-display text-sm font-semibold outline-none focus:border-accent shadow-sm"
        />
      {:else}
        <button
          onclick={startTitleRename}
          title="Click to rename"
          class="flex items-center gap-2 bg-background/80 backdrop-blur-sm border border-border/60
                 rounded-lg px-3 py-1.5 hover:border-accent/60 transition-colors cursor-pointer shadow-sm"
        >
          <span
            class="font-display text-sm font-semibold tracking-wide whitespace-nowrap"
          >
            {mapData.title}
          </span>
        </button>
      {/if}
    </div>

    <!-- Left vertical toolbar -->
    <div
      class="absolute left-3 top-1/2 -translate-y-1/2 z-1000 flex flex-col items-center
                bg-background/90 backdrop-blur-sm border border-border/60 rounded-xl shadow-md p-1 gap-0.5"
    >
      <!-- Place pin -->
      <button
        onclick={() => {
          placingMode = !placingMode;
          if (placingMode) selectedPin = null;
        }}
        title={placingMode ? "Cancel placing" : "Place pin"}
        class="size-9 flex items-center justify-center rounded-lg transition-colors cursor-pointer
               {placingMode
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/10'}"
      >
        {#if placingMode}
          <X class="size-4" />
        {:else}
          <MapPinPlus class="size-4" />
        {/if}
      </button>

      <!-- Divider -->
      <div class="w-5 h-px bg-border/60 my-0.5"></div>

      <!-- Zoom in -->
      <button
        onclick={() => leafletMap?.zoomIn()}
        title="Zoom in"
        class="size-9 flex items-center justify-center rounded-lg
               text-muted-foreground hover:text-foreground hover:bg-accent/10
               transition-colors cursor-pointer"
      >
        <ZoomIn class="size-4" />
      </button>

      <!-- Zoom out -->
      <button
        onclick={() => leafletMap?.zoomOut()}
        title="Zoom out"
        class="size-9 flex items-center justify-center rounded-lg
               text-muted-foreground hover:text-foreground hover:bg-accent/10
               transition-colors cursor-pointer"
      >
        <ZoomOut class="size-4" />
      </button>
    </div>

    <!-- Placing mode hint -->
    {#if placingMode}
      <div
        class="absolute bottom-5 left-0 right-0 flex justify-center z-1000 pointer-events-none"
      >
        <div
          class="bg-background/80 backdrop-blur-sm border border-border/60 rounded-lg px-4 py-2 shadow-md"
        >
          <p class="text-xs text-muted-foreground">
            Click anywhere on the map to place a pin
          </p>
        </div>
      </div>
    {/if}

    <!-- Selected pin badge -->
    {#if selectedPin && !placingMode}
      {@const linkedNote =
        notes.notes.find((n: Note) => n.id === selectedPin?.note_id) ?? null}
      <div
        transition:fly={{ x: 200, duration: 100 }}
        class="absolute top-4 right-4 z-1000 w-80 bg-background rounded-2xl shadow-2xl border border-border
               flex flex-col overflow-hidden"
      >
        <PinDetailPanel
          pin={selectedPin}
          {linkedNote}
          onUpdate={async (updated: Pin) => {
            try {
              const saved: Pin = await invoke("update_pin", { pin: updated });
              pins = pins.map((p) => (p.id === saved.id ? saved : p));
              selectedPin = saved;
            } finally {
            }
          }}
        />
      </div>
    {/if}
  </div>
{/if}
