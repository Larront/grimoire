<script lang="ts">
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";
  import { menuItem } from "../menu-styles.js";

  let {
    ref = $bindable(null),
    class: className,
    inset,
    variant = "default",
    ...restProps
  }: DropdownMenuPrimitive.ItemProps & {
    inset?: boolean;
    variant?: "default" | "destructive";
  } = $props();
</script>

<DropdownMenuPrimitive.Item
  bind:ref
  data-slot="dropdown-menu-item"
  data-inset={inset}
  data-variant={variant}
  class={cn(menuItem, className)}
  {...restProps}
/>
