<script lang="ts">
  import { untrack } from "svelte";
  import { api } from "$lib/api";
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
  import { DEFAULT_ANNOTATION_COLOR, DEFAULT_ANNOTATION_STROKE } from "$lib/entity-colors";
  import type { Note, Pin, PinCategory, MapAnnotation, AnnotationKind } from "$lib/types/ledger";
  import AnnotationDetails, { KIND_LABELS } from "$lib/components/map/AnnotationDetails.svelte";
  import PinDetails from "$lib/components/map/PinDetails.svelte";
  import DetailPanel from "$lib/components/DetailPanel.svelte";
  import DetailSurface from "$lib/components/DetailSurface.svelte";
  import { toastUndo } from "$lib/toast";
  import { notes } from "$lib/stores/notes.svelte";
  import { paneDetailState } from "$lib/stores/pane-detail-state.svelte";
  import { createPinDetailsSource } from "$lib/details/pin-details-source.svelte";
  import { createAnnotationDetailsSource } from "$lib/details/annotation-details-source.svelte";
  import { paneSurface } from "$lib/details/pane-detail-surface.svelte";

  interface Props {
    mapId: number;
    pane: "left" | "right";
  }
  let { mapId, pane }: Props = $props();

  // A map's surface always floats, whatever the pane measures: docking would
  // shrink the canvas and a sheet would swallow it (ADR-0006 §2). And it carries
  // no toggle — selecting a pin or an annotation is what opens it (§3) — so the
  // pane's header row shows none.
  const surface = $derived(paneSurface(pane));
  $effect(() => surface.claim({ toggleable: false, alwaysFloat: true }));

  let leafletMap = $state<import("leaflet").Map | null>(null);

  // ── Map data ───────────────────────────────────────────────────────────────
  let mapData = $derived(maps.maps.find((m) => m.id === mapId) ?? null);

  // ── Per-map state ──────────────────────────────────────────────────────────
  let pins = $state<Pin[]>([]);
  let categories = $state<PinCategory[]>([]);
  let annotations = $state<MapAnnotation[]>([]);
  let imageDataUrl = $state<string | null>(null);
  let isLoadingData = $state(false);
  // The map's image (or data) couldn't be loaded — e.g. the image file was
  // deleted outside Grimoire. Renders the unified error state below.
  let loadError = $state(false);
  let selectedPin = $state<Pin | null>(null);
  let selectedAnnotation = $state<MapAnnotation | null>(null);
  let placingMode = $state(false);
  let annotationMode = $state<AnnotationKind | null>(null);

  // The pin Details Source owns the auxiliary-data fan-out behind PinDetails
  // (tags, allTags, categories, note preview); the pin row stays here — the
  // canvas needs it for rendering and drag (see CONTEXT.md — "Details Source").
  const selectedLinkedNote = $derived(
    notes.notes.find((n: Note) => n.id === selectedPin?.note_id) ?? null,
  );
  const pinDetails = createPinDetailsSource(
    () => selectedPin,
    () => selectedLinkedNote,
    (saved: Pin) => {
      pins = pins.map((p) => (p.id === saved.id ? saved : p));
      selectedPin = saved;
    },
  );

  // The annotation Details Source is the annotation panel's save path and
  // nothing else — an annotation has no auxiliary data to fetch. It is here so
  // annotation edits report into the DetailPanel's status indicator instead of
  // into console.error (see CONTEXT.md — "Details Source").
  const annotationDetails = createAnnotationDetailsSource(
    () => selectedAnnotation,
    (saved: MapAnnotation) => {
      annotations = annotations.map((a) => (a.id === saved.id ? saved : a));
      selectedAnnotation = saved;
    },
    (id: number) => {
      annotations = annotations.filter((a) => a.id !== id);
      if (selectedAnnotation?.id === id) selectedAnnotation = null;
    },
  );

  // Track whether initial map data has loaded; used to gate store writes so
  // the initial null-clear that happens at load-start doesn't overwrite saved state.
  let mapLoaded = $state(false);

  // Persist selection to the per-pane store so it survives tab switches.
  $effect(() => {
    if (!mapLoaded) return;
    paneDetailState.setMapSelection(pane, mapId, {
      pinId: selectedPin?.id ?? null,
      annotationId: selectedAnnotation?.id ?? null,
    });
  });

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
    mapLoaded = false;
    selectedPin = null;
    selectedAnnotation = null;
    imageDataUrl = null;
    loadError = false;
    placingMode = false;
    annotationMode = null;

    // Generated types widen the refined ledger types (nullable floats from
    // specta's NaN-guard; `string` instead of the PinShape/PinIcon/Annotation
    // unions). The backend only ever emits valid values, so narrow at the seam.
    // Silent surface: the pane owns the error UI below (ADR-0010).
    const ipcFetches = Promise.all([
      api.silent.getPins(m.id) as Promise<Pin[]>,
      api.silent.getPinCategories() as Promise<PinCategory[]>,
      api.silent.getAnnotations(m.id) as Promise<MapAnnotation[]>,
    ]);

    const imageFetch = m.image_path ? api.silent.getMapImageDataUrl(m.id) : Promise.resolve(null);

    Promise.all([ipcFetches, imageFetch])
      .then(([[p, c, a], url]) => {
        pins = p;
        categories = c;
        annotations = a;
        imageDataUrl = url;
        // Restore pane-local selection (persists across tab switches).
        const saved = paneDetailState.getMapSelection(pane, m.id);
        selectedPin = p.find((pin) => pin.id === saved.pinId) ?? null;
        selectedAnnotation = a.find((ann) => ann.id === saved.annotationId) ?? null;
        mapLoaded = true;
      })
      .catch(() => {
        // Image file moved/deleted outside Grimoire, or the data fetch failed —
        // without it the canvas can't render; show the unified error state.
        loadError = true;
      })
      .finally(() => {
        isLoadingData = false;
      });
  });

  // ── Tab title sync ─────────────────────────────────────────────────────────
  $effect(() => {
    if (mapData) {
      const title = mapData.title;
      untrack(() => tabs.updateTabTitle("map", mapId, title));
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
      await api.updateMap({ ...mapData, title: trimmed });
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
      await api.assignMapImage(mapData.id, picked, null);
      await maps.load();
      imageDataUrl = await api.getMapImageDataUrl(mapData.id);
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
      const pin = (await api.createPin(mapData.id, x, y, "New Pin", null, null, null)) as Pin;
      pins = [pin, ...pins];
      selectedPin = pin;
      placingMode = false;
    } catch (e) {
      console.error("create pin failed:", e);
    }
  }

  /*
    Deleting a pin is undoable; deleting a shape is not, and the difference is what each
    one costs to rebuild. A rectangle is redrawn in a second. A pin carries a title, a
    description, tags and a link to a note — minutes of work behind two clicks and no
    confirmation step, which is the case DESIGN.md's undo toast exists for. (It refuses a
    modal here, and rightly: a dialog on every pin would tax the common path to protect
    the rare one.)

    The pin leaves the map immediately and `deletePin` is what waits. That ordering is the
    whole reason undo is lossless: the row is still in the database during the window, so
    its tags and its id come back untouched rather than being rebuilt from what this
    component happened to be holding. It also means the map reads as it should the instant
    the GM clicks — a pin that lingered for five seconds would look like a failed click.

    Restored at its own index rather than pushed to the front, so undo leaves the list
    exactly as it found it.
  */
  function handlePinDelete(id: number) {
    const index = pins.findIndex((p) => p.id === id);
    if (index === -1) return;
    const removed = pins[index];

    pins = pins.filter((p) => p.id !== id);
    if (selectedPin?.id === id) selectedPin = null;
    if (_unlockedPinId === id) _unlockedPinId = null;

    toastUndo(
      `"${removed.title}" deleted`,
      async () => {
        try {
          await api.deletePin(id);
        } catch (e) {
          // The window elapsed but the delete failed, so the pin still exists on disk
          // and the map is the thing that is now wrong. Put it back.
          console.error("delete pin failed:", e);
          pins = [...pins.slice(0, index), removed, ...pins.slice(index)];
        }
      },
      () => {
        pins = [...pins.slice(0, index), removed, ...pins.slice(index)];
      },
    );
  }

  async function handlePinMove(pin: Pin, x: number, y: number) {
    try {
      const result = (await api.updatePin({ ...pin, x, y })) as Pin;
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
      const ann = (await api.createAnnotation({
        mapId: mapData.id,
        kind: data.kind,
        x: data.x,
        y: data.y,
        x2: data.x2 ?? null,
        y2: data.y2 ?? null,
        radius: data.radius ?? null,
        label: data.label ?? null,
        color: DEFAULT_ANNOTATION_COLOR,
        strokeColor: DEFAULT_ANNOTATION_STROKE,
        strokeWidth: 2,
        fontSize: 16,
        opacity: 0.2,
      })) as MapAnnotation;
      annotations = [ann, ...annotations];
      selectedAnnotation = ann;
      selectedPin = null;
      // Stay in annotation mode for text (quick multi-placement); exit for shapes
      if (data.kind !== "text") annotationMode = null;
    } catch (e) {
      console.error("create annotation failed:", e);
    }
  }

  async function handleAnnotationMove(
    id: number,
    updates: {
      x: number;
      y: number;
      x2?: number;
      y2?: number;
      radius?: number;
    },
  ) {
    const existing = annotations.find((a) => a.id === id);
    if (!existing) return;
    try {
      const result = (await api.updateAnnotation({ ...existing, ...updates })) as MapAnnotation;
      annotations = annotations.map((a) => (a.id === result.id ? result : a));
      if (selectedAnnotation?.id === result.id) selectedAnnotation = result;
    } catch (e) {
      console.error("move annotation failed:", e);
    }
  }

  /*
    Delete the selected shape from the keyboard.

    The panel's button is the discoverable route; this is the one a GM reaches for without
    thinking, and its absence was most of why deleting a shape felt impossible — you draw
    a rectangle, it is selected, you press Delete, and nothing happens.

    Guarded on the event target, because this listens at the window: a `Backspace` while
    renaming the map title, editing a label, or typing anywhere else must delete a
    character, not a rectangle. Escape clears the selection, which is the other half of
    the same reflex.
  */
  function isTypingIn(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  function onMapKeydown(e: KeyboardEvent) {
    if (isTypingIn(e.target)) return;

    if (e.key === "Escape") {
      if (placingMode || annotationMode) {
        placingMode = false;
        annotationMode = null;
      } else if (selectedAnnotation || selectedPin) {
        selectedAnnotation = null;
        selectedPin = null;
      }
      return;
    }

    if (e.key !== "Delete" && e.key !== "Backspace") return;
    // Only ever one of the two is selected — every path that sets one clears the other —
    // so the order here is a formality rather than a precedence rule.
    if (selectedAnnotation) {
      e.preventDefault();
      void annotationDetails.deleteAnnotation(selectedAnnotation.id);
    } else if (selectedPin) {
      e.preventDefault();
      void handlePinDelete(selectedPin.id);
    }
  }

  // ── Tool helpers ───────────────────────────────────────────────────────────
  /* Arming the pin tool disarms everything else and drops any selection, so the pane is
     only ever in one mode. Lifted out of the button's markup when the toolbar became a
     snippet — the other five tools already called a named function. */
  function togglePlacing() {
    placingMode = !placingMode;
    if (placingMode) {
      selectedPin = null;
      selectedAnnotation = null;
      annotationMode = null;
    }
  }

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

<!--
  One tool button, stated once. Six of them used to carry the same class string inline,
  which is how all six came to share the same two defects at once.

  ARMED IS A SOLID FILL. The armed state was `bg-accent`, which is not the brand accent
  at all — shadcn's `--accent` is a 12%-alpha hover surface (see the note in app.css) —
  so an armed tool was a wash a shade off its own hover, and the hover beneath it,
  `bg-accent/10`, composed that 12% down to about 1.2% and vanished outright. A GM could
  not see which tool was live, which on this pane decides what the next click on the map
  does. Solid `--primary` because arming a tool is a *mode*: it changes the meaning of
  every subsequent click until it is cancelled, and DESIGN.md spends the accent exactly
  on states like that. The sidebar's quieter tint is for a resting selection, not a mode.

  ARMED IS ALSO `aria-pressed`. The buttons carried a `title` and nothing else, so the
  state a screen reader got was whatever the tooltip happened to say. `armed === null`
  marks the momentary buttons (zoom), which are not toggles and take no pressed state.
-->
{#snippet tool(
  Icon: typeof MapPinPlus,
  label: string,
  armed: boolean | null,
  onclick: () => void,
  ArmedIcon?: typeof MapPinPlus,
  armedLabel?: string,
)}
  {@const on = armed === true}
  {@const Rendered = on && ArmedIcon ? ArmedIcon : Icon}
  <button
    type="button"
    {onclick}
    aria-label={on && armedLabel ? armedLabel : label}
    aria-pressed={armed === null ? undefined : on}
    title={on && armedLabel ? armedLabel : label}
    class="size-9 flex items-center justify-center rounded-lg transition-colors cursor-pointer
           {on
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:text-foreground hover:bg-surface-hover'}"
  >
    <Rendered class="size-4" />
  </button>
{/snippet}

<svelte:window onkeydown={onMapKeydown} />

{#if maps.isLoading || isLoadingData}
  <div class="flex h-full items-center justify-center">
    <LoaderCircle class="w-5 h-5 animate-spin text-primary" />
  </div>
{:else if !mapData}
  <div class="flex h-full items-center justify-center">
    <div class="flex flex-col items-center gap-4 text-center max-w-xs">
      <FileXCorner class="w-7 h-7 text-muted-foreground" />
      <p class="font-sans text-base font-semibold">Map not found</p>
      <a href="/" class="text-sm text-primary hover:underline">← Back to ledger</a>
    </div>
  </div>
{:else if loadError}
  <!-- Image file moved/deleted outside Grimoire (or data fetch failed) -->
  <div class="flex h-full items-center justify-center" data-testid="map-load-error">
    <div class="flex flex-col items-center gap-4 text-center max-w-xs">
      <FileXCorner class="w-7 h-7 text-muted-foreground" />
      <p class="font-sans text-base font-semibold">Can't display this map</p>
      <p class="text-sm text-muted-foreground leading-relaxed">
        Its image couldn't be read — the file may have been moved or deleted outside Grimoire.
      </p>
    </div>
  </div>
{:else if !mapData.image_path}
  <!-- Empty state: no image assigned yet -->
  <div class="flex h-full items-center justify-center">
    <div class="flex flex-col items-center gap-6 text-center max-w-xs">
      <div
        class="flex size-14 items-center justify-center rounded-2xl bg-primary-subtle border border-primary-muted"
      >
        <ImagePlus class="size-7 text-primary" strokeWidth={1.5} />
      </div>
      <div class="space-y-1.5">
        <!-- The GM's name for this map, so it speaks in the world's voice — Metamorphous
             at 400, never bolded (DESIGN.md §3). It was asking for `font-display`, which
             is not a class Tailwind compiles, so it has been rendering in Nunito. -->
        <p class="font-heading text-xl">{mapData.title}</p>
        <p class="text-sm text-muted-foreground leading-relaxed">
          Add a background image to start placing pins.
        </p>
      </div>
      <button
        onclick={handleAssignImage}
        disabled={isAssigningImage}
        class="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium
               hover:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {isAssigningImage ? "Copying image…" : "Choose background image"}
      </button>
    </div>
  </div>
{:else}
  <!-- Ready state: full map canvas -->
  <div class="relative w-full h-full overflow-hidden isolate">
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
      onready={(m) => {
        leafletMap = m;
      }}
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
            if (e.key === "Enter") {
              e.preventDefault();
              commitTitleRename();
            }
            if (e.key === "Escape") renamingTitle = false;
          }}
          aria-label="Map name"
          class="bg-background/90 backdrop-blur-sm border border-border rounded-lg px-3 py-1.5
                 font-heading text-sm shadow-sm"
        />
      {:else}
        <button
          onclick={startTitleRename}
          title="Click to rename"
          aria-label="Rename map"
          class="flex items-center gap-2 bg-background/80 backdrop-blur-sm border border-border/60
                 rounded-lg px-3 py-1.5 hover:border-primary/60 transition-colors cursor-pointer shadow-sm"
        >
          <span class="font-heading text-sm tracking-wide whitespace-nowrap">
            {mapData.title}
          </span>
        </button>
      {/if}
    </div>

    <!-- Left vertical toolbar -->
    <div
      class="absolute left-3 top-1/2 -translate-y-1/2 z-1000 flex flex-col items-center
             bg-background/90 backdrop-blur-sm border border-border/60 rounded-xl shadow-md p-1 gap-0.5"
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Map tools"
    >
      {@render tool(MapPinPlus, "Place pin", placingMode, togglePlacing, X, "Cancel placing")}

      <div class="w-5 h-px bg-border/60 my-0.5"></div>

      {@render tool(Type, "Place text label", annotationMode === "text", () =>
        setAnnotationMode("text"),
      )}
      {@render tool(RectangleHorizontal, "Draw rectangle", annotationMode === "rect", () =>
        setAnnotationMode("rect"),
      )}
      {@render tool(Circle, "Draw circle", annotationMode === "circle", () =>
        setAnnotationMode("circle"),
      )}

      <div class="w-5 h-px bg-border/60 my-0.5"></div>

      {@render tool(ZoomIn, "Zoom in", null, () => leafletMap?.zoomIn())}
      {@render tool(ZoomOut, "Zoom out", null, () => leafletMap?.zoomOut())}
    </div>

    <!-- Mode hint -->
    {#if placingMode || annotationMode}
      {@const hint = placingMode
        ? "Click anywhere to place a pin"
        : annotationMode === "text"
          ? "Click anywhere to place a text label"
          : annotationMode === "rect"
            ? "Click and drag to draw a rectangle"
            : "Click and drag to draw a circle"}
      <div class="absolute bottom-5 left-0 right-0 flex justify-center z-1000 pointer-events-none">
        <div
          class="bg-background/80 backdrop-blur-sm border border-border/60 rounded-lg px-4 py-2 shadow-md"
        >
          <p class="text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
    {/if}

    <!-- Selected pin panel. The `{#if}` sits outside the surface rather than
         inside its body, so the body never renders without a pin and closing
         destroys it at once — which is what commits an unblurred edit to the
         right pin (#201). `open` is then constant for as long as the block
         lives, and the surface flies the panel in but not out (see
         `DetailSurface.svelte`). -->
    {#if selectedPin && !placingMode && !annotationMode}
      <DetailSurface
        {surface}
        open={true}
        onclose={() => {
          selectedPin = null;
        }}
      >
        <DetailPanel
          title={selectedPin!.title || "Pin"}
          saveStatus={pinDetails.saveStatus}
          onRetrySave={pinDetails.retrySave}
          onclose={() => {
            selectedPin = null;
          }}
        >
          <PinDetails
            pin={selectedPin!}
            linkedNote={selectedLinkedNote}
            unlocked={unlockedPinId !== null}
            bind:pinTags={pinDetails.pinTags}
            allTags={pinDetails.allTags}
            categories={pinDetails.categories}
            notePreview={pinDetails.notePreview}
            onTagsChange={pinDetails.savePinTags}
            onToggleLock={togglePinLock}
            onUpdate={pinDetails.savePin}
            onDelete={handlePinDelete}
            onOpenNote={(id, title) => tabs.openTab({ type: "note", id, title })}
          />
        </DetailPanel>
      </DetailSurface>
    {/if}

    <!-- Selected annotation panel -->
    {#if selectedAnnotation && !placingMode}
      <DetailSurface
        {surface}
        open={true}
        onclose={() => {
          selectedAnnotation = null;
        }}
      >
        <DetailPanel
          title={KIND_LABELS[selectedAnnotation!.kind]}
          saveStatus={annotationDetails.saveStatus}
          onRetrySave={annotationDetails.retrySave}
          onclose={() => {
            selectedAnnotation = null;
          }}
        >
          <AnnotationDetails
            annotation={selectedAnnotation!}
            unlocked={unlockedAnnotationId !== null}
            onToggleLock={toggleAnnotationLock}
            onUpdate={annotationDetails.saveAnnotation}
            onDelete={annotationDetails.deleteAnnotation}
          />
        </DetailPanel>
      </DetailSurface>
    {/if}
  </div>
{/if}
