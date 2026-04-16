<script lang="ts">
  import { page } from "$app/state";
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import { maps } from "$lib/stores/maps.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { breadcrumbs } from "$lib/stores/breadcrumbs.svelte";
  import { FileXCorner, LoaderCircle, ImagePlus, MapPin, X } from "@lucide/svelte";
  import MapCanvas from "$lib/components/map/MapCanvas.svelte";
  import PinDetailPanel from "$lib/components/map/PinDetailPanel.svelte";
  import CategorySelect from "$lib/components/map/CategorySelect.svelte";
  import { toast } from "svelte-sonner";
  import type { Pin, PinCategory, Note } from "$lib/types/vault";

  // ── Map data ───────────────────────────────────────────────────────────────
  let mapData = $derived(
    maps.maps.find((m) => m.id === Number(page.params.id)) ?? null,
  );

  $effect(() => {
    if (mapData) {
      breadcrumbs.set([{ label: mapData.title }]);
    } else {
      breadcrumbs.clear();
    }
    return () => breadcrumbs.clear();
  });

  // ── Per-map state ──────────────────────────────────────────────────────────
  let pins = $state<Pin[]>([]);
  let categories = $state<PinCategory[]>([]);
  let imageDataUrl = $state<string | null>(null);
  let isLoading = $state(true);

  // Guard: only load once per map ID
  let lastLoadedId = $state<number | null>(null);

  $effect(() => {
    const m = mapData;
    if (!m) return;
    if (m.id === lastLoadedId) return;
    const id = m.id;
    lastLoadedId = id;
    isLoading = true;
    imageDataUrl = null;
    selectedPin = null;

    const fetches: Promise<unknown>[] = [
      invoke<Pin[]>("get_pins", { mapId: id }),
      invoke<PinCategory[]>("get_pin_categories"),
    ];

    if (m.image_path) {
      fetches.push(invoke<string>("get_map_image_data_url", { mapId: id }));
    }

    Promise.all(fetches)
      .then(([p, c, img]) => {
        if (lastLoadedId !== id) return;
        pins = p as Pin[];
        categories = c as PinCategory[];
        imageDataUrl = (img as string | undefined) ?? null;
      })
      .catch(() => toast.error("Couldn't load this map"))
      .finally(() => { if (lastLoadedId === id) isLoading = false; });
  });

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
      await invoke("assign_map_image", { mapId: mapData.id, sourceImagePath: picked });
      await maps.load();
      // Reset load guard so the effect re-fetches with image
      lastLoadedId = null;
    } catch {
      toast.error("Couldn't assign the image");
    } finally {
      isAssigningImage = false;
    }
  }

  // ── Interaction state ──────────────────────────────────────────────────────
  let placingPin = $state(false);
  let selectedPin = $state<Pin | null>(null);

  // ── First-use hint ─────────────────────────────────────────────────────────
  const HINT_KEY = "grimoire-map-hint-dismissed";
  let showEmptyHint = $state(
    typeof localStorage !== "undefined" ? !localStorage.getItem(HINT_KEY) : false,
  );

  function dismissHint() {
    showEmptyHint = false;
    localStorage.setItem(HINT_KEY, "1");
  }

  // ── Place Pin mode ─────────────────────────────────────────────────────────
  let pendingPlacement = $state<{ x: number; y: number } | null>(null);
  let showPlacePinPopover = $state(false);
  let newPinTitle = $state("");
  let newPinCategoryId = $state<number | null>(null);
  let isCreatingPin = $state(false);

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (placingPin) { placingPin = false; return; }
      if (showPlacePinPopover) { showPlacePinPopover = false; pendingPlacement = null; return; }
      if (selectedPin) { selectedPin = null; }
    }
  }

  function handlePinPlace(x: number, y: number) {
    pendingPlacement = { x, y };
    placingPin = false;
    showPlacePinPopover = true;
  }

  async function confirmPlacePin() {
    if (!pendingPlacement || !newPinTitle.trim() || !mapData) return;
    isCreatingPin = true;
    try {
      const created = await invoke<Pin>("create_pin", {
        mapId: mapData.id,
        x: pendingPlacement.x,
        y: pendingPlacement.y,
        title: newPinTitle.trim(),
        description: null,
        categoryId: newPinCategoryId,
        noteId: null,
      });
      pins = [...pins, created];
      showPlacePinPopover = false;
      pendingPlacement = null;
      newPinTitle = "";
      newPinCategoryId = null;
    } catch {
      toast.error("Couldn't place the pin");
    } finally {
      isCreatingPin = false;
    }
  }

  // ── Pin operations ─────────────────────────────────────────────────────────
  async function handlePinUpdate(updated: Pin) {
    try {
      const saved = await invoke<Pin>("update_pin", { pin: updated });
      pins = pins.map((p) => (p.id === saved.id ? saved : p));
      if (selectedPin?.id === saved.id) selectedPin = saved;
    } catch {
      toast.error("Couldn't save your changes");
    }
  }

  async function handlePinMove(pin: Pin, x: number, y: number) {
    await handlePinUpdate({ ...pin, x, y });
  }

  async function handlePinDelete() {
    if (!selectedPin) return;
    const pinToDelete = selectedPin;
    pins = pins.filter((p) => p.id !== pinToDelete.id);
    selectedPin = null;
    let undone = false;

    const doDelete = async () => {
      if (undone) return;
      try {
        await invoke("delete_pin", { pinId: pinToDelete.id });
      } catch {
        pins = [...pins, pinToDelete];
        toast.error("Couldn't remove the pin — it's been restored");
      }
    };

    toast("Pin removed", {
      description: pinToDelete.title,
      action: { label: "Undo", onClick: () => { undone = true; pins = [...pins, pinToDelete]; selectedPin = pinToDelete; } },
      onAutoClose: doDelete,
      onDismiss: doDelete,
      duration: 5000,
    });
  }

  function handleCategoryUpdated(updated: PinCategory) {
    categories = categories.map((c) => (c.id === updated.id ? updated : c));
  }

  // ── Title rename ───────────────────────────────────────────────────────────
  let renamingTitle = $state(false);
  let draftTitle = $state("");
  // Exposed ref so zoom buttons can call zoomIn/zoomOut
  let leafletMapRef = $state<import("leaflet").Map | null>(null);

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
    } catch {
      toast.error("Couldn't rename the map");
    } finally {
      renamingTitle = false;
    }
  }

  const linkedNote = $derived(
    selectedPin?.note_id != null
      ? (notes.notes.find((n: Note) => n.id === selectedPin!.note_id) ?? null)
      : null,
  );

  const selectedPinCat = $derived(
    selectedPin ? categories.find((c) => c.id === selectedPin!.category_id) ?? undefined : undefined,
  );
</script>

<svelte:window onkeydown={handleKeydown} />

{#if maps.isLoading}
  <div class="flex h-full items-center justify-center">
    <LoaderCircle class="w-5 h-5 animate-spin text-accent" />
  </div>
{:else if !mapData}
  <div class="flex h-full items-center justify-center">
    <div class="flex flex-col items-center gap-4 text-center max-w-xs">
      <FileXCorner class="w-7 h-7 text-foreground-muted" />
      <p class="font-display text-lg font-semibold text-foreground">Map not found</p>
      <a href="/" class="font-sans text-sm text-accent hover:underline">← Back to vault</a>
    </div>
  </div>
{:else if !mapData.image_path}
  <!-- Empty state: no image assigned yet -->
  <div class="flex h-full items-center justify-center">
    <div class="flex flex-col items-center gap-4 text-center max-w-xs">
      <div class="flex size-12 items-center justify-center rounded-xl bg-primary/10">
        <ImagePlus class="size-6 text-primary" strokeWidth={1.5} />
      </div>
      <div class="space-y-1">
        <p class="font-display text-lg font-semibold text-foreground">{mapData.title}</p>
        <p class="font-sans text-sm text-foreground-muted">Add a background image to start placing pins.</p>
      </div>
      <button
        onclick={handleAssignImage}
        disabled={isAssigningImage}
        class="px-4 py-2 rounded-lg btn-accent font-sans text-sm font-semibold
               disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {isAssigningImage ? "Copying image…" : "Choose background image"}
      </button>
    </div>
  </div>
{:else}
  <!-- Ready state: full map canvas -->
  <div class="relative w-full h-full overflow-hidden select-none">
    {#if isLoading}
      <div class="absolute inset-0 flex items-center justify-center z-10">
        <LoaderCircle class="w-6 h-6 animate-spin text-accent" />
      </div>
    {:else if imageDataUrl}
      <MapCanvas
        map={mapData}
        {imageDataUrl}
        {pins}
        {categories}
        selectedPinId={selectedPin?.id ?? null}
        placingMode={placingPin}
        onpinplace={handlePinPlace}
        onpinclick={(pin) => { selectedPin = pin; }}
        onpinmove={handlePinMove}
        onmapclick={() => { selectedPin = null; }}
        onready={(m) => { leafletMapRef = m; }}
      />
    {/if}

    {#if !isLoading && pins.length === 0 && showEmptyHint && imageDataUrl}
      <div class="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
        <div class="relative flex flex-col items-center gap-3 text-center select-none
                    bg-surface/75 backdrop-blur-sm border border-border/40
                    rounded-2xl px-10 py-8 pointer-events-auto overflow-hidden">
          <!-- Compass-rose watermark -->
          <svg viewBox="0 0 120 120" class="absolute inset-0 w-full h-full pointer-events-none opacity-[0.04]" aria-hidden="true">
            <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" stroke-width="1" />
            <circle cx="60" cy="60" r="38" fill="none" stroke="currentColor" stroke-width="0.5" />
            <circle cx="60" cy="60" r="4" fill="currentColor" />
            <polygon points="60,8 55,48 60,44 65,48" fill="currentColor" />
            <polygon points="60,112 55,72 60,76 65,72" fill="currentColor" opacity="0.5" />
            <polygon points="8,60 48,55 44,60 48,65" fill="currentColor" opacity="0.5" />
            <polygon points="112,60 72,55 76,60 72,65" fill="currentColor" opacity="0.5" />
            <line x1="60" y1="10" x2="60" y2="18" stroke="currentColor" stroke-width="1.5" transform="rotate(45 60 60)" />
            <line x1="60" y1="10" x2="60" y2="18" stroke="currentColor" stroke-width="1.5" transform="rotate(135 60 60)" />
            <line x1="60" y1="10" x2="60" y2="18" stroke="currentColor" stroke-width="1.5" transform="rotate(225 60 60)" />
            <line x1="60" y1="10" x2="60" y2="18" stroke="currentColor" stroke-width="1.5" transform="rotate(315 60 60)" />
          </svg>
          <button onclick={dismissHint}
            class="absolute top-2 right-2 p-1 rounded text-foreground-faint hover:text-foreground
                   hover:bg-accent-subtle transition-colors cursor-pointer" title="Don't show again">
            <X class="w-3.5 h-3.5" />
          </button>
          <MapPin class="w-6 h-6 text-accent/70" />
          <p class="font-display text-base font-semibold text-foreground">Your map awaits</p>
          <p class="font-sans text-sm text-foreground-muted max-w-45 leading-relaxed">
            Use <span class="text-foreground font-medium">Place Pin</span> below to mark your first location
          </p>
        </div>
      </div>
    {/if}

    <!-- Title badge (top-left) -->
    <div class="absolute top-3 left-3 z-[1000]">
      {#if renamingTitle}
        <!-- svelte-ignore a11y_autofocus -->
        <input autofocus bind:value={draftTitle} onblur={commitTitleRename}
          onkeydown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitTitleRename(); }
            if (e.key === "Escape") renamingTitle = false;
          }}
          class="bg-surface/90 border border-border rounded-xl px-4 py-2 font-display text-sm font-semibold text-foreground outline-none focus:border-accent shadow-sm"
        />
      {:else}
        <button onclick={startTitleRename} title="Click to rename"
          class="flex items-center gap-2 bg-surface/90 border border-border/60 rounded-xl px-4 py-2
                 hover:border-accent transition-colors cursor-pointer backdrop-blur-sm shadow-sm">
          <span class="h-px w-4 bg-foreground-faint/30 shrink-0"></span>
          <span class="font-display text-sm font-semibold text-foreground tracking-wide whitespace-nowrap">{mapData.title}</span>
          <span class="h-px w-4 bg-foreground-faint/30 shrink-0"></span>
        </button>
      {/if}
    </div>

    <!-- Place Pin button (bottom-center) — only shown when image loaded -->
    {#if imageDataUrl}
      <div class="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center gap-1.5">
        <button onclick={() => { placingPin = !placingPin; }}
          class="flex items-center gap-2 px-4 py-2 rounded-xl font-sans text-sm font-semibold
                 backdrop-blur-sm border transition-colors cursor-pointer
                 {placingPin
            ? 'btn-accent border-accent shadow-lg shadow-accent/20'
            : pins.length === 0
              ? 'bg-surface/90 text-foreground border-border hover:border-accent shadow-sm pin-pulse'
              : 'bg-surface/90 text-foreground border-border hover:border-accent shadow-sm'}">
          <MapPin class="w-4 h-4" />
          {placingPin ? "Click map to place…" : "Place Pin"}
        </button>
        <span class="font-sans text-xs text-foreground-faint/80 backdrop-blur-sm {placingPin ? '' : 'invisible'}">
          Esc to cancel
        </span>
      </div>

      <!-- Zoom controls (bottom-right) -->
      <div class="absolute bottom-4 right-4 z-[1000]">
        <div class="flex flex-col bg-surface/90 backdrop-blur-sm border border-border rounded-xl overflow-hidden shadow-sm">
          <button onclick={() => leafletMapRef?.zoomIn()}
            aria-label="Zoom in"
            class="w-8 h-8 flex items-center justify-center text-foreground font-semibold text-base
                   hover:bg-accent-subtle hover:text-accent transition-colors cursor-pointer border-b border-border">+</button>
          <button onclick={() => leafletMapRef?.zoomOut()}
            aria-label="Zoom out"
            class="w-8 h-8 flex items-center justify-center text-foreground font-semibold text-base
                   hover:bg-accent-subtle hover:text-accent transition-colors cursor-pointer">−</button>
        </div>
      </div>
    {/if}

    <!-- Place Pin quick-create popover -->
    {#if showPlacePinPopover}
      <div class="absolute bottom-20 left-1/2 -translate-x-1/2 z-[1001]
                  bg-surface border border-border rounded-2xl p-5 shadow-xl flex flex-col gap-3 w-64">
        <p class="font-sans text-xs text-foreground-muted uppercase tracking-wider">New pin</p>
        <!-- svelte-ignore a11y_autofocus -->
        <input autofocus bind:value={newPinTitle} placeholder="Location name…"
          onkeydown={(e) => {
            if (e.key === "Enter") confirmPlacePin();
            if (e.key === "Escape") { showPlacePinPopover = false; pendingPlacement = null; }
          }}
          class="bg-canvas border border-border rounded-lg px-3 py-1.5 font-sans text-sm text-foreground outline-none focus:border-accent"
        />
        <CategorySelect {categories} value={newPinCategoryId} onchange={(val) => { newPinCategoryId = val; }} />
        <div class="flex gap-2 justify-end">
          <button onclick={() => { showPlacePinPopover = false; pendingPlacement = null; }}
            class="px-3 py-1.5 font-sans text-xs text-foreground-muted hover:text-foreground cursor-pointer">Cancel</button>
          <button onclick={confirmPlacePin} disabled={!newPinTitle.trim() || isCreatingPin}
            class="px-3 py-1.5 btn-accent rounded-lg font-sans text-xs font-semibold
                   disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
            {isCreatingPin ? "Placing…" : "Place"}
          </button>
        </div>
      </div>
    {/if}

    <!-- Pin detail panel -->
    {#if selectedPin}
      <div class="absolute top-4 right-4 bottom-4 z-[1000] w-80 bg-surface rounded-2xl shadow-2xl border border-border
                  flex flex-col overflow-hidden" style="animation: slideInRight 0.25s cubic-bezier(0.22,1,0.36,1);">
        <PinDetailPanel
          pin={selectedPin}
          cat={selectedPinCat}
          {categories}
          {linkedNote}
          onUpdate={handlePinUpdate}
          onDelete={handlePinDelete}
          onClose={() => { selectedPin = null; }}
          onCategoryUpdated={handleCategoryUpdated}
        />
      </div>
    {/if}
  </div>
{/if}

<style>
  @keyframes slideInRight {
    from { transform: translateX(100%); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
  }

  :global(.leaflet-container.placing-pin),
  :global(.leaflet-container.placing-pin .leaflet-interactive) {
    cursor: crosshair !important;
  }

  :global(.leaflet-container) {
    background-color: var(--color-bg);
    background-image:
      linear-gradient(#3d665527 1px, transparent 1px),
      linear-gradient(90deg, #3d665527 1px, transparent 1px);
    background-size: 40px 40px;
  }
</style>
