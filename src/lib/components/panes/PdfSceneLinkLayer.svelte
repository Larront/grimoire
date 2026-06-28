<!-- src/lib/components/panes/PdfSceneLinkLayer.svelte
     Draws a page's Scene-links over the PDF.js text layer: a scene-accent-tinted
     underline per linked text range (text stays readable — underline, not a
     background highlight), a trailing scene-icon chip, an active state while the
     Scene plays, and a hover bubble exposing the full toolbar (Play/Stop, master
     volume, change-Scene, Remove).

     Geometry is measured from the live text-layer spans via the anchoring module
     (offset-range → per-span ranges → client rects), so it re-flows with zoom and
     re-renders. PDF.js never appears here — only the spans it produced. -->
<script lang="ts">
  import { Music2, TriangleAlert } from "@lucide/svelte";
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import {
    highlightRangesForOffsets,
    quoteMatchesAtOffsets,
    rangeWithinDiv,
  } from "$lib/pdf/scene-link-anchor";
  import { ICON_MAP, ACCENT_BG, ACCENT_FG } from "./thumbnail-presets";
  import SceneLinkBubble from "./SceneLinkBubble.svelte";
  import type { PdfSceneLink } from "$lib/bindings.gen";
  import type { SceneWithCount } from "$lib/types/ledger";

  let {
    links,
    scenesList,
    textDivs,
    itemStrings,
    wrapperEl,
    scale,
    textReady,
    onChangeScene,
    onNewScene,
    onRemove,
  }: {
    links: PdfSceneLink[];
    scenesList: SceneWithCount[];
    textDivs: HTMLElement[];
    itemStrings: string[];
    wrapperEl: HTMLElement | undefined;
    scale: number;
    textReady: number;
    onChangeScene: (linkId: number, sceneId: number) => void;
    onNewScene: (linkId: number) => void;
    onRemove: (linkId: number) => void;
  } = $props();

  interface Bar {
    left: number;
    top: number;
    width: number;
    height: number;
  }
  interface LinkBox {
    link: PdfSceneLink;
    scene: SceneWithCount | undefined;
    accent: string;
    chipBg: string;
    bars: Bar[];
    icon: { left: number; top: number; size: number } | null;
    // The text now at this link's offset range no longer matches the stored
    // quote (e.g. a different edition was dropped at the same path). The link is
    // drawn as a muted warning rather than a confident underline so it never
    // silently mis-highlights unrelated text (issue #105).
    drifted: boolean;
  }

  const scenesById = $derived(new Map(scenesList.map((s) => [s.id, s])));

  let boxes = $state<LinkBox[]>([]);

  // Re-measure whenever the text layer (re)renders, the zoom changes, or the link
  // set changes. getClientRects reads live layout, so this must run post-render.
  $effect(() => {
    void textReady;
    void scale;
    boxes = measure(links, textDivs, itemStrings, wrapperEl);
  });

  function measure(
    links: PdfSceneLink[],
    textDivs: HTMLElement[],
    itemStrings: string[],
    wrapperEl: HTMLElement | undefined,
  ): LinkBox[] {
    if (!wrapperEl || !textDivs.length) return [];
    const wrap = wrapperEl.getBoundingClientRect();
    const out: LinkBox[] = [];
    for (const link of links) {
      const ranges = highlightRangesForOffsets(itemStrings, link.start_offset, link.end_offset);
      const bars: Bar[] = [];
      let lastRight = 0;
      let lastTop = 0;
      let lastHeight = 0;
      for (const r of ranges) {
        const div = textDivs[r.itemIndex];
        if (!div) continue;
        const domRange = rangeWithinDiv(div, r.from, r.to);
        if (!domRange) continue;
        for (const rect of domRange.getClientRects()) {
          if (rect.width === 0 && rect.height === 0) continue;
          bars.push({
            left: rect.left - wrap.left,
            top: rect.top - wrap.top,
            width: rect.width,
            height: rect.height,
          });
          lastRight = rect.right - wrap.left;
          lastTop = rect.top - wrap.top;
          lastHeight = rect.height;
        }
      }
      if (!bars.length) continue;
      const scene = scenesById.get(link.scene_id);
      const size = Math.max(10, Math.min(16, lastHeight * 0.8));
      const drifted = !quoteMatchesAtOffsets(
        itemStrings,
        link.start_offset,
        link.end_offset,
        link.quote,
      );
      out.push({
        link,
        scene,
        accent: drifted ? "var(--error)" : ACCENT_FG[link.scene_id % ACCENT_FG.length],
        chipBg: drifted ? "var(--error)" : (scene?.thumbnail_color ?? ACCENT_BG[link.scene_id % ACCENT_BG.length]),
        bars,
        icon: { left: lastRight + 2, top: lastTop + (lastHeight - size) / 2, size },
        drifted,
      });
    }
    return out;
  }

  function chipIcon(scene: SceneWithCount | undefined) {
    return scene?.thumbnail_icon ? (ICON_MAP[scene.thumbnail_icon] ?? Music2) : Music2;
  }

  // ── Hover bubble (hover-card pattern: a short grace period lets the pointer
  //    travel from the underline to the bubble without it closing). ───────────
  let hoveredId = $state<number | null>(null);
  let clearTimer: ReturnType<typeof setTimeout> | null = null;
  function enter(id: number) {
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    hoveredId = id;
  }
  function scheduleClear() {
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      hoveredId = null;
      clearTimer = null;
    }, 120);
  }
</script>

<div class="pointer-events-none absolute inset-0 z-[2]" aria-hidden="false">
  {#each boxes as box (box.link.id)}
    {@const active = audioEngine.isScenePlaying(box.link.scene_id)}
    {@const ChipIcon = box.drifted ? TriangleAlert : chipIcon(box.scene)}
    {@const driftLabel = box.scene
      ? `Linked text no longer matches this PDF — ${box.scene.name}`
      : "Linked text no longer matches this PDF"}
    <div
      role="group"
      aria-label={box.drifted
        ? driftLabel
        : box.scene
          ? `Scene-link: ${box.scene.name}`
          : "Scene-link"}
      onmouseenter={() => enter(box.link.id)}
      onmouseleave={scheduleClear}
    >
      {#each box.bars as bar, bi (bi)}
        <div
          class="pointer-events-auto absolute cursor-pointer"
          title={box.drifted ? driftLabel : null}
          style="left: {bar.left}px; top: {bar.top}px; width: {bar.width}px; height: {bar.height}px;
                 border-bottom: {active ? 3 : 2}px {box.drifted ? 'dashed' : 'solid'} {box.accent};
                 opacity: {box.drifted ? 0.9 : active ? 1 : 0.8};"
        ></div>
      {/each}

      {#if box.icon}
        <span
          class="pointer-events-auto absolute flex cursor-pointer items-center justify-center rounded-[3px]"
          title={box.drifted ? driftLabel : null}
          style="left: {box.icon.left}px; top: {box.icon.top}px; width: {box.icon.size}px;
                 height: {box.icon.size}px; background-color: {box.chipBg};"
        >
          <ChipIcon
            style="color: {box.drifted ? 'var(--primary-foreground)' : box.accent}; width: 70%; height: 70%;"
            strokeWidth={2}
          />
        </span>
      {/if}

      {#if hoveredId === box.link.id && box.scene}
        <div
          class="pointer-events-auto absolute z-10"
          style="left: {box.bars[0].left}px; top: {box.bars[0].top}px;"
          onmouseenter={() => enter(box.link.id)}
          onmouseleave={scheduleClear}
          role="group"
        >
          <div class="absolute bottom-1 left-0">
            <SceneLinkBubble
              scene={box.scene}
              onChangeScene={(sceneId) => onChangeScene(box.link.id, sceneId)}
              onNewScene={() => onNewScene(box.link.id)}
              onRemove={() => onRemove(box.link.id)}
            />
          </div>
        </div>
      {/if}
    </div>
  {/each}
</div>
