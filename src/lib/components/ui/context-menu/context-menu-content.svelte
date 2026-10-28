<script lang="ts">
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";
  import { menuSurface } from "../menu-styles.js";
  import ContextMenuPortal from "./context-menu-portal.svelte";
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
  }: ContextMenuPrimitive.ContentProps & {
    portalProps?: WithoutChildrenOrChild<ComponentProps<typeof ContextMenuPortal>>;
  } = $props();
</script>

<ContextMenuPortal {...portalProps}>
  <ContextMenuPrimitive.Content
    bind:ref
    data-slot="context-menu-content"
    class={cn(menuSurface, className)}
    {loop}
    {...restProps}
  />
</ContextMenuPortal>
