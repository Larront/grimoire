<script lang="ts">
  import { cn, type WithElementRef } from "$lib/utils.js";
  import { menuShortcut } from "../menu-styles.js";
  import type { HTMLAttributes } from "svelte/elements";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLSpanElement>> = $props();
</script>

<span bind:this={ref} data-slot="context-menu-shortcut" class={cn(menuShortcut, className)} {...restProps}>
  {@render children?.()}
</span>
