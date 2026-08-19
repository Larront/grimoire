<script lang="ts">
  // The grip in the gutter — the visible half of the block handle (#190).
  //
  // Editor chrome, a sibling of the prose like the slash menu, which is how this stays
  // clear of ADR-0016 §8: it is not a shared shell inside blocks, and it draws nothing
  // inside one. One grip exists at a time and moves to whatever the pointer is over, so
  // the note's DOM is untouched by hovering it — no per-block element, nothing for a
  // sealed block's `stopEvent` to swallow.
  //
  // It is drawn `fixed` and placed from measurements, for the reason the two anchored
  // menus are: the block it belongs to is inside a scroll container the grip is not in,
  // and an absolutely positioned element would need an offset parent that agrees with it.
  //
  // What is left here after #211 is the seeing and the pointing: a box to measure, a
  // position to draw at, a fade, and the events a GM produces. Which block the handle is
  // on, what keeps it up, whether its menu is open and what order a gesture's steps go in
  // are all one thing — `handle` — and this reports gestures to it rather than performing
  // its sequences.
  import { tick } from "svelte";
  import { cubicOut } from "svelte/easing";
  import { MediaQuery } from "svelte/reactivity";
  import { GripVertical } from "@lucide/svelte";
  import type { Editor } from "@tiptap/core";
  import {
    blockElementAt,
    blockLabel,
    placeHandle,
    selectBlock,
    startBlockDrag,
    type BlockTarget,
  } from "$lib/editor/block-handle";
  import type { BlockHandleLife } from "$lib/editor/block-handle-life.svelte";
  import BlockHandleMenu from "./BlockHandleMenu.svelte";

  interface Props {
    editor: Editor;
    /**
     * The block this grip is drawn beside.
     *
     * A prop and not `handle.target`, though the handle is where it comes from: the grip
     * fades out, and it fades out *because* the target went. Reading it live would leave
     * the outro with nothing to draw; a prop keeps its last value for the length of the
     * fade, which is what an element on its way out should be showing.
     */
    target: BlockTarget;
    /** The handle's life: what it is on, what holds it up, and what a gesture does. */
    handle: BlockHandleLife;
  }

  let { editor, target, handle }: Props = $props();

  let el = $state<HTMLButtonElement>();
  let left = $state(0);
  let top = $state(0);
  // Until the first measurement the grip has no position, and drawing it at 0,0 would
  // flash it in the window's corner on the first hover of every note.
  let placed = $state(false);

  const label = $derived(blockLabel(target.node));

  /** The grip's own box, which is what the menu is anchored off. */
  function anchor() {
    const box = el!.getBoundingClientRect();
    // Below the grip where there is room, above it where there is not.
    return { x: box.left, y: box.bottom + 4, anchorTop: box.top - 4 };
  }

  function openMenu() {
    if (!el) return;
    handle.openMenu(anchor());
  }

  /** Dismissed without choosing: the grip takes its focus back, and stays up under it. */
  function dismissMenu() {
    handle.closeMenu();
    el?.focus();
  }

  // Re-placed whenever the target changes — every pointer move that lands on a different
  // block, and every keyboard move. `place` reads `target`, so the effect tracks it.
  $effect(() => {
    place();
  });

  // Focus, once, when the handle was raised by keyboard. A hovered grip must NOT do this:
  // taking focus out of the prose because a pointer crossed a paragraph would move the
  // GM's caret out of the sentence they are typing.
  $effect(() => {
    if (handle.grabbed && el) {
      el.focus();
      handle.grabHandled();
    }
  });

  function place() {
    if (!el) return;
    const placement = placeHandle(editor.view, target, el);
    if (!placement) {
      placed = false;
      return;
    }
    left = placement.left;
    top = placement.top;
    placed = true;
  }

  function handleDragStart(event: DragEvent) {
    // The block's own element as the drag image: without it the GM drags an 18px icon
    // and sees no ghost of the thing they are moving.
    const ghost = blockElementAt(editor.view, target.pos) ?? undefined;
    if (!startBlockDrag(editor, target, event.dataTransfer, ghost)) {
      event.preventDefault();
    }
  }

  /**
   * One place per press, with the moved block staying the handle's target so a GM can
   * walk a creature up an initiative order without re-finding the grip. Focus stays on
   * the button — it is outside the editor's DOM, so the document rewriting under it does
   * not take it away.
   */
  async function move(direction: -1 | 1) {
    if (!handle.move(direction)) return;
    await tick();
    place();
  }

  // ── Coming and going ────────────────────────────────────────────────────────
  //
  // The grip appears and disappears at the edge of vision, under a pointer that is doing
  // something else — reading a paragraph, crossing the gutter on the way somewhere — and a
  // thing that pops into existence out there reads as a flicker rather than as an offer.
  // So it fades.
  //
  // Opacity and nothing else, which is a constraint rather than a preference: `placeHandle`
  // measures this button's own box to place it, that measurement is taken by the effect
  // below on the same frame the fade starts, and *any* transform — a scale, a nudge in from
  // the gutter — is inside the box `getBoundingClientRect` reports. A grip that grew into
  // place would be measured while small and settle a pixel off the line it belongs on.
  //
  // Short both ways, and shorter leaving than arriving: the hide is already delayed by
  // `HANDLE_HIDE_MS` before this starts, and a grip still visibly fading while the GM
  // types is a grip pointing at a block their edit may have moved.
  const reducedMotion = new MediaQuery("(prefers-reduced-motion: reduce)");

  /**
   * `in:`/`out:` rather than one bidirectional `transition:`, deliberately.
   *
   * A grip on its way out is scenery: still in the DOM for the length of the fade, and no
   * longer the grip of any block — the handle it belonged to is gone. A pointer landing on
   * it there would report a hold to a latch with nothing left to release it, and the next
   * scroll or edit would find the handle exempt from being taken down. So the outro turns
   * pointer events off, and a one-way outro is what makes that safe to do: an element that
   * can reverse back into view is an element that would have to become live again.
   *
   * `|global` because the block that comes and goes is the editor's `{#if}` around this
   * whole component, not anything inside it: a local transition is one that plays only for
   * its own block, and this element's own block is never the one being destroyed.
   */
  function grip(
    node: HTMLElement,
    _params: undefined,
    { direction }: { direction: "in" | "out" | "both" },
  ) {
    if (direction === "out") node.style.pointerEvents = "none";
    return {
      duration: reducedMotion.current ? 0 : direction === "out" ? 90 : 130,
      easing: cubicOut,
      css: (t: number) => `opacity: ${t}`,
    };
  }

  function handleKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        void move(-1);
        break;
      case "ArrowDown":
        event.preventDefault();
        void move(1);
        break;
      // Enter and Space are deliberately absent: a `<button>` raises a click for both,
      // and that click opens the menu. #190 used them to select the block so that Ctrl+C
      // and Ctrl+X would act on it; the menu carries Copy and Delete itself, and it is
      // the more discoverable of the two by a distance.
      case "Escape":
        // Back to the prose. A grip that traps focus is worse than one that is skipped —
        // and this is the way out of the one raised by `Mod-Shift-h`. With a caret, not
        // with the moved block still selected — an Escape after `↑` would otherwise leave
        // the GM's next character standing in for the block they just reordered.
        event.preventDefault();
        handle.release();
        break;
    }
  }
</script>

<button
  bind:this={el}
  type="button"
  draggable="true"
  data-block-handle
  aria-label="Actions for {label}"
  aria-haspopup="menu"
  aria-expanded={!!handle.menu}
  aria-controls={handle.menu ? "block-handle-menu" : undefined}
  aria-describedby="block-handle-hint"
  title="Click for actions · drag to move · ↑ ↓ to reorder"
  style="left: {left}px; top: {top}px; visibility: {placed ? 'visible' : 'hidden'}"
  class="fixed z-40 flex items-center justify-center rounded
         text-muted-foreground/70 transition-colors
         hover:bg-muted hover:text-foreground
         cursor-grab active:cursor-grabbing"
  onmouseenter={() => handle.hover(true)}
  onmouseleave={() => handle.hover(false)}
  onfocus={() => handle.focus(true)}
  onblur={() => handle.focus(false)}
  onmousedown={() => selectBlock(editor, target)}
  ondragstart={handleDragStart}
  ondragend={() => handle.endDrag()}
  onkeydown={handleKeydown}
  onclick={() => (handle.menu ? dismissMenu() : openMenu())}
  in:grip|global
  out:grip|global
>
  <GripVertical size={14} />
</button>

<!-- The reorder hint, said where a screen reader will reach it.
     The `title` above carries all three gestures for a GM with a mouse, but an `aria-label`
     *replaces* a `title` in the accessible name — so with the label alone the arrow keys
     were documented only in a tooltip you need a pointer to see, and the one gesture the
     grip exists for was announced nowhere. The name says what Enter does (open the menu),
     and this says what the arrows do. -->
<span id="block-handle-hint" class="sr-only">
  Arrow up and down move this block among its siblings.
</span>

<!-- Click and not pointerdown is what keeps this out of the drag's way: a completed drag
     raises no click at all, so the two gestures share one button without a timer or a
     movement threshold between them. -->
{#if handle.menu}
  <BlockHandleMenu
    sections={handle.menu.sections}
    {label}
    anchor={handle.menu.anchor}
    trigger={el}
    onSelect={(command) => void handle.choose(command)}
    onClose={(returnFocus) => (returnFocus ? dismissMenu() : handle.closeMenu())}
  />
{/if}

<style>
  /* Sized from the stylesheet's own tokens, because the gutter that has to hold it is
     sized there too — see `--block-gutter` in app.css. The grip's width plus its gap is
     what that number is derived from, so all three live together. */
  button {
    width: var(--block-handle-size);
    height: var(--block-handle-size);
  }
</style>
