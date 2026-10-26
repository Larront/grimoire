<script lang="ts">
  // The grip's menu (#191, #192) — what a click on the handle opens.
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
  //
  // "Turn into" is one row opening a submenu beside this one (2026-10 design review). Its
  // seven types were seven of a text block's ten rows, while every other block's menu was
  // three — so the same grip opened a long menu or a short one depending on what it held.
  // Every menu is now the same short list, with Turn into first where a block has one. The
  // section is still *absent* on a statblock rather than drawn dim; `blockHandleMenuSections`
  // holds that judgement and this draws what it is handed.
  import { ArrowLeftRight, Check, ChevronRight } from "@lucide/svelte";
  import { BLOCK_ICONS } from "$lib/components/editor/block-icons";
  import { placeMenu } from "$lib/utils/anchored-menu";
  import { menuItem } from "$lib/components/ui/menu-styles";
  import type {
    BlockHandleCommand,
    BlockHandleMenuItem,
    BlockHandleMenuSection,
  } from "$lib/editor/block-handle-menu";

  interface Props {
    sections: BlockHandleMenuSection[];
    /** The GM's word for the block this menu acts on — read out with the menu itself. */
    label: string;
    /** The grip's box: the menu hangs off its bottom-left and flips above it if it must. */
    anchor: { x: number; y: number; anchorTop: number };
    /**
     * The grip. Excluded from the outside-click that closes this, so a second click on
     * the grip is a toggle rather than a close immediately undone by a re-open.
     */
    trigger: HTMLElement | undefined;
    onSelect: (command: BlockHandleCommand) => void;
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

  let { sections, label, anchor, trigger, onSelect, onClose }: Props = $props();

  /** The seven a text block can become, if it can become anything. */
  const turnInto = $derived(sections.find((section) => section.title === "Turn into"));
  /** The rest: the three that apply to every block. */
  const actions = $derived(
    sections.filter((section) => section !== turnInto).flatMap((section) => section.items),
  );
  /** What the block is now, said on the Turn into row. */
  const currentKind = $derived(turnInto?.items.find((item) => item.current));

  /** The rows the arrow keys walk: Turn into (where there is one), then the actions. */
  const rowCount = $derived(actions.length + (turnInto ? 1 : 0));

  /** One item's identity, for the keyed `each` and for a test to name it by. */
  function commandKey(command: BlockHandleCommand): string {
    return typeof command === "string" ? command : `turn:${command.turnInto}`;
  }

  let menuEl = $state<HTMLDivElement>();
  let subEl = $state<HTMLDivElement>();
  let rowEls: (HTMLButtonElement | null)[] = [];
  let subEls: (HTMLButtonElement | null)[] = [];
  // Roving focus: exactly one item is tabbable at a time, which is what a `menu` is
  // supposed to be — arrow keys walk it, Tab leaves it altogether. The first row, which is
  // never Delete: Delete is last, and the walk does not wrap round to it.
  let active = $state(0);
  let subOpen = $state(false);
  let subActive = $state(0);

  // Placed after the items are drawn, so the height that decides the flip is the real one.
  $effect(() => {
    sections;
    anchor;
    if (menuEl) placeMenu(menuEl, { x: anchor.x, y: anchor.y, anchorTop: anchor.anchorTop });
  });

  // Beside the menu, level with its row; on the left where the right has no room.
  $effect(() => {
    if (!subOpen || !subEl || !menuEl) return;
    const menu = menuEl.getBoundingClientRect();
    const first = rowEls[0]?.getBoundingClientRect() ?? menu;
    const width = subEl.offsetWidth;
    const right = menu.right + 4;
    const x = right + width + 8 <= window.innerWidth ? right : menu.left - width - 4;
    placeMenu(subEl, { x, y: first.top - 4, anchorTop: first.bottom + 4 });
  });

  // Focus moves into the menu as it opens. A menu opened from the keyboard is unusable
  // otherwise, and one opened by mouse still needs it so that Escape has somewhere to
  // return *from* — and so the note's prose does not keep taking the keystrokes.
  $effect(() => {
    if (subOpen) subEls[subActive]?.focus();
    else rowEls[active]?.focus();
  });

  // Anywhere else — the prose, another pane, the window chrome. `pointerdown` rather than
  // `click`, so a menu does not sit open over the thing the GM is already pressing, and
  // capture so a handler that stops propagation on its own surface cannot leave it up.
  $effect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as globalThis.Node | null;
      if (!target) return;
      if (menuEl?.contains(target) || subEl?.contains(target) || trigger?.contains(target)) {
        return;
      }
      onClose(false);
    }
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  });

  /** Opens the types with the one the block already is under the cursor. */
  function openSub() {
    if (!turnInto) return;
    subActive = Math.max(
      0,
      turnInto.items.findIndex((item) => item.current),
    );
    subOpen = true;
  }

  function closeSub() {
    subOpen = false;
    active = 0;
  }

  /** Up and down stop at the ends: a walk that wrapped from the first row landed on Delete. */
  const clamp = (i: number, count: number) => Math.max(0, Math.min(count - 1, i));

  function handleKeydown(event: KeyboardEvent) {
    const inSub = subOpen;
    const count = inSub ? (turnInto?.items.length ?? 0) : rowCount;
    const at = inSub ? subActive : active;
    const move = (to: number) => {
      event.preventDefault();
      if (inSub) subActive = clamp(to, count);
      else active = clamp(to, count);
    };
    switch (event.key) {
      case "ArrowDown":
        move(at + 1);
        break;
      case "ArrowUp":
        move(at - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(count - 1);
        break;
      case "ArrowRight":
        if (!inSub && turnInto && active === 0) {
          event.preventDefault();
          openSub();
        }
        break;
      case "ArrowLeft":
        if (inSub) {
          event.preventDefault();
          closeSub();
        }
        break;
      case "Escape":
        event.preventDefault();
        // Out one level: the types back to the menu, the menu back to the grip.
        if (inSub) closeSub();
        else onClose(true);
        break;
      case "Tab":
        // Tab closes rather than moving through the items: the menu is chrome floating
        // beside the prose, so tabbing *out* of it would land somewhere unrelated to
        // where the GM was working. It hands the grip its focus back.
        event.preventDefault();
        onClose(true);
        break;
    }
  }

  // Every menu's row (`menuItem`), so this one and a right-click are one design; it
  // was this menu's own until the 2026-10 review moved it into the shared primitives.
  const row = menuItem;
</script>

{#snippet itemIcon(item: BlockHandleMenuItem)}
  {@const Icon = BLOCK_ICONS[item.icon]}
  <!-- Unguarded, like the slash menu's: an item's icon name is typed as one that exists
       (#220), so a typo is a build error rather than a missing glyph. -->
  <Icon size={14} class="shrink-0 opacity-70 group-focus:opacity-100" />
{/snippet}

<!-- `tabindex` is never used: the items carry the roving one and one of them holds focus
     for as long as the menu is open. It is on the container because a `menu` must be
     focusable to be one at all — there has to be somewhere for focus to sit if an item
     goes out from under it.

     A fixed `id`, which the grip points `aria-controls` at: one handle exists at a time and
     it is the only thing that opens this, so there is never a second one to collide with. -->
<div
  bind:this={menuEl}
  id="block-handle-menu"
  data-block-handle-menu
  class="fixed z-50 w-60 rounded-lg border border-border bg-popover p-1 shadow-float"
  role="menu"
  aria-label="Actions for {label}"
  tabindex={-1}
  onkeydown={handleKeydown}
>
  {#if turnInto}
    <button
      bind:this={rowEls[0]}
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={subOpen}
      aria-controls={subOpen ? "block-handle-submenu" : undefined}
      tabindex={active === 0 ? 0 : -1}
      data-command="turn-into"
      class="{row} {subOpen ? 'bg-surface-selected text-foreground' : ''}"
      onclick={() => (subOpen ? closeSub() : openSub())}
      onmousemove={() => {
        active = 0;
        if (!subOpen) openSub();
      }}
    >
      <ArrowLeftRight size={14} class="shrink-0 opacity-70 group-focus:opacity-100" />
      <span class="flex-1">Turn into</span>
      {#if currentKind}
        <span class="shrink-0 text-xs text-muted-foreground">{currentKind.label}</span>
      {/if}
      <ChevronRight size={14} class="shrink-0 opacity-70" />
    </button>
    <div class="my-1 border-t border-border" role="separator"></div>
  {/if}

  <div role="group" aria-label="Actions">
    {#each actions as item, i (commandKey(item.command))}
      {@const index = i + (turnInto ? 1 : 0)}
      {@const destructive = item.command === "delete"}
      <button
        bind:this={rowEls[index]}
        type="button"
        role="menuitem"
        tabindex={index === active ? 0 : -1}
        data-command={commandKey(item.command)}
        aria-label={item.label}
        data-variant={destructive ? "destructive" : undefined}
        class={row}
        onclick={() => onSelect(item.command)}
        onmousemove={() => {
          if (subOpen) subOpen = false;
          active = index;
        }}
      >
        {@render itemIcon(item)}
        <span class="min-w-0 flex-1 truncate">{item.label}</span>
      </button>
    {/each}
  </div>
</div>

{#if turnInto && subOpen}
  <div
    bind:this={subEl}
    id="block-handle-submenu"
    data-block-handle-submenu
    class="fixed z-50 w-48 rounded-lg border border-border bg-popover p-1 shadow-float"
    role="menu"
    aria-label="Turn into"
    tabindex={-1}
    onkeydown={handleKeydown}
  >
    {#each turnInto.items as item, i (commandKey(item.command))}
      <button
        bind:this={subEls[i]}
        type="button"
        role="menuitemradio"
        aria-checked={item.current === true}
        tabindex={i === subActive ? 0 : -1}
        data-command={commandKey(item.command)}
        aria-label={item.label}
        class="{row} {item.current ? 'text-foreground' : ''}"
        onclick={() => onSelect(item.command)}
        onmousemove={() => (subActive = i)}
      >
        {@render itemIcon(item)}
        <span class="flex-1">{item.label}</span>
        <!-- What the block already is, said twice on purpose: `aria-checked` for a
             screen reader, and a tick for everyone reading the menu with their eyes. -->
        {#if item.current}
          <Check size={13} class="shrink-0" />
        {/if}
      </button>
    {/each}
  </div>
{/if}
