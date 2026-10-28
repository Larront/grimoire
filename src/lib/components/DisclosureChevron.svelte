<script lang="ts">
  /*
    The arrow beside a section that opens: pointing right while shut, down while open,
    turning at the section's own speed. One arrow for every section (2026-10 design
    review) — there were four: a quarter turn, a half turn, an icon swap, and the file
    tree's, which never turned at all.
  */
  import { ChevronDown } from "@lucide/svelte";
  import { cn } from "$lib/utils";

  let { open, class: className }: { open: boolean; class?: string } = $props();
</script>

<ChevronDown
  aria-hidden="true"
  class={cn(
    "shrink-0 transition-transform duration-(--motion-base) ease-out",
    !open && "-rotate-90",
    className,
  )}
/>
