<script lang="ts">
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { cn, type WithElementRef } from "$lib/utils.js";
  import type { HTMLAttributes } from "svelte/elements";
  import { SIDEBAR_WIDTH_ICON, persistSidebarOpen, readSidebarOpen } from "./constants.js";
  import { setSidebar } from "./context.svelte.js";

  let {
    ref = $bindable(null),
    // Read once, at the same moment the width is (`SidebarState`'s constructor),
    // so the strip is painted at its remembered size in its remembered state
    // rather than settling into it (#226).
    open = $bindable(readSidebarOpen()),
    onOpenChange = () => {},
    class: className,
    style,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  } = $props();

  const sidebar = setSidebar({
    open: () => open,
    setOpen: (value: boolean) => {
      open = value;
      onOpenChange(value);
      persistSidebarOpen(value);
    },
  });
</script>

<svelte:window onkeydown={sidebar.handleShortcutKeydown} />

<Tooltip.Provider delayDuration={0}>
  <div
    data-slot="sidebar-wrapper"
    style="--sidebar-width: {sidebar.width}px; --sidebar-width-icon: {SIDEBAR_WIDTH_ICON}; {style}"
    class={cn(
      "group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex min-h-svh w-full",
      className,
    )}
    bind:this={ref}
    {...restProps}
  >
    {@render children?.()}
  </div>
</Tooltip.Provider>
