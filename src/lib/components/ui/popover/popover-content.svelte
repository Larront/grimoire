<script lang="ts">
  import { Popover as PopoverPrimitive } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    sideOffset = 6,
    onOpenAutoFocus,
    ...restProps
  }: PopoverPrimitive.ContentProps = $props();

  // Focus lands on the panel, not its first control: opened by mouse, a ring on the
  // first button read as that being the current choice. Tab walks in from the panel. A
  // caller may still take over by passing its own `onOpenAutoFocus`.
  function focusPanel(e: Event) {
    if (onOpenAutoFocus) return onOpenAutoFocus(e);
    e.preventDefault();
    ref?.focus();
  }
</script>

<PopoverPrimitive.Portal>
  <PopoverPrimitive.Content
    bind:ref
    {sideOffset}
    tabindex={-1}
    onOpenAutoFocus={focusPanel}
    data-slot="popover-content"
    class={cn(
      "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 bg-popover text-popover-foreground rounded-lg p-3 shadow-float ring-1 duration-100 z-50 outline-none",
      className,
    )}
    {...restProps}
  />
</PopoverPrimitive.Portal>
