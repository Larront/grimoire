<script lang="ts">
  /*
    How a section opens and closes, everywhere: the sidebar's groups, a folder in the file
    tree, a note's blocks. One quick glide — its height from nothing to its own, over
    `--motion-base` easing out — with the content fading in alongside (DESIGN.md §5
    Motion). Until the 2026-10 review the app had three ways: a 400ms Svelte slide that
    ignored Reduce Motion, two grid-rows glides at different speeds, and an instant snap.

    The height is a grid row going from `0fr` to `1fr`, the one layout property DESIGN.md
    lets animate, and only here. Closed, the content is `inert`, so Tab can't reach into
    it. Open and settled, it isn't clipped, so focus rings and menus at its edges show.

    `keepMounted` for content that must outlive being closed — a ProseMirror node's
    editable body; otherwise a closed section's content is dropped once it has shut.
    `holdsPlace` for a section in a note: closing it near the end keeps the page where
    it is (`$lib/utils/hold-place`).
  */
  import { untrack, type Snippet } from "svelte";
  import { cn } from "$lib/utils";
  import { holdPlace } from "$lib/utils/hold-place";

  interface Props {
    open: boolean;
    keepMounted?: boolean;
    holdsPlace?: boolean;
    class?: string;
    children: Snippet;
  }

  let {
    open,
    keepMounted = false,
    holdsPlace = false,
    class: className,
    children,
  }: Props = $props();

  // Mounted while open or shutting; expanded drives the row; settled lets it overflow.
  // Seeded from where it starts — already open draws open, with nothing to glide.
  const startsOpen = untrack(() => open);
  let mounted = $state(startsOpen);
  let expanded = $state(startsOpen);
  let settled = $state(startsOpen);
  let el = $state<HTMLDivElement | null>(null);

  /** Whether a glide will run — none where no transition applies, so nothing waits on
   *  a `transitionend` that never comes. */
  function glides(): boolean {
    if (!el) return false;
    return parseFloat(getComputedStyle(el).transitionDuration) > 0;
  }

  $effect(() => {
    if (open) {
      mounted = true;
      // A frame at 0fr first, or there is nothing to glide from.
      const frame = requestAnimationFrame(() => {
        expanded = true;
        if (!glides()) settled = true;
      });
      return () => cancelAnimationFrame(frame);
    }
    if (holdsPlace && el && untrack(() => expanded)) holdPlace(el);
    expanded = false;
    settled = false;
    if (!glides() && !keepMounted) mounted = false;
  });

  function onTransitionEnd(e: TransitionEvent) {
    if (e.target !== el || e.propertyName !== "grid-template-rows") return;
    if (open) settled = true;
    else if (!keepMounted) mounted = false;
  }
</script>

<div
  bind:this={el}
  class={cn(
    "grid transition-[grid-template-rows] duration-(--motion-base) ease-out",
    expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
    className,
  )}
  inert={!open}
  data-open={expanded || undefined}
  ontransitionend={onTransitionEnd}
>
  <div
    class={cn(
      "min-h-0 transition-opacity duration-(--motion-base) ease-out",
      expanded ? "opacity-100" : "opacity-0",
      !settled && "overflow-hidden",
    )}
  >
    {#if mounted || keepMounted}
      {@render children()}
    {/if}
  </div>
</div>
