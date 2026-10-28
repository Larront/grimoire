<script lang="ts">
  /*
    A name cut in the middle rather than at the end, where a list is too narrow for it
    (2026-10 design review). The head shrinks to an ellipsis and the tail stays whole —
    "Annals of the Iron Ha… Volume 13" — so names that differ at their end still differ
    on screen. Pure layout, nothing measured: two spans in a flex row, the head shrinking
    first. When the name fits it reads as one, and a screen reader hears it as one.

    Drop-in for a `truncate` span: `class` lands on the outer span, which is the one a
    row sizes (`min-w-0 flex-1` and the like).
  */
  import { cn } from "$lib/utils";
  import { splitName, splitPath } from "$lib/utils/middle-truncate";

  let {
    text,
    path = false,
    class: className = "",
    title,
  }: {
    text: string;
    /** A path: keep its last segment rather than its last words. */
    path?: boolean;
    class?: string;
    title?: string;
  } = $props();

  const split = $derived(path ? splitPath(text) : splitName(text));
</script>

{#if split.tail}
  <span class={cn("flex min-w-0 overflow-hidden", className)} {title}>
    <!-- The head gives way, down to room for its ellipsis; the tail never does. A tail
         allowed to shrink even slightly overflowed by a fraction of a pixel, and the
         browser spent its last characters on an ellipsis ("Volume …"). It is at most
         18 characters, so in a space too narrow even for that it is clipped, not cut.
         It starts with the space it was cut at; `pre` keeps it, as a flex item's
         leading space would otherwise be dropped. -->
    <span class="min-w-[2ch] truncate">{split.head}</span><span class="shrink-0 whitespace-pre"
      >{split.tail}</span
    >
  </span>
{:else}
  <span class={cn("truncate", className)} {title}>{text}</span>
{/if}
