<script lang="ts">
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";
  import { menuSurface } from "../menu-styles.js";

  let {
    ref = $bindable(null),
    class: className,
    loop = false,
    ...restProps
  }: ContextMenuPrimitive.SubContentProps = $props();
</script>

<ContextMenuPrimitive.SubContent
  bind:ref
  data-slot="context-menu-sub-content"
  class={cn(menuSurface, className)}
  {loop}
  {...restProps}
/>
