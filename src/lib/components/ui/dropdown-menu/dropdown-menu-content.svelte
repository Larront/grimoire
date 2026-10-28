<script lang="ts">
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";
  import { menuSurface } from "../menu-styles.js";
  import DropdownMenuPortal from "./dropdown-menu-portal.svelte";
  import type { ComponentProps } from "svelte";
  import type { WithoutChildrenOrChild } from "$lib/utils.js";

  // `loop` is off: arrowing up from the first row used to wrap straight onto
  // Delete, which sits last. The Block Handle menu stops at the ends; so do these.
  let {
    ref = $bindable(null),
    portalProps,
    class: className,
    loop = false,
    ...restProps
  }: DropdownMenuPrimitive.ContentProps & {
    portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DropdownMenuPortal>>;
  } = $props();
</script>

<DropdownMenuPortal {...portalProps}>
  <DropdownMenuPrimitive.Content
    bind:ref
    data-slot="dropdown-menu-content"
    class={cn(menuSurface, className)}
    {loop}
    {...restProps}
  />
</DropdownMenuPortal>
