<script lang="ts">
  import { onMount } from "svelte";
  import { mount, unmount } from "svelte";
  import type { Map as VaultMap, Pin, PinCategory } from "$lib/types/vault";
  import {
    buildDivIcon,
    resolvedAppearance,
    CURATED_ICON_COMPONENTS,
  } from "./pinAppearance";
  import type { Map as LeafletMap, Marker } from "leaflet";

  let {
    map,
    imageDataUrl,
    pins,
    categories,
    selectedPinId = null,
    placingMode = false,
    onpinplace,
    onpinclick,
    onpinmove,
    onmapclick,
    onready,
  }: {
    map: VaultMap;
    imageDataUrl: string;
    pins: Pin[];
    categories: PinCategory[];
    selectedPinId: number | null;
    placingMode?: boolean;
    onpinplace: (x: number, y: number) => void;
    onpinclick: (pin: Pin) => void;
    onpinmove: (pin: Pin, x: number, y: number) => void;
    onmapclick: () => void;
    onready?: (map: import("leaflet").Map) => void;
  } = $props();

  let mapEl: HTMLDivElement | undefined = $state();
  let L: typeof import("leaflet") | null = $state(null);
  let leafletMap: LeafletMap | null = $state(null);
  let markerMap = new Map<number, Marker>();
  let iconHtmlCache: Map<string, string> | null = null;

  function buildIconHtmlCache(): Map<string, string> {
    const cache = new Map<string, string>();
    for (const [key, Component] of CURATED_ICON_COMPONENTS) {
      const target = document.createElement("div");
      const instance = mount(Component, {
        target,
        props: { size: 20, strokeWidth: 2, color: "white" },
      });
      cache.set(key, target.innerHTML);
      unmount(instance);
    }
    return cache;
  }

  onMount(() => {
    let mapInstance: LeafletMap | null = null;

    (async () => {
      const leaflet = await import("leaflet");
      iconHtmlCache = buildIconHtmlCache();

      const bounds: [[number, number], [number, number]] = [
        [0, 0],
        [map.image_height!, map.image_width!],
      ];

      mapInstance = leaflet.map(mapEl!, {
        crs: leaflet.CRS.Simple,
        zoomSnap: 0.25,
        minZoom: -3,
        maxBoundsViscosity: 1.0,
      });

      leaflet.imageOverlay(imageDataUrl, bounds).addTo(mapInstance);
      mapInstance.fitBounds(bounds);

      mapInstance.on("click", (e: import("leaflet").LeafletMouseEvent) => {
        if (placingMode) {
          onpinplace(e.latlng.lng / map.image_width!, e.latlng.lat / map.image_height!);
        } else {
          onmapclick();
        }
      });

      L = leaflet;
      leafletMap = mapInstance;
      onready?.(mapInstance);
    })();

    return () => {
      mapInstance?.remove();
      leafletMap = null;
      L = null;
      markerMap.clear();
    };
  });

  // Sync placing-pin cursor class
  $effect(() => {
    if (!leafletMap) return;
    leafletMap.getContainer().classList.toggle("placing-pin", placingMode);
  });

  // Sync pin markers reactively
  $effect(() => {
    if (!L || !leafletMap || !iconHtmlCache) return;

    const currentIds = new Set(pins.map((p) => p.id));

    // Remove stale markers
    for (const [id, marker] of markerMap) {
      if (!currentIds.has(id)) {
        marker.remove();
        markerMap.delete(id);
      }
    }

    // Add or update markers
    for (const pin of pins) {
      const cat = categories.find((c) => c.id === pin.category_id) ?? undefined;
      const app = resolvedAppearance(pin, cat);
      const iconHtml = iconHtmlCache.get(app.icon) ?? "";
      const icon = buildDivIcon(app.shape, app.color, iconHtml, L!);

      const existing = markerMap.get(pin.id);
      if (existing) {
        existing.setIcon(icon);
        existing.setLatLng([pin.y * map.image_height!, pin.x * map.image_width!]);
        existing.off("click");
        existing.on("click", (e: import("leaflet").LeafletMouseEvent) => {
          e.originalEvent.stopPropagation();
          onpinclick(pin);
        });
        existing.off("dragend");
        existing.on("dragend", () => {
          const latlng = existing.getLatLng();
          onpinmove(pin, latlng.lng / map.image_width!, latlng.lat / map.image_height!);
        });
      } else {
        const marker = L!.marker([pin.y * map.image_height!, pin.x * map.image_width!], { icon, draggable: true });
        marker.addTo(leafletMap!);
        marker.bindTooltip(
          `<span style="font-family:var(--font-sans);font-size:12px">${pin.title}</span>`,
          { permanent: false, direction: "top", offset: [0, -10], opacity: 0.95 } as import("leaflet").TooltipOptions
        );
        marker.on("click", (e: import("leaflet").LeafletMouseEvent) => {
          e.originalEvent.stopPropagation();
          onpinclick(pin);
        });
        marker.on("dragend", () => {
          const latlng = marker.getLatLng();
          onpinmove(pin, latlng.lng / map.image_width!, latlng.lat / map.image_height!);
        });
        markerMap.set(pin.id, marker);
      }
    }
  });
</script>

<div bind:this={mapEl} class="w-full h-full"></div>
