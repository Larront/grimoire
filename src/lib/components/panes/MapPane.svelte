<script lang="ts">
  import { untrack } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import { maps } from "$lib/stores/maps.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import {
    FileXCorner,
    LoaderCircle,
    ImagePlus,
    MapPinPlus,
    ZoomIn,
    ZoomOut,
    X,
    Type,
    RectangleHorizontal,
    Circle,
  } from "@lucide/svelte";
  import MapCanvas from "$lib/components/map/MapCanvas.svelte";
  import type { Note, Pin, PinCategory, MapAnnotation, AnnotationKind } from "$lib/types/vault";
  import PinDetailPanel from "$lib/components/map/PinDetailPanel.svelte";
  import AnnotationDetailPanel from "$lib/components/map/AnnotationDetailPanel.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { fly } from "svelte/transition";

  interface Props {
    mapId: number;
    pane: 'left' | 'right';
  }
  let { mapId, pane }: Props = $props();

  let leafletMap = $state<import("leaflet").Map | null>(null);

  // ── Map data ───────────────────────────────────────────────────────────────
  let mapData = $derived(maps.maps.find((m) => m.id === mapId) ?? null);

  // ── Per-map state ──────────────────────────────────────────────────────────
  let pins = $state<Pin[]>([]);
  let categories = $state<PinCategory[]>([]);
  let annotations = $state<MapAnnotation[]>([]);
  let imageDataUrl = $state<string | null>(null);
  let isLoadingData = $state(false);
  let selectedPin = $state<Pin | null>(null);
  let selectedAnnotation = $state<MapAnnotation | null>(null);
  let placingMode = $state(false);
  let annotationMode = $state<AnnotationKind | null>(null);

  // Lock state — ephemeral, not persisted. Items are locked by default.
  // _unlocked* hold the ID of the item the user explicitly unlocked.
  // The derived values nullify if that item is no longer selected.
  let _unlockedPinId = $state<number | null>(null);
  let _unlockedAnnotationId = $state<number | null>(null);
  const unlockedPinId = $derived(
    _unlockedPinId !== null && _unlockedPinId === selectedPin?.id ? _unlockedPinId : null,
  );
  const unlockedAnnotationId = $derived(
    _unlockedAnnotationId !== null && _unlockedAnnotationId === selectedAnnotation?.id
      ? _unlockedAnnotationId
      : null,
  );
  function togglePinLock() {
    if (!selectedPin) return;
    _unlockedPinId = _unlockedPinId === selectedPin.id ? null : selectedPin.id;
  }
  function toggleAnnotationLock() {
    if (!selectedAnnotation) return;
    _unlockedAnnotationId =
      _unlockedAnnotationId === selectedAnnotation.id ? null : selectedAnnotation.id;
  }

  $effect(() => {
    const m = mapData;
    if (!m) return;

    isLoadingData = true;
    selectedPin = null;
    selectedAnnotation = null;
    imageDataUrl = null;
    placingMode = false;
    annotationMode = null;

    const ipcFetches = Promise.all([
      invoke<Pin[]>("get_pins", { mapId: m.id }),
      invoke<PinCategory[]>("get_pin_categories"),
      invoke<MapAnnotation[]>("get_annotations", { mapId: m.id }),
    ]);

    const imageFetch = m.image_path
      ? invoke<string>("get_map_image_data_url", { mapId: m.id })
      : Promise.resolve(null);

    Promise.all([ipcFetches, imageFetch])
      .then(([[p, c, a], url]) => {
        pins = p;
        categories = c;
        annotations = a;
        imageDataUrl = url;
      })
      .catch(console.error)
      .finally(() => {
        isLoadingData = false;
      });
  });

  // ── Tab title sync ─────────────────────────────────────────────────────────
  $effect(() => {
    if (mapData) {
      const title = mapData.title;
      untrack(() => tabs.updateTabTitle('map', mapId, title));
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
    if (!mapData || !draftTitle.trim()) { renamingTitle = false; return; }
    const trimmed = draftTitle.trim();
    if (trimmed === mapData.title) { renamingTitle = false; return; }
    try {
      await invoke("update_map", { map: { ...mapData, title: trimmed } });
      await maps.load();
    } catch { /* ignore */ } finally {
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
      await invoke("assign_map_image", { mapId: mapData.id, sourceImagePath: picked, destFolder: null });
      await maps.load();
      imageDataUrl = await invoke<string>("get_map_image_data_url", { mapId: mapData.id });
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

  // ── Annotation operations ──────────────────────────────────────────────────
  async function handleAnnotationPlace(data: {
    kind: string;
    x: number;
    y: number;
    x2?: number;
    y2?: number;
    radius?: number;
    label?: string;
  }) {
    if (!mapData) return;
    try {
      const ann = await invoke<MapAnnotation>("create_annotation", {
        mapId: mapData.id,
        kind: data.kind,
        x: data.x,
        y: data.y,
        x2: data.x2 ?? null,
        y2: data.y2 ?? null,
        radius: data.radius ?? null,
        label: data.label ?? null,
        color: '#e2e8f0',
        strokeColor: '#94a3b8',
        strokeWidth: 2,
        fontSize: 16,
        opacity: 0.2,
      });
      annotations = [ann, ...annotations];
      selectedAnnotation = ann;
      selectedPin = null;
      // Stay in annotation mode for text (quick multi-placement); exit for shapes
      if (data.kind !== 'text') annotationMode = null;
    } catch (e) {
      console.error("create annotation failed:", e);
    }
  }

  async function handleAnnotationMove(id: number, updates: {
    x: number;
    y: number;
    x2?: number;
    y2?: number;
    radius?: number;
  }) {
    const existing = annotations.find((a) => a.id === id);
    if (!existing) return;
    try {
      const result = await invoke<MapAnnotation>("update_annotation", {
        annotation: { ...existing, ...updates },
      });
      annotations = annotations.map((a) => (a.id === result.id ? result : a));
      if (selectedAnnotation?.id === result.id) selectedAnnotation = result;
    } catch (e) {
      console.error("move annotation failed:", e);
    }
  }

  async function handleAnnotationUpdate(updated: MapAnnotation) {
    try {
      const result = await invoke<MapAnnotation>("update_annotation", { annotation: updated });
      annotations = annotations.map((a) => (a.id === result.id ? result : a));
      selectedAnnotation = result;
    } catch (e) {
      console.error("update annotation failed:", e);
    }
  }

  async function handleAnnotationDelete(id: number) {
    try {
      await invoke("delete_annotation", { annotationId: id });
      annotations = annotations.filter((a) => a.id !== id);
      if (selectedAnnotation?.id === id) selectedAnnotation = null;
    } catch (e) {
      console.error("delete annotation failed:", e);
    }
  }

  // ── Tool helpers ───────────────────────────────────────────────────────────
  function setAnnotationMode(mode: AnnotationKind) {
    if (annotationMode === mode) {
      annotationMode = null;
    } else {
      annotationMode = mode;
      placingMode = false;
      selectedPin = null;
      selectedAnnotation = null;
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
      <a href="/" class="text-sm text-accent hover:underline">← Back to vault</a>
    </div>
  </div>
{:else if !mapData.image_path}
  <!-- Empty state: no image assigned yet -->
  <div class="flex h-full items-center justify-center">
    <div class="flex flex-col items-center gap-6 text-center max-w-xs">
      <div class="flex size-14 items-center justify-center rounded-2xl bg-accent/10 border border-accent/20">
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
  <div
    class="relative w-full h-full overflow-hidden isolate"
  >
    <!-- Map canvas -->
    <MapCanvas
      map={mapData}
      imageDataUrl={imageDataUrl!}
      {pins}
      {categories}
      {annotations}
      selectedPinId={selectedPin?.id ?? null}
      selectedAnnotationId={selectedAnnotation?.id ?? null}
      {unlockedPinId}
      {unlockedAnnotationId}
      {placingMode}
      {annotationMode}
      onpinplace={handlePinPlace}
      onpinclick={(pin) => {
        _unlockedPinId = null;
        selectedPin = pin;
        selectedAnnotation = null;
        placingMode = false;
        annotationMode = null;
      }}
      onpinmove={handlePinMove}
      onmapclick={() => {
        selectedPin = null;
        selectedAnnotation = null;
      }}
      onready={(m) => { leafletMap = m; }}
      onannotationplace={handleAnnotationPlace}
      onannotationmove={handleAnnotationMove}
      onannotationclick={(ann) => {
        _unlockedAnnotationId = null;
        selectedAnnotation = ann;
        selectedPin = null;
        annotationMode = null;
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
            if (e.key === "Enter") { e.preventDefault(); commitTitleRename(); }
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
          <span class="font-display text-sm font-semibold tracking-wide whitespace-nowrap">
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
          if (placingMode) { selectedPin = null; selectedAnnotation = null; annotationMode = null; }
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

      <!-- Text label -->
      <button
        onclick={() => setAnnotationMode('text')}
        title={annotationMode === 'text' ? "Cancel text label" : "Place text label"}
        class="size-9 flex items-center justify-center rounded-lg transition-colors cursor-pointer
               {annotationMode === 'text'
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/10'}"
      >
        <Type class="size-4" />
      </button>

      <!-- Rectangle -->
      <button
        onclick={() => setAnnotationMode('rect')}
        title={annotationMode === 'rect' ? "Cancel rectangle" : "Draw rectangle"}
        class="size-9 flex items-center justify-center rounded-lg transition-colors cursor-pointer
               {annotationMode === 'rect'
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/10'}"
      >
        <RectangleHorizontal class="size-4" />
      </button>

      <!-- Circle -->
      <button
        onclick={() => setAnnotationMode('circle')}
        title={annotationMode === 'circle' ? "Cancel circle" : "Draw circle"}
        class="size-9 flex items-center justify-center rounded-lg transition-colors cursor-pointer
               {annotationMode === 'circle'
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/10'}"
      >
        <Circle class="size-4" />
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

    <!-- Mode hint -->
    {#if placingMode || annotationMode}
      {@const hint = placingMode
        ? 'Click anywhere to place a pin'
        : annotationMode === 'text'
          ? 'Click anywhere to place a text label'
          : annotationMode === 'rect'
            ? 'Click and drag to draw a rectangle'
            : 'Click and drag to draw a circle'}
      <div
        class="absolute bottom-5 left-0 right-0 flex justify-center z-1000 pointer-events-none"
      >
        <div class="bg-background/80 backdrop-blur-sm border border-border/60 rounded-lg px-4 py-2 shadow-md">
          <p class="text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
    {/if}

    <!-- Selected pin panel -->
    {#if selectedPin && !placingMode && !annotationMode}
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
          unlocked={unlockedPinId !== null}
          onToggleLock={togglePinLock}
          onUpdate={async (updated: Pin) => {
            try {
              const saved: Pin = await invoke("update_pin", { pin: updated });
              pins = pins.map((p) => (p.id === saved.id ? saved : p));
              selectedPin = saved;
            } finally {}
          }}
        />
      </div>
    {/if}

    <!-- Selected annotation panel -->
    {#if selectedAnnotation && !placingMode}
      <div
        transition:fly={{ x: 200, duration: 100 }}
        class="absolute top-4 right-4 z-1000 w-72 bg-background rounded-2xl shadow-2xl border border-border
               flex flex-col overflow-hidden"
      >
        <AnnotationDetailPanel
          annotation={selectedAnnotation}
          unlocked={unlockedAnnotationId !== null}
          onToggleLock={toggleAnnotationLock}
          onUpdate={handleAnnotationUpdate}
          onDelete={handleAnnotationDelete}
        />
      </div>
    {/if}
  </div>
{/if}
