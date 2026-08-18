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
  // Sections, since #192: "Turn into" above the three that apply to every block. The
  // section is *absent* on a statblock rather than drawn dim, so this component never
  // decides which — it draws the sections it is handed, and `blockHandleMenuSections`
  // holds the judgement.
  import { Check } from "@lucide/svelte";
  import { BLOCK_ICONS } from "$lib/components/editor/block-icons";
  import { placeMenu } from "$lib/utils/anchored-menu";
  import type {
    BlockHandleCommand,
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

  /** Every item in reading order — what the arrow keys walk, ignoring the sections. */
  const flat = $derived(sections.flatMap((section) => section.items));

  /** One item's identity, for the keyed `each` and for a test to name it by. */
  function commandKey(command: BlockHandleCommand): string {
    return typeof command === "string" ? command : `turn:${command.turnInto}`;
  }

  let menuEl = $state<HTMLDivElement>();
  let itemEls: (HTMLButtonElement | null)[] = [];
  // Roving focus: exactly one item is tabbable at a time, which is what a `menu` is
  // supposed to be — arrow keys walk it, Tab leaves it altogether.
  let active = $state(0);

  // Placed after the items are drawn, so the height that decides the flip is the real one.
  // It matters more since #192 than it did before it: a paragraph's menu is ten items and
  // a statblock's is three, so the same grip halfway down a note flips for one and not the
  // other.
  $effect(() => {
    sections;
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
    // Wrapping, because a short menu is faster to walk round than to walk back — and it
    // walks straight through the section headings, which are not stops.
    active = (active + by + flat.length) % flat.length;
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
        active = flat.length - 1;
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
     goes out from under it.

     A fixed `id`, which the grip points `aria-controls` at: one handle exists at a time and
     it is the only thing that opens this, so there is never a second one to collide with. -->

<div
  bind:this={menuEl}
  id="block-handle-menu"
  data-block-handle-menu
  class="fixed z-50 min-w-[190px] rounded-lg border border-border bg-popover py-1
         shadow-xl shadow-black/30"
  role="menu"
  aria-label="Actions for {label}"
  tabindex={-1}
  onkeydown={handleKeydown}
>
  {#each sections as section, s (section.title ?? "actions")}
    {@const offset = sections
      .slice(0, s)
      .reduce((n, earlier) => n + earlier.items.length, 0)}
    <!-- The heading is `aria-hidden` and names the group instead: read as a stray line of
         text between menu items it would be noise, and read as the group's name it is the
         verb the seven items below it are missing. -->
    {#if section.title}
      <div
        class="px-3 pt-2.5 pb-0.5 font-heading text-[0.6rem] uppercase tracking-widest
               text-muted-foreground/60 select-none pointer-events-none"
        aria-hidden="true"
      >
        {section.title}
      </div>
    {/if}
    <div
      role="group"
      aria-label={section.title ?? undefined}
      class={s > 0 ? "mt-1 pt-1 border-t border-border/60" : ""}
    >
      {#each section.items as item, i (commandKey(item.command))}
        {@const index = offset + i}
        {@const Icon = BLOCK_ICONS[item.icon]}
        {@const turnInto = typeof item.command !== "string"}
        <button
          bind:this={itemEls[index]}
          type="button"
          role={turnInto ? "menuitemradio" : "menuitem"}
          aria-checked={turnInto ? item.current === true : undefined}
          tabindex={index === active ? 0 : -1}
          data-command={commandKey(item.command)}
          aria-label={item.label}
          class="flex items-center gap-2.5 w-full px-3 py-1.5 text-left transition-colors
                 font-sans text-[0.8125rem]
                 {item.command === 'delete'
            ? 'text-destructive/90 hover:bg-destructive/10 focus:bg-destructive/10 hover:text-destructive focus:text-destructive'
            : 'text-muted-foreground hover:bg-muted/60 focus:bg-muted/60 hover:text-foreground focus:text-foreground'}
                 {item.current ? 'text-foreground' : ''}
                 outline-none"
          onclick={() => onSelect(item.command)}
          onmouseenter={() => (active = index)}
        >
          <!-- Unguarded, like the slash menu's: an item's icon name is typed as one that
               exists (#220), so a typo is a build error rather than a missing glyph. -->
          <Icon size={14} class="shrink-0 opacity-70" />
          <span class="flex-1">{item.label}</span>
          <!-- What the block already is, said twice on purpose: `aria-checked` for a
               screen reader, and a tick for everyone reading the menu with their eyes. -->
          {#if item.current}
            <Check size={13} class="shrink-0 opacity-70" />
          {/if}
        </button>
      {/each}
    </div>
  {/each}
</div>
