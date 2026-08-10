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
  import { onDestroy, tick } from "svelte";
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
  import {
    blockHandleMenuSections,
    runBlockHandleAction,
    type BlockHandleCommand,
    type BlockHandleMenuSection,
  } from "$lib/editor/block-handle-menu";
  import BlockHandleMenu from "./BlockHandleMenu.svelte";
  import { toastError } from "$lib/toast";

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
    /**
     * The grip's menu opened or closed (#191). Separate from `onHold` because the two
     * overlap in both orders — the pointer leaves the grip to reach the menu, and Escape
     * closes the menu with the pointer still on the grip — and because an open menu also
     * freezes which block the handle is on.
     */
    onPin: (pinned: boolean) => void;
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
    onPin,
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

  // ── The menu ────────────────────────────────────────────────────────────────
  //
  // What a click on the grip reaches (#191, #192). The block the menu acts on is captured
  // *when it opens* — the whole target, position and node both, so that an edit landing
  // while the menu is up is caught rather than silently redirected to whichever block has
  // moved into that position.
  //
  // The sections are captured with it, and for the same reason rather than for symmetry:
  // they are read off the document, and which kind is ticked as current is a fact about
  // the block as it stood when the GM opened the menu. Deriving them live would have the
  // list under the pointer change shape mid-reach.
  let menuOpen = $state(false);
  let menuTarget = $state.raw<BlockTarget | null>(null);
  let menuSections = $state.raw<BlockHandleMenuSection[]>([]);
  let menuAnchor = $state({ x: 0, y: 0, anchorTop: 0 });

  function openMenu() {
    if (!el) return;
    const box = el.getBoundingClientRect();
    // Off the grip's own box: below it where there is room, above it where there is not.
    menuAnchor = { x: box.left, y: box.bottom + 4, anchorTop: box.top - 4 };
    menuTarget = target;
    menuSections = blockHandleMenuSections(editor.state.doc, target);
    menuOpen = true;
    onPin(true);
  }

  function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    onPin(false);
  }

  // The grip can go out from under an open menu — a scroll invalidates the target and the
  // whole handle is unmounted — and a pin that outlived it would be a latch nothing is
  // left to release, freezing the grip off for the rest of the session.
  onDestroy(() => {
    if (menuOpen) onPin(false);
  });

  /** Dismissed without choosing: the grip takes its focus back, and stays up under it. */
  function dismissMenu() {
    closeMenu();
    el?.focus();
  }

  /**
   * One menu item, on the block the menu was opened on.
   *
   * The handle comes down afterwards whatever happened, and focus goes back to the prose.
   * Every position it holds describes the document as it was before the write — after a
   * Delete there is no block there at all — so a grip left on screen is a grip pointing at
   * whichever block has moved into that spot.
   *
   * The `catch` is not tidiness: Copy awaits a clipboard, and a clipboard *rejects* — a
   * denied permission, a webview that will not hand one over. Closing the menu has
   * already taken focus off the item that held it, so a throw on the way past would leave
   * the GM's next keystrokes going nowhere at all. It is toasted rather than swallowed
   * because a copy that silently did not happen is discovered at the paste, in another
   * app, with the thing that was going to be pasted no longer to hand.
   */
  async function runMenuAction(command: BlockHandleCommand) {
    const acting = menuTarget;
    closeMenu();
    try {
      if (acting) await runBlockHandleAction(editor, acting, command);
    } catch {
      toastError("Couldn't copy that block — this window has no clipboard access.");
    } finally {
      onRelease();
      editor.commands.focus();
    }
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
    if (grabbed && el) {
      el.focus();
      onGrabHandled?.();
    }
  });

  // ── What is holding the grip ────────────────────────────────────────────────
  //
  // Two signals, one latch, and they are tracked apart because they overlap: the pointer
  // and the focus. `Mod-Shift-h` raises the grip under wherever the pointer happens to be
  // resting and focuses it, so the GM's first nudge of the mouse raises `mouseleave` on a
  // grip that still holds the keyboard — and a single shared boolean would report that as
  // "nothing is holding this", drop the handle, and strand focus on nothing mid-gesture.
  //
  // Plain `let`: nothing is drawn from either, and the reader is `onHold` alone.
  let hovered = false;
  let focused = false;

  function reportHold() {
    onHold(hovered || focused);
  }

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
      // Enter and Space are deliberately absent: a `<button>` raises a click for both,
      // and that click opens the menu. #190 used them to select the block so that Ctrl+C
      // and Ctrl+X would act on it; the menu carries Copy and Delete itself, and it is
      // the more discoverable of the two by a distance.
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
  aria-haspopup="menu"
  aria-expanded={menuOpen}
  title="Click for actions · drag to move · ↑ ↓ to reorder"
  style="left: {left}px; top: {top}px; visibility: {placed ? 'visible' : 'hidden'}"
  class="fixed z-40 flex items-center justify-center rounded
         text-muted-foreground/70 transition-colors
         hover:bg-muted hover:text-foreground
         cursor-grab active:cursor-grabbing"
  onmouseenter={() => ((hovered = true), reportHold())}
  onmouseleave={() => ((hovered = false), reportHold())}
  onfocus={() => ((focused = true), reportHold())}
  onblur={() => ((focused = false), reportHold())}
  onmousedown={() => selectBlockAt(editor, target.pos)}
  ondragstart={handleDragStart}
  ondragend={onRelease}
  onkeydown={handleKeydown}
  onclick={() => (menuOpen ? dismissMenu() : openMenu())}
>
  <GripVertical size={14} />
</button>

<!-- Click and not pointerdown is what keeps this out of the drag's way: a completed drag
     raises no click at all, so the two gestures share one button without a timer or a
     movement threshold between them. -->
{#if menuOpen}
  <BlockHandleMenu
    sections={menuSections}
    {label}
    anchor={menuAnchor}
    trigger={el}
    onSelect={(command) => void runMenuAction(command)}
    onClose={(returnFocus) => (returnFocus ? dismissMenu() : closeMenu())}
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
