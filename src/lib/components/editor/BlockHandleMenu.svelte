<script lang="ts">
  // The grip's menu (#191) — what a click on the handle opens.
  //
  // Hand-rolled rather than a shadcn `DropdownMenu`, and for one concrete reason: the grip
  // is `draggable`, and bits-ui opens its menu on *pointerdown*. A menu that opens the
  // instant the button is pressed opens on the first frame of every drag, so the two
  // gestures the grip exists for would fight each other. Click is the seam between them —
  // a completed drag raises no click at all — which means the trigger has to stay the
  // plain button #190 drew.
  //
  // It is the fourth menu in this editor to be drawn `fixed` and placed from a measured
  // box, and it shares `placeMenu` with the other three: a note is inside a scroll
  // container this is not in, so an absolutely positioned menu would need an offset parent
  // that agrees with it, and a menu opened low in a long note has to flip above its anchor
  // rather than off the bottom of the window.
  import { Copy, CopyPlus, Trash2 } from "@lucide/svelte";
  import type { Component } from "svelte";
  import { placeMenu } from "$lib/utils/anchored-menu";
  import type {
    BlockHandleAction,
    BlockHandleMenuItem,
  } from "$lib/editor/block-handle-menu";

  interface Props {
    items: BlockHandleMenuItem[];
    /** The GM's word for the block this menu acts on — read out with the menu itself. */
    label: string;
    /** The grip's box: the menu hangs off its bottom-left and flips above it if it must. */
    anchor: { x: number; y: number; anchorTop: number };
    /**
     * The grip. Excluded from the outside-click that closes this, so a second click on
     * the grip is a toggle rather than a close immediately undone by a re-open.
     */
    trigger: HTMLElement | undefined;
    onSelect: (action: BlockHandleAction) => void;
    /**
     * Dismissed without choosing anything. `returnFocus` says whether the grip should
     * take its focus back, and the answer differs by route: Escape and Tab are the GM
     * asking to leave the menu and have nowhere else to be, while a press somewhere else
     * already *has* a destination — and pulling focus to the grip would take it off a
     * control that had just claimed it, which several of this editor's own buttons do
     * deliberately by preventing their mousedown's default.
     */
    onClose: (returnFocus: boolean) => void;
  }

  let { items, label, anchor, trigger, onSelect, onClose }: Props = $props();

  const ICONS: Record<BlockHandleAction, Component> = {
    duplicate: CopyPlus,
    copy: Copy,
    delete: Trash2,
  };

  let menuEl = $state<HTMLDivElement>();
  let itemEls: (HTMLButtonElement | null)[] = [];
  // Roving focus: exactly one item is tabbable at a time, which is what a `menu` is
  // supposed to be — arrow keys walk it, Tab leaves it altogether.
  let active = $state(0);

  // Placed after the items are drawn, so the height that decides the flip is the real one.
  $effect(() => {
    items;
    anchor;
    if (menuEl) placeMenu(menuEl, { x: anchor.x, y: anchor.y, anchorTop: anchor.anchorTop });
  });

  // Focus moves into the menu as it opens. A menu opened from the keyboard is unusable
  // otherwise, and one opened by mouse still needs it so that Escape has somewhere to
  // return *from* — and so the note's prose does not keep taking the keystrokes.
  $effect(() => {
    itemEls[active]?.focus();
  });

  // Anywhere else — the prose, another pane, the window chrome. `pointerdown` rather than
  // `click`, so a menu does not sit open over the thing the GM is already pressing, and
  // capture so a handler that stops propagation on its own surface cannot leave it up.
  $effect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as globalThis.Node | null;
      if (!target) return;
      if (menuEl?.contains(target) || trigger?.contains(target)) return;
      onClose(false);
    }
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  });

  function step(by: number) {
    // Wrapping, because a three-item menu is faster to walk round than to walk back.
    active = (active + by + items.length) % items.length;
  }

  function handleKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        step(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        step(-1);
        break;
      case "Home":
        event.preventDefault();
        active = 0;
        break;
      case "End":
        event.preventDefault();
        active = items.length - 1;
        break;
      case "Escape":
      case "Tab":
        // Tab closes rather than moving through the items: the menu is chrome floating
        // beside the prose, so tabbing *out* of it would land somewhere unrelated to
        // where the GM was working. Both hand the grip its focus back.
        event.preventDefault();
        onClose(true);
        break;
    }
  }
</script>

<!-- `tabindex` is never used: the items carry the roving one and one of them holds focus
     for as long as the menu is open. It is on the container because a `menu` must be
     focusable to be one at all — there has to be somewhere for focus to sit if an item
     goes out from under it. -->
<div
  bind:this={menuEl}
  data-block-handle-menu
  class="fixed z-50 min-w-[190px] rounded-lg border border-border bg-popover py-1
         shadow-xl shadow-black/30"
  role="menu"
  aria-label="Actions for {label}"
  tabindex={-1}
  onkeydown={handleKeydown}
>
  {#each items as item, i (item.action)}
    {@const Icon = ICONS[item.action]}
    <button
      bind:this={itemEls[i]}
      type="button"
      role="menuitem"
      tabindex={i === active ? 0 : -1}
      aria-label={item.label}
      class="flex items-center gap-2.5 w-full px-3 py-1.5 text-left transition-colors
             font-sans text-[0.8125rem]
             {item.action === 'delete'
        ? 'text-destructive/90 hover:bg-destructive/10 focus:bg-destructive/10 hover:text-destructive focus:text-destructive'
        : 'text-muted-foreground hover:bg-muted/60 focus:bg-muted/60 hover:text-foreground focus:text-foreground'}
             outline-none"
      onclick={() => onSelect(item.action)}
      onmouseenter={() => (active = i)}
    >
      <Icon size={14} class="shrink-0 opacity-70" />
      <span>{item.label}</span>
    </button>
  {/each}
</div>
