<!--
  Test stub for MapCanvas. The real component mounts Leaflet, which jsdom can't
  run. This stand-in renders a button per pin/annotation that fires the same
  selection callbacks MapPane wires up, and reflects the current selection via
  data attributes — enough to exercise MapPane's selection → panel → persist
  wiring without a map canvas.
-->
<script lang="ts">
  import type { Pin, MapAnnotation } from "$lib/types/ledger";

  interface Props {
    pins?: Pin[];
    annotations?: MapAnnotation[];
    selectedPinId?: number | null;
    selectedAnnotationId?: number | null;
    onpinclick?: (pin: Pin) => void;
    onannotationclick?: (ann: MapAnnotation) => void;
    onmapclick?: () => void;
    [key: string]: unknown;
  }

  let {
    pins = [],
    annotations = [],
    selectedPinId = null,
    selectedAnnotationId = null,
    onpinclick,
    onannotationclick,
    onmapclick,
  }: Props = $props();
</script>

<div
  data-testid="map-canvas-stub"
  data-selected-pin={selectedPinId ?? ""}
  data-selected-annotation={selectedAnnotationId ?? ""}
>
  {#each pins as pin (pin.id)}
    <button type="button" data-testid={`stub-pin-${pin.id}`} onclick={() => onpinclick?.(pin)}>
      {pin.title}
    </button>
  {/each}
  {#each annotations as ann (ann.id)}
    <button type="button" data-testid={`stub-ann-${ann.id}`} onclick={() => onannotationclick?.(ann)}>
      {ann.kind}
    </button>
  {/each}
  <button type="button" data-testid="stub-mapclick" onclick={() => onmapclick?.()}>map</button>
</div>
