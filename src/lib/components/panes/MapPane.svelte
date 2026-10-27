<script lang="ts">
  import { untrack } from "svelte";
  import { api } from "$lib/api";
  import { open } from "@tauri-apps/plugin-dialog";
  import { maps } from "$lib/stores/maps.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { Button } from "$lib/components/ui/button";
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
  import { unlinkedPins } from "$lib/stores/unlinked-pins.svelte";
  import { createPinDetailsSource } from "$lib/details/pin-details-source.svelte";
  import { createAnnotationDetailsSource } from "$lib/details/annotation-details-source.svelte";
  import { paneSurface } from "$lib/details/pane-detail-surface.svelte";
  import { isTypingIn } from "$lib/utils/keyboard";
  import { appPrefs } from "$lib/stores/app-prefs.svelte";

  interface Props {
    mapId: number;
    pane: "left" | "right";
    /** Opened by Rename in the tree's menu: start naming it. */
    rename?: boolean;
    tabIndex?: number;
  }
  let { mapId, pane, rename = false, tabIndex = 0 }: Props = $props();

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

  // KEEP THE SELECTION IN SIGHT. A map's detail panel always floats (ADR-0006) and
  // floats top-right, so a pin in the east third of the map used to vanish under the
  // panel describing it — the GM clicked to see *where* and the answer hid it. On
  // each new selection the map pans just far enough to put the pin (or annotation
  // anchor) in the uncovered region. `panInside` is a no-op when it is already clear,
  // so a selection that was visible never moves the map.
  //
  // Keyed on the selection's identity alone: dragging a selected pin rewrites
  // `selectedPin` on every save, and the map must not chase a pin the GM is moving.
  const PANEL_CLEARANCE = 320 + 16 + 24; // DetailSurface w-80, its right-4 inset, breathing room
  const focusKey = $derived(
    selectedPin
      ? `pin:${selectedPin.id}`
      : selectedAnnotation
        ? `ann:${selectedAnnotation.id}`
        : null,
  );
  $effect(() => {
    if (!focusKey) return;
    untrack(() => {
      const target = selectedPin ?? selectedAnnotation;
      const m = leafletMap;
      if (!target || !m || !mapData?.image_width || !mapData.image_height) return;
      // A pane too narrow to leave a clear region past the panel gets what it can
      // rather than a padding Leaflet cannot satisfy.
      const right = Math.min(PANEL_CLEARANCE, Math.max(24, m.getSize().x - 120));
      m.panInside([target.y * mapData.image_height, target.x * mapData.image_width], {
        paddingTopLeft: [24, 24],
        paddingBottomRight: [right, 24],
        animate: !appPrefs.reduceMotion,
      });
    });
  });

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

  // A pin chosen in the unlinked-pins list: select it here once the pins are in. The
  // list used to open the map and leave the GM to find the pin among identical icons.
  $effect(() => {
    if (!mapLoaded || unlinkedPins.goTo?.mapId !== mapId) return;
    untrack(() => {
      const pinId = unlinkedPins.takeGoTo(mapId);
      const pin = pins.find((p) => p.id === pinId);
      if (!pin) return;
      selectedAnnotation = null;
      selectedPin = pin;
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

  // The tree's Rename opens the map here and asks for its name, as a note's does
  // (2026-10 design review — a map had no Rename anywhere but its own title).
  $effect(() => {
    if (rename && mapData) {
      startTitleRename();
      tabs.clearRenameFlag(pane, tabIndex);
    }
  });

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
          unlinkedPins.resolve(id);
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
    <!-- The house empty state (the scene editor's): a neutral tile, the map's name, one
         line, one way on. It had a crimson tile, and called the picture a "background
         image" where Appearance calls it a picture (2026-10 design review). -->
    <div class="flex flex-col items-center text-center max-w-xs">
      <div class="flex size-12 items-center justify-center rounded-lg bg-muted">
        <ImagePlus class="size-6 text-muted-foreground" strokeWidth={1.5} />
      </div>
      <!-- The GM's name for this map, so it speaks in the world's voice — Metamorphous
           at 400, never bolded (DESIGN.md §3). -->
      <h2 class="mt-5 font-heading text-[1.375rem] leading-tight font-normal">{mapData.title}</h2>
      <p class="mt-2 text-sm text-muted-foreground leading-relaxed">
        Choose a picture of the map to start placing pins on it.
      </p>
      <Button size="sm" class="mt-5" onclick={handleAssignImage} disabled={isAssigningImage}>
        {isAssigningImage ? "Copying the picture…" : "Choose a picture"}
      </Button>
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

    <!-- Title badge. Opaque, with the button inside it, so hover can take the Hover
         Overlay without the map showing through; it hovered with a crimson border and
         carried a second shadow over `shadow-float` until the 2026-10 review. -->
    <div class="absolute top-3 left-3 z-1000 rounded-lg border border-border bg-popover shadow-float">
      {#if renamingTitle}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          autofocus
          bind:value={draftTitle}
          onfocus={(e) => e.currentTarget.select()}
          onblur={commitTitleRename}
          onkeydown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTitleRename();
            }
            if (e.key === "Escape") renamingTitle = false;
          }}
          aria-label="Map name"
          class="rounded-lg bg-transparent px-3 py-1.5 font-heading text-sm"
        />
      {:else}
        <button
          onclick={startTitleRename}
          title="Click to rename"
          aria-label="Rename {mapData.title}"
          class="flex items-center gap-2 rounded-lg px-3 py-1.5 transition-colors cursor-pointer hover:bg-surface-hover"
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
             bg-popover border border-border rounded-xl shadow-float p-1 gap-0.5"
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
        <div class="bg-popover border border-border rounded-lg px-4 py-2 shadow-float">
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
          title="Pin"
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
