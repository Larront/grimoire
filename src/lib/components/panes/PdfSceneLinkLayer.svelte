<!-- src/lib/components/panes/PdfSceneLinkLayer.svelte
     Draws a page's Scene-links over the PDF.js text layer and makes them playable.

     Each link is three things:
       - an UNDERLINE in the scene's hue, set just below the linked text so it never
         crosses the letters, and a soft wash of that hue behind the passage while its
         scene plays;
       - a MARKER in the page's left margin, beside the line where the link starts: the
         scene's icon in its hue, or the playing bars while it sounds. It reads from
         across the table, does not rely on colour alone, and is the link's button — the
         one thing a keyboard reaches, named after the scene and the passage;
       - a BUBBLE, on hover or focus, with the rest: volume, the scene's name (opens it
         beside the PDF), change scene, remove.

     Clicking the underline or the marker plays or stops the scene — at the table, the
     passage IS the play button. A text selection that starts elsewhere passes through
     the underlines (`selecting`), so linked text can still be selected across.

     Geometry is measured from the live text-layer spans via the anchoring module
     (offset-range → per-span ranges → client rects), so it re-flows with zoom and
     re-renders. PDF.js never appears here — only the spans it produced. -->
<script lang="ts">
  import { TriangleAlert } from "@lucide/svelte";
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import {
    highlightRangesForOffsets,
    quoteMatchesAtOffsets,
    rangeWithinDiv,
  } from "$lib/pdf/scene-link-anchor";
  import { sceneIcon, sceneLinkHue } from "./thumbnail-presets";
  import { wash } from "$lib/color";
  import SceneLinkBubble from "./SceneLinkBubble.svelte";
  import NowPlayingBars from "$lib/components/NowPlayingBars.svelte";
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
    selecting = false,
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
    /** A text selection is being dragged on this page: let it pass through the links. */
    selecting?: boolean;
    onChangeScene: (linkId: number, sceneId: number) => void;
    onNewScene: (linkId: number, name: string) => void;
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
    hue: string;
    bars: Bar[];
    // The text now at this link's offset range no longer matches the stored
    // quote (e.g. a different edition was dropped at the same path). The link is
    // drawn as a warning rather than a confident underline so it never silently
    // mis-highlights unrelated text (issue #105).
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
        }
      }
      if (!bars.length) continue;
      const scene = scenesById.get(link.scene_id);
      const drifted = !quoteMatchesAtOffsets(
        itemStrings,
        link.start_offset,
        link.end_offset,
        link.quote,
      );
      out.push({
        link,
        scene,
        hue: drifted
          ? "var(--error)"
          : sceneLinkHue(scene ?? { id: link.scene_id, thumbnail_color: null }),
        bars,
        drifted,
      });
    }
    return out;
  }

  // The underline sits this far below the text's box, and is this thick, both growing
  // with zoom so it reads the same at 50% and 300%. Inside the box it ran through the
  // bottoms of the letters and read as a strikethrough at 100% and below.
  const gap = $derived(Math.max(1, Math.round(1.5 * scale)));
  const thickness = $derived(Math.max(2, Math.round(2 * scale)));

  // ── Bubble: open while the pointer is over a link or its bubble (with a short grace
  //    period to travel between them), or while focus is inside the link. ───────────
  let hoveredId = $state<number | null>(null);
  let focusedId = $state<number | null>(null);
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

  function onGroupFocusOut(e: FocusEvent, id: number) {
    const group = e.currentTarget as HTMLElement;
    if (!group.contains(e.relatedTarget as Node | null) && focusedId === id) focusedId = null;
  }

  // Playing means sounding: a paused scene draws no bars, and a click resumes it.
  function isPlaying(box: LinkBox) {
    return audioEngine.sceneState(box.link.scene_id) === "playing";
  }

  // A scene with no tracks has nothing to play, and starting it would silently stop
  // whatever the room is hearing. Clicking such a link opens its bubble instead, which
  // says so.
  function toggle(box: LinkBox) {
    if (!box.scene) return;
    if (isPlaying(box)) {
      audioEngine.stopAll();
    } else if (audioEngine.sceneState(box.scene.id) === "paused") {
      void audioEngine.resumeScene();
    } else if (box.scene.slot_count === 0) {
      enter(box.link.id);
    } else {
      void audioEngine.playScene(box.scene.id);
    }
  }

  function label(box: LinkBox): string {
    const name = box.scene?.name ?? "Scene";
    const quote = box.link.quote.length > 60 ? `${box.link.quote.slice(0, 60)}…` : box.link.quote;
    if (box.drifted) return `${name} — linked text no longer matches this PDF`;
    return `${isPlaying(box) ? "Stop" : "Play"} ${name} — “${quote}”`;
  }
</script>

<div class="pointer-events-none absolute inset-0 z-[2]">
  {#each boxes as box (box.link.id)}
    {@const playing = isPlaying(box)}
    {@const open = (hoveredId === box.link.id || focusedId === box.link.id) && box.scene}
    {@const Icon = box.scene ? sceneIcon(box.scene) : null}
    {@const first = box.bars[0]}
    <!-- Escape from anything inside the link (its marker, its bubble) closes the bubble:
         delegated here rather than repeated on each control. -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      role="group"
      aria-label={box.scene ? `Scene-link: ${box.scene.name}` : "Scene-link"}
      onfocusin={() => (focusedId = box.link.id)}
      onfocusout={(e) => onGroupFocusOut(e, box.link.id)}
      onkeydown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          hoveredId = null;
          focusedId = null;
        }
      }}
    >
      <!-- Underlines (and, while playing, the wash). Pointer targets, not tab stops:
           the marker is this link's one button. -->
      {#each box.bars as bar, bi (bi)}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div
          data-scene-link-bar
          class="absolute rounded-[2px] {selecting
            ? 'pointer-events-none'
            : 'pointer-events-auto cursor-pointer'}"
          title={box.drifted ? label(box) : undefined}
          style="left: {bar.left}px; top: {bar.top}px; width: {bar.width}px;
                 height: {bar.height + gap + thickness}px;
                 background: {playing && !box.drifted ? wash(box.hue, 0.22) : 'transparent'};"
          onmouseenter={() => enter(box.link.id)}
          onmouseleave={scheduleClear}
          onclick={() => toggle(box)}
        >
          <div
            class="absolute inset-x-0 bottom-0"
            style="border-bottom: {thickness}px {box.drifted ? 'dashed' : 'solid'} {box.hue};"
          ></div>
        </div>
      {/each}

      <!-- Margin marker: the link's button. -->
      <button
        type="button"
        data-scene-link-marker
        data-link-id={box.link.id}
        class="pointer-events-auto absolute flex size-[18px] items-center justify-center rounded-[4px]
               focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        style="left: 4px; top: {first.top + first.height / 2 - 9}px;
               background: {box.drifted ? 'var(--error)' : wash(box.hue, playing ? 0.3 : 0.2)};"
        aria-label={label(box)}
        aria-pressed={playing}
        onmouseenter={() => enter(box.link.id)}
        onmouseleave={scheduleClear}
        onclick={() => toggle(box)}
      >
        {#if box.drifted}
          <TriangleAlert class="size-3 text-white" strokeWidth={2} />
        {:else if playing}
          <NowPlayingBars class="h-2.5" />
        {:else if Icon}
          <Icon class="size-3" style="color: {box.hue}" strokeWidth={2} />
        {/if}
      </button>

      {#if open && box.scene}
        <div
          class="pointer-events-auto absolute z-10"
          style="left: {first.left}px; top: {first.top}px;"
          onmouseenter={() => enter(box.link.id)}
          onmouseleave={scheduleClear}
          role="group"
        >
          <div class="absolute bottom-1 left-0">
            <SceneLinkBubble
              scene={box.scene}
              drifted={box.drifted}
              onChangeScene={(sceneId) => onChangeScene(box.link.id, sceneId)}
              onNewScene={(name) => onNewScene(box.link.id, name)}
              onRemove={() => onRemove(box.link.id)}
            />
          </div>
        </div>
      {/if}
    </div>
  {/each}
</div>
