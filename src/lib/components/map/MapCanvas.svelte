<script lang="ts">
  import { onMount } from "svelte";
  import { mount, unmount } from "svelte";
  import type { Map as VaultMap, Pin, PinCategory, MapAnnotation, AnnotationKind } from "$lib/types/vault";
  import type { Map as LeafletMap, Marker } from "leaflet";
  import {
    CURATED_ICON_COMPONENTS,
    resolvedAppearance,
    buildDivIcon,
    tooltipOffset,
  } from "./pinAppearance";

  let {
    map,
    imageDataUrl,
    pins,
    categories,
    annotations = [],
    selectedPinId = null,
    selectedAnnotationId = null,
    unlockedPinId = null,
    unlockedAnnotationId = null,
    placingMode = false,
    annotationMode = null,
    onpinplace,
    onpinclick,
    onpinmove,
    onmapclick,
    onready,
    onannotationplace,
    onannotationmove,
    onannotationclick,
  }: {
    map: VaultMap;
    imageDataUrl: string;
    pins: Pin[];
    categories: PinCategory[];
    annotations?: MapAnnotation[];
    selectedPinId?: number | null;
    selectedAnnotationId?: number | null;
    unlockedPinId?: number | null;
    unlockedAnnotationId?: number | null;
    placingMode?: boolean;
    annotationMode?: AnnotationKind | null;
    onpinplace: (x: number, y: number) => void;
    onpinclick: (pin: Pin) => void;
    onpinmove: (pin: Pin, x: number, y: number) => void;
    onmapclick: () => void;
    onready?: (map: import("leaflet").Map) => void;
    onannotationplace?: (data: {
      kind: string;
      x: number;
      y: number;
      x2?: number;
      y2?: number;
      radius?: number;
      label?: string;
    }) => void;
    onannotationmove?: (id: number, updates: {
      x: number;
      y: number;
      x2?: number;
      y2?: number;
      radius?: number;
    }) => void;
    onannotationclick?: (annotation: MapAnnotation) => void;
  } = $props();

  let mapEl: HTMLDivElement | undefined = $state();
  let L: typeof import("leaflet") | null = $state(null);
  let leafletMap: LeafletMap | null = $state(null);
  let markerMap = new Map<number, Marker>();
  let iconHtmlCache: Map<string, string> | null = null;

  // Annotation layer types
  type TextLayer = { kind: 'text'; marker: import("leaflet").Marker };
  type RectLayer = { kind: 'rect'; shape: import("leaflet").Rectangle };
  type CircleLayer = { kind: 'circle'; shape: import("leaflet").Circle };
  type AnnotationLayer = TextLayer | RectLayer | CircleLayer;
  let annotationLayerMap = new Map<number, AnnotationLayer>();

  // Mirrored local copies of props for use inside Leaflet event closures
  let _placingMode = false;
  let _annotationMode: AnnotationKind | null = null;

  $effect(() => { _placingMode = placingMode ?? false; });
  $effect(() => { _annotationMode = annotationMode ?? null; });

  let _unlockedAnnotationId: number | null = null;
  $effect(() => { _unlockedAnnotationId = unlockedAnnotationId ?? null; });

  // Set to true when a shape or text annotation click fires, so the map's click
  // handler doesn't also run (Leaflet SVG uses <g>-level event delegation, so
  // e.originalEvent.stopPropagation() alone isn't always sufficient).
  let _suppressNextMapClick = false;

  // Drawing state for rect/circle (not reactive — lives inside Leaflet closures)
  type DrawingState = {
    kind: 'rect' | 'circle';
    startLat: number;
    startLng: number;
    previewLayer: import("leaflet").Rectangle | import("leaflet").Circle | null;
  };
  let drawingState: DrawingState | null = null;

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

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

  function textLabelHtml(ann: MapAnnotation): string {
    const isSelected = ann.id === selectedAnnotationId;
    const style = [
      `color:${ann.color}`,
      `font-size:${ann.font_size}px`,
      `font-family:var(--font-sans)`,
      `white-space:nowrap`,
      `cursor:pointer`,
      `padding:2px 6px`,
      `border-radius:4px`,
      `text-shadow:0 1px 4px rgba(0,0,0,0.9),0 0 8px rgba(0,0,0,0.6)`,
      `font-weight:600`,
      isSelected ? `outline:2px dashed ${ann.color};outline-offset:2px` : '',
    ].filter(Boolean).join(';');
    return `<div style="${style}">${escapeHtml(ann.label ?? '')}</div>`;
  }

  function shapeStyle(ann: MapAnnotation, selected: boolean): import("leaflet").PathOptions {
    return {
      color: ann.stroke_color,
      fillColor: ann.color,
      fillOpacity: ann.opacity,
      weight: selected ? ann.stroke_width + 1 : ann.stroke_width,
      dashArray: selected ? '6 4' : undefined,
      opacity: 1,
    };
  }

  function addShapeDrag(
    shape: import("leaflet").Rectangle | import("leaflet").Circle,
    annId: number,
    annKind: 'rect' | 'circle',
  ) {
    let startLatlng: import("leaflet").LatLng | null = null;
    let hasMoved = false;

    shape.on('mousedown', (e: import("leaflet").LeafletMouseEvent) => {
      if (_annotationMode) return;
      if (_unlockedAnnotationId !== annId) return;
      e.originalEvent.stopPropagation();
      startLatlng = e.latlng;
      hasMoved = false;
      leafletMap!.dragging.disable();
      leafletMap!.on('mousemove', onMove as import("leaflet").LeafletEventHandlerFn);
      leafletMap!.on('mouseup', onUp as import("leaflet").LeafletEventHandlerFn);
    });

    function onMove(e: import("leaflet").LeafletMouseEvent) {
      if (!startLatlng) return;
      const dlat = e.latlng.lat - startLatlng.lat;
      const dlng = e.latlng.lng - startLatlng.lng;

      if (annKind === 'rect') {
        const rect = shape as import("leaflet").Rectangle;
        const b = rect.getBounds();
        rect.setBounds([
          [b.getSouthWest().lat + dlat, b.getSouthWest().lng + dlng],
          [b.getNorthEast().lat + dlat, b.getNorthEast().lng + dlng],
        ]);
      } else {
        const circle = shape as import("leaflet").Circle;
        const c = circle.getLatLng();
        circle.setLatLng([c.lat + dlat, c.lng + dlng]);
      }
      startLatlng = e.latlng;
      hasMoved = true;
    }

    function onUp(_e: import("leaflet").LeafletMouseEvent) {
      const moved = hasMoved;
      hasMoved = false;
      leafletMap!.dragging.enable();
      leafletMap!.off('mousemove', onMove as import("leaflet").LeafletEventHandlerFn);
      leafletMap!.off('mouseup', onUp as import("leaflet").LeafletEventHandlerFn);
      startLatlng = null;

      if (!moved) return; // plain click — let the shape's click event handle it

      if (annKind === 'rect') {
        const rect = shape as import("leaflet").Rectangle;
        const b = rect.getBounds();
        onannotationmove?.(annId, {
          x: b.getSouthWest().lng / map.image_width!,
          y: b.getSouthWest().lat / map.image_height!,
          x2: b.getNorthEast().lng / map.image_width!,
          y2: b.getNorthEast().lat / map.image_height!,
        });
      } else {
        const circle = shape as import("leaflet").Circle;
        const c = circle.getLatLng();
        onannotationmove?.(annId, {
          x: c.lng / map.image_width!,
          y: c.lat / map.image_height!,
          radius: circle.getRadius() / map.image_width!,
        });
      }
    }
  }

  function createAnnotationLayer(ann: MapAnnotation): AnnotationLayer {
    const lm = leafletMap!;

    if (ann.kind === 'text') {
      const icon = L!.divIcon({
        html: textLabelHtml(ann),
        className: '',
        iconSize: undefined,
        iconAnchor: [0, ann.font_size / 2 + 2],
      });
      const marker = L!.marker(
        [ann.y * map.image_height!, ann.x * map.image_width!],
        { icon, draggable: _unlockedAnnotationId === ann.id, zIndexOffset: 500 },
      );
      marker.addTo(lm);
      marker.on('click', (e: import("leaflet").LeafletMouseEvent) => {
        e.originalEvent.stopPropagation();
        _suppressNextMapClick = true;
        onannotationclick?.(ann);
      });
      marker.on('dragend', () => {
        const latlng = marker.getLatLng();
        onannotationmove?.(ann.id, {
          x: latlng.lng / map.image_width!,
          y: latlng.lat / map.image_height!,
        });
      });
      return { kind: 'text', marker };
    }

    if (ann.kind === 'rect') {
      const shape = L!.rectangle(
        [
          [ann.y * map.image_height!, ann.x * map.image_width!],
          [ann.y2! * map.image_height!, ann.x2! * map.image_width!],
        ],
        shapeStyle(ann, ann.id === selectedAnnotationId),
      );
      shape.addTo(lm);
      shape.on('click', (e: import("leaflet").LeafletMouseEvent) => {
        e.originalEvent.stopPropagation();
        _suppressNextMapClick = true;
        onannotationclick?.(ann);
      });
      addShapeDrag(shape, ann.id, 'rect');
      return { kind: 'rect', shape };
    }

    // circle
    const shape = L!.circle(
      [ann.y * map.image_height!, ann.x * map.image_width!],
      { ...shapeStyle(ann, ann.id === selectedAnnotationId), radius: ann.radius! * map.image_width! },
    );
    shape.addTo(lm);
    shape.on('click', (e: import("leaflet").LeafletMouseEvent) => {
      e.originalEvent.stopPropagation();
      _suppressNextMapClick = true;
      onannotationclick?.(ann);
    });
    addShapeDrag(shape, ann.id, 'circle');
    return { kind: 'circle', shape };
  }

  onMount(() => {
    let cancelled = false;
    let mapInstance: LeafletMap | null = null;

    (async () => {
      const leaflet = await import("leaflet");
      if (cancelled) return;
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
        zoomControl: false,
      });

      leaflet.imageOverlay(imageDataUrl, bounds).addTo(mapInstance);
      mapInstance.fitBounds(bounds);

      // ── Drawing (rect / circle) ─────────────────────────────────────────────
      mapInstance.on('mousedown', (e: import("leaflet").LeafletMouseEvent) => {
        if (_annotationMode !== 'rect' && _annotationMode !== 'circle') return;
        e.originalEvent.preventDefault();
        mapInstance!.dragging.disable();
        drawingState = {
          kind: _annotationMode,
          startLat: e.latlng.lat,
          startLng: e.latlng.lng,
          previewLayer: null,
        };
      });

      mapInstance.on('mousemove', (e: import("leaflet").LeafletMouseEvent) => {
        if (!drawingState) return;

        if (drawingState.kind === 'rect') {
          const bds: [[number, number], [number, number]] = [
            [drawingState.startLat, drawingState.startLng],
            [e.latlng.lat, e.latlng.lng],
          ];
          if (drawingState.previewLayer) {
            (drawingState.previewLayer as import("leaflet").Rectangle).setBounds(bds);
          } else {
            drawingState.previewLayer = leaflet.rectangle(bds, {
              color: '#94a3b8',
              fillColor: '#e2e8f0',
              fillOpacity: 0.15,
              weight: 2,
              dashArray: '6 4',
            }).addTo(mapInstance!);
          }
        } else {
          const dlat = e.latlng.lat - drawingState.startLat;
          const dlng = e.latlng.lng - drawingState.startLng;
          const radius = Math.sqrt(dlat * dlat + dlng * dlng);
          const center: [number, number] = [drawingState.startLat, drawingState.startLng];
          if (drawingState.previewLayer) {
            const c = drawingState.previewLayer as import("leaflet").Circle;
            c.setLatLng(center);
            c.setRadius(radius);
          } else {
            drawingState.previewLayer = leaflet.circle(center, {
              radius,
              color: '#94a3b8',
              fillColor: '#e2e8f0',
              fillOpacity: 0.15,
              weight: 2,
              dashArray: '6 4',
            }).addTo(mapInstance!);
          }
        }
      });

      mapInstance.on('mouseup', (e: import("leaflet").LeafletMouseEvent) => {
        if (!drawingState) return;
        mapInstance!.dragging.enable();
        drawingState.previewLayer?.remove();

        const ds = drawingState;
        drawingState = null;

        if (ds.kind === 'rect') {
          const lat1 = Math.min(ds.startLat, e.latlng.lat);
          const lat2 = Math.max(ds.startLat, e.latlng.lat);
          const lng1 = Math.min(ds.startLng, e.latlng.lng);
          const lng2 = Math.max(ds.startLng, e.latlng.lng);
          if (Math.abs(lat2 - lat1) > 5 && Math.abs(lng2 - lng1) > 5) {
            onannotationplace?.({
              kind: 'rect',
              x: lng1 / map.image_width!,
              y: lat1 / map.image_height!,
              x2: lng2 / map.image_width!,
              y2: lat2 / map.image_height!,
            });
          }
        } else {
          const dlat = e.latlng.lat - ds.startLat;
          const dlng = e.latlng.lng - ds.startLng;
          const radius = Math.sqrt(dlat * dlat + dlng * dlng);
          if (radius > 5) {
            onannotationplace?.({
              kind: 'circle',
              x: ds.startLng / map.image_width!,
              y: ds.startLat / map.image_height!,
              radius: radius / map.image_width!,
            });
          }
        }
      });

      // ── Click (pin place / text / deselect) ─────────────────────────────────
      mapInstance.on("click", (e: import("leaflet").LeafletMouseEvent) => {
        // An annotation or pin click already ran — don't also deselect
        if (_suppressNextMapClick) { _suppressNextMapClick = false; return; }
        if (_placingMode) {
          onpinplace(
            e.latlng.lng / map.image_width!,
            e.latlng.lat / map.image_height!,
          );
        } else if (_annotationMode === 'text') {
          onannotationplace?.({
            kind: 'text',
            x: e.latlng.lng / map.image_width!,
            y: e.latlng.lat / map.image_height!,
            label: 'Label',
          });
        } else if (!_annotationMode) {
          onmapclick();
        }
        // rect/circle clicks are silently ignored — placement uses mousedown/up
      });

      L = leaflet;
      leafletMap = mapInstance;
      onready?.(mapInstance);
    })();

    return () => {
      cancelled = true;
      mapInstance?.remove();
      leafletMap = null;
      L = null;
      markerMap.clear();
      annotationLayerMap.clear();
    };
  });

  // ── Cursor sync ─────────────────────────────────────────────────────────────
  $effect(() => {
    if (!leafletMap) return;
    const el = leafletMap.getContainer();
    el.classList.toggle("placing-pin", placingMode);
    el.classList.toggle("annotation-mode-text", annotationMode === 'text');
    el.classList.toggle("annotation-mode-shape", annotationMode === 'rect' || annotationMode === 'circle');
  });

  // ── Pin marker sync ─────────────────────────────────────────────────────────
  $effect(() => {
    if (!L || !leafletMap || !iconHtmlCache) return;

    const currentIds = new Set(pins.map((p) => p.id));

    for (const [id, marker] of markerMap) {
      if (!currentIds.has(id)) {
        marker.remove();
        markerMap.delete(id);
      }
    }

    for (const pin of pins) {
      const cat = categories.find((c) => c.id === pin.category_id) ?? undefined;
      const app = resolvedAppearance(pin, cat);
      const iconHtml = iconHtmlCache.get(app.icon) ?? "";
      const icon = buildDivIcon(
        app.shape,
        app.color,
        iconHtml,
        L!,
        pin.id === selectedPinId,
      );

      const existing = markerMap.get(pin.id);
      if (existing) {
        existing.setIcon(icon);
        existing.setLatLng([
          pin.y * map.image_height!,
          pin.x * map.image_width!,
        ]);
        existing.unbindTooltip();
        existing.bindTooltip(pin.title || "Pin", {
          permanent: false,
          direction: "bottom",
          offset: tooltipOffset(app.shape),
          opacity: 1,
          className: "grimoire-tooltip",
        } as import("leaflet").TooltipOptions);
        existing.off("click");
        existing.on("click", (e: import("leaflet").LeafletMouseEvent) => {
          e.originalEvent.stopPropagation();
          onpinclick(pin);
        });
        existing.off("dragend");
        existing.on("dragend", () => {
          const latlng = existing.getLatLng();
          onpinmove(
            pin,
            latlng.lng / map.image_width!,
            latlng.lat / map.image_height!,
          );
        });
        if (pin.id === unlockedPinId) {
          existing.dragging?.enable();
        } else {
          existing.dragging?.disable();
        }
      } else {
        const marker = L!.marker(
          [pin.y * map.image_height!, pin.x * map.image_width!],
          { icon, draggable: pin.id === unlockedPinId },
        );
        marker.addTo(leafletMap!);
        marker.bindTooltip(pin.title || "Pin", {
          permanent: false,
          direction: "bottom",
          offset: tooltipOffset(app.shape),
          opacity: 1,
          className: "grimoire-tooltip",
        } as import("leaflet").TooltipOptions);
        marker.on("click", (e: import("leaflet").LeafletMouseEvent) => {
          e.originalEvent.stopPropagation();
          onpinclick(pin);
        });
        marker.on("dragend", () => {
          const latlng = marker.getLatLng();
          onpinmove(
            pin,
            latlng.lng / map.image_width!,
            latlng.lat / map.image_height!,
          );
        });
        markerMap.set(pin.id, marker);
      }
    }
  });

  // ── Annotation layer sync ───────────────────────────────────────────────────
  $effect(() => {
    if (!L || !leafletMap) return;

    const currentIds = new Set(annotations.map((a) => a.id));

    // Remove stale layers
    for (const [id, layer] of annotationLayerMap) {
      if (!currentIds.has(id)) {
        if (layer.kind === 'text') layer.marker.remove();
        else layer.shape.remove();
        annotationLayerMap.delete(id);
      }
    }

    // Add or update
    for (const ann of annotations) {
      const existing = annotationLayerMap.get(ann.id);
      const isSelected = ann.id === selectedAnnotationId;

      if (existing) {
        if (existing.kind === 'text' && ann.kind === 'text') {
          existing.marker.setIcon(
            L!.divIcon({
              html: textLabelHtml(ann),
              className: '',
              iconSize: undefined,
              iconAnchor: [0, ann.font_size / 2 + 2],
            }),
          );
          existing.marker.setLatLng([ann.y * map.image_height!, ann.x * map.image_width!]);
          // Re-register click with fresh ann reference
          existing.marker.off('click');
          existing.marker.on('click', (e: import("leaflet").LeafletMouseEvent) => {
            e.originalEvent.stopPropagation();
            _suppressNextMapClick = true;
            onannotationclick?.(ann);
          });
          if (ann.id === unlockedAnnotationId) existing.marker.dragging?.enable();
          else existing.marker.dragging?.disable();
        } else if (existing.kind === 'rect' && ann.kind === 'rect') {
          existing.shape.setBounds([
            [ann.y * map.image_height!, ann.x * map.image_width!],
            [ann.y2! * map.image_height!, ann.x2! * map.image_width!],
          ]);
          existing.shape.setStyle(shapeStyle(ann, isSelected));
          existing.shape.off('click');
          existing.shape.on('click', (e: import("leaflet").LeafletMouseEvent) => {
            e.originalEvent.stopPropagation();
            _suppressNextMapClick = true;
            onannotationclick?.(ann);
          });
        } else if (existing.kind === 'circle' && ann.kind === 'circle') {
          existing.shape.setLatLng([ann.y * map.image_height!, ann.x * map.image_width!]);
          existing.shape.setRadius(ann.radius! * map.image_width!);
          existing.shape.setStyle(shapeStyle(ann, isSelected));
          existing.shape.off('click');
          existing.shape.on('click', (e: import("leaflet").LeafletMouseEvent) => {
            e.originalEvent.stopPropagation();
            _suppressNextMapClick = true;
            onannotationclick?.(ann);
          });
        } else {
          // Kind changed — remove and recreate
          if (existing.kind === 'text') existing.marker.remove();
          else existing.shape.remove();
          annotationLayerMap.set(ann.id, createAnnotationLayer(ann));
        }
      } else {
        annotationLayerMap.set(ann.id, createAnnotationLayer(ann));
      }
    }
  });
</script>

<div bind:this={mapEl} class="w-full h-full"></div>

<style>
  :global(.grimoire-tooltip) {
    background: rgba(10, 14, 20, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    color: #e2e8f0;
    font-family: var(--font-sans);
    font-size: 12px;
    padding: 4px 8px;
    white-space: nowrap;
    transition: opacity 0.15s ease;
  }
  :global(.grimoire-tooltip::before) {
    display: none;
  }
  :global(.placing-pin) {
    cursor: crosshair !important;
  }
  :global(.annotation-mode-text) {
    cursor: text !important;
  }
  :global(.annotation-mode-shape) {
    cursor: crosshair !important;
  }
</style>
