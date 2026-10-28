<script lang="ts">
  // The card a resting pointer raises over a wikilink — a peek at the note (2026-10 design
  // review). The pointer can move onto it: it stays, scrolls, and opens the note, so a GM
  // reads an NPC mid-fight without leaving the encounter.
  //
  // Still *text*: the excerpt is the note's words with the notation taken off, never the
  // note rendered (#167). Links in it read as plain names, so nothing in it looks
  // clickable that is not.
  import { ArrowUpRight, FilePlus2 } from "@lucide/svelte";
  import { noteExcerptBlocks } from "$lib/editor/note-excerpt";
  import { wikiFragment } from "$lib/editor/wiki-target";
  import type { LinkPreviewCard } from "$lib/editor/link-preview.svelte";
  import { placeMenu } from "$lib/utils/anchored-menu";

  interface Props {
    card: LinkPreviewCard;
    /** Whether a note not written yet can be created from here. Quick Notes says no. */
    allowCreate?: boolean;
    /** The pointer reached the card, or left it. */
    onPointer: (on: boolean) => void;
    onOpen: (note: NonNullable<LinkPreviewCard["note"]>) => void;
    onCreate?: (path: string) => void;
    onClose: () => void;
  }

  let { card, allowCreate = false, onPointer, onOpen, onCreate, onClose }: Props = $props();

  let el = $state<HTMLDivElement>();
  let action = $state<HTMLButtonElement>();

  const heading = $derived(wikiFragment(card.path));
  const blocks = $derived(card.note ? noteExcerptBlocks(card.content, heading) : []);
  const title = $derived(card.note?.title ?? card.linkText);
  /** Where the note lives — its folder, not its file path. */
  const folder = $derived(card.note?.path.includes("/") ? card.note.path.replace(/\/[^/]*$/, "") : null);

  // Placed as the menus are: below the link, above it near the window's foot, and kept in
  // from the edges. It used to sit at the link's corner whatever the room, and a link low in
  // a note put the card 154px past the bottom of the window.
  $effect(() => {
    card;
    if (el) placeMenu(el, card.anchor);
  });

  // Raised from the keyboard, the card takes focus on its action, so Enter opens the note.
  $effect(() => {
    if (card.viaKeyboard) action?.focus();
  });

  // Ways out: Escape, a press anywhere else, the note scrolling under it. Escape used to do
  // nothing, and a card that had stuck stayed through all three.
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A card the keyboard raised owns this Escape. One a hover raised only closes, and
      // the key goes on to whatever else it means where the GM is typing.
      if (card.viaKeyboard) {
        e.preventDefault();
        e.stopPropagation();
      }
      close();
    };
    const onDown = (e: PointerEvent) => {
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      onClose();
    };
    const onScroll = (e: Event) => {
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  });

  /** Closes, handing focus back to wherever the keyboard raised the card from. */
  function close() {
    const back = card.viaKeyboard ? card.returnTo : null;
    onClose();
    back?.focus();
  }
</script>

<!-- A non-modal dialog rather than a tooltip: it holds a button and scrolls, and the pointer
     can be on it. Named by the note, so a keyboard-raised card says what it is. -->
<div
  bind:this={el}
  class="link-preview fixed z-[60] w-72 overflow-hidden rounded-lg border border-border bg-popover shadow-float"
  role="dialog"
  tabindex="-1"
  aria-label="Preview of {title}"
  data-link-preview
  onmouseenter={() => onPointer(true)}
  onmouseleave={() => onPointer(false)}
>
  <div class="flex items-start gap-2 border-b border-border px-3.5 pt-3 pb-2">
    <div class="min-w-0 flex-1">
      <div class="font-heading text-sm leading-tight text-foreground">{title}</div>
      {#if folder || heading || !card.note}
        <div class="mt-0.5 truncate font-sans text-xs text-muted-foreground">
          {#if !card.note}
            Not written yet
          {:else}
            {[folder, heading && `§ ${heading}`].filter(Boolean).join(" · ")}
          {/if}
        </div>
      {/if}
    </div>
    {#if card.note}
      <button
        bind:this={action}
        type="button"
        class="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 font-sans text-xs text-muted-foreground
               transition-colors hover:bg-surface-hover hover:text-foreground cursor-pointer
               focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring
               {card.viaKeyboard ? 'focus:outline-2 focus:outline-offset-1 focus:outline-ring' : ''}"
        onclick={() => card.note && onOpen(card.note)}
      >
        Open <ArrowUpRight size={13} />
      </button>
    {:else if allowCreate && onCreate}
      <button
        bind:this={action}
        type="button"
        class="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 font-sans text-xs text-muted-foreground
               transition-colors hover:bg-surface-hover hover:text-foreground cursor-pointer
               focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring
               {card.viaKeyboard ? 'focus:outline-2 focus:outline-offset-1 focus:outline-ring' : ''}"
        onclick={() => onCreate?.(card.path)}
      >
        <FilePlus2 size={13} /> Create
      </button>
    {/if}
  </div>

  {#if card.note}
    <!-- The whole excerpt, scrolling: the card used to stop at five lines, blank ones
         counted, and could end on a lone "…". -->
    <div class="link-preview-body max-h-60 overflow-y-auto overscroll-contain px-3.5 py-2.5" tabindex="-1">
      {#if blocks.length === 0}
        <p class="font-sans text-xs text-muted-foreground">Nothing written in this note yet.</p>
      {:else}
        {#each blocks as block, i (i)}
          {#if block.kind === "heading"}
            <p class="mt-2.5 mb-1 first:mt-0 font-sans text-xs font-semibold text-foreground">
              {block.text}
            </p>
          {:else}
            <p
              class="mb-2 last:mb-0 font-sans text-xs leading-relaxed whitespace-pre-line text-muted-foreground"
            >
              {block.text}
            </p>
          {/if}
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .link-preview-body {
    scrollbar-width: thin;
    scrollbar-color: var(--background-border) transparent;
  }
</style>
