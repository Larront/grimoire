<script lang="ts">
  import { ContextMenu as ContextMenuPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";
  import { menuSeparator } from "../menu-styles.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: ContextMenuPrimitive.SeparatorProps = $props();
</script>

<!-- bits-ui names its separator a `group`, which a screen reader announces as one;
     the `child` snippet is how a role of our own gets past its props. -->
<ContextMenuPrimitive.Separator bind:ref data-slot="context-menu-separator" {...restProps}>
  {#snippet child({ props })}
    <div {...props} role="separator" class={cn(menuSeparator, className)}></div>
  {/snippet}
</ContextMenuPrimitive.Separator>
