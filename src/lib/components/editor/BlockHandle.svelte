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
  import { tick } from "svelte";
  import { GripVertical } from "@lucide/svelte";
  import type { Editor } from "@tiptap/core";
  import {
    blockElementAt,
    blockLabel,
    blockTargetAt,
    moveBlockAt,
    placeHandle,
    selectBlockAt,
    startBlockDrag,
    type BlockTarget,
  } from "$lib/editor/block-handle";

  interface Props {
    editor: Editor;
    /** The block under the pointer, from the extension. */
    target: BlockTarget;
    /**
     * Held while the pointer or focus is on the grip itself. The editor stops reporting
     * pointer movement the moment the pointer leaves the prose, so without this the grip
     * disappears exactly as the GM reaches for it.
     */
    onHold: (held: boolean) => void;
    /** The block moved; the handle now belongs beside it at its new position. */
    onRetarget: (target: BlockTarget) => void;
    /** The gesture is over and what it changed has landed — take the grip down now. */
    onRelease: () => void;
    /** The handle was raised from the keyboard, so it is the grip that should have focus. */
    grabbed?: boolean;
    /** Focus taken; the grab has been answered. */
    onGrabHandled?: () => void;
  }

  let {
    editor,
    target,
    onHold,
    onRetarget,
    onRelease,
    grabbed = false,
    onGrabHandled,
  }: Props = $props();

  let el = $state<HTMLButtonElement>();
  let left = $state(0);
  let top = $state(0);
  // Until the first measurement the grip has no position, and drawing it at 0,0 would
  // flash it in the window's corner on the first hover of every note.
  let placed = $state(false);

  const label = $derived(blockLabel(target.node));

  // Re-placed whenever the target changes — every pointer move that lands on a different
  // block, and every keyboard move. `place` reads `target`, so the effect tracks it.
  $effect(() => {
    place();
  });

  // Focus, once, when the handle was raised by keyboard. A hovered grip must NOT do this:
  // taking focus out of the prose because a pointer crossed a paragraph would move the
  // GM's caret out of the sentence they are typing.
  $effect(() => {
    if (grabbed && el) {
      el.focus();
      onGrabHandled?.();
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
    if (!startBlockDrag(editor, target.pos, event.dataTransfer, ghost)) {
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
    const landed = moveBlockAt(editor, target.pos, direction);
    if (landed === null) return;
    const moved = blockTargetAt(editor.state.doc, landed);
    if (moved) onRetarget(moved);
    await tick();
    place();
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
      case "Enter":
      case " ":
        // Selects the block, which is what makes Ctrl+C and Ctrl+X act on it.
        event.preventDefault();
        selectBlockAt(editor, target.pos);
        break;
      case "Escape":
        // Back to the prose. A grip that traps focus is worse than one that is skipped —
        // and this is the way out of the one raised by `Mod-Shift-h`.
        event.preventDefault();
        onRelease();
        editor.commands.focus();
        break;
    }
  }
</script>

<button
  bind:this={el}
  type="button"
  draggable="true"
  data-block-handle
  aria-label="Move {label}"
  title="Drag to move · ↑ ↓ to reorder"
  style="left: {left}px; top: {top}px; visibility: {placed ? 'visible' : 'hidden'}"
  class="fixed z-40 flex items-center justify-center rounded
         text-muted-foreground/70 transition-colors
         hover:bg-muted hover:text-foreground
         cursor-grab active:cursor-grabbing"
  onmouseenter={() => onHold(true)}
  onmouseleave={() => onHold(false)}
  onfocus={() => onHold(true)}
  onblur={() => onHold(false)}
  onmousedown={() => selectBlockAt(editor, target.pos)}
  ondragstart={handleDragStart}
  ondragend={onRelease}
  onkeydown={handleKeydown}
>
  <GripVertical size={14} />
</button>

<style>
  /* Sized from the stylesheet's own tokens, because the gutter that has to hold it is
     sized there too — see `--block-gutter` in app.css. The grip's width plus its gap is
     what that number is derived from, so all three live together. */
  button {
    width: var(--block-handle-size);
    height: var(--block-handle-size);
  }
</style>
