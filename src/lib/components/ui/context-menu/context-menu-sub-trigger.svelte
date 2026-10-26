<script lang="ts">
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
  import { cn, type WithoutChild } from "$lib/utils.js";
  import { menuItem } from "../menu-styles.js";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";

  let {
    ref = $bindable(null),
    class: className,
    inset,
    children,
    ...restProps
  }: WithoutChild<ContextMenuPrimitive.SubTriggerProps> & {
    inset?: boolean;
  } = $props();
</script>

<ContextMenuPrimitive.SubTrigger
  bind:ref
  data-slot="context-menu-sub-trigger"
  data-inset={inset}
  class={cn(menuItem, className)}
  {...restProps}
>
  {@render children?.()}
  <ChevronRightIcon class="ml-auto" />
</ContextMenuPrimitive.SubTrigger>
