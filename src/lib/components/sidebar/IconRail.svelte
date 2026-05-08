<script lang="ts">
  import { Search, Files, Music2, Settings } from "@lucide/svelte";
  import { useSidebar } from "$lib/components/ui/sidebar/context.svelte.js";
  import { cn } from "$lib/utils";

  let { onFilesClick, onScenesClick, onSearchClick, onSettingsClick }: {
    onFilesClick?: () => void;
    onScenesClick?: () => void;
    onSearchClick?: () => void;
    onSettingsClick?: () => void;
  } = $props();

  const sidebar = useSidebar();

  function ensureOpen() {
    if (sidebar.isMobile) {
      if (!sidebar.openMobile) sidebar.setOpenMobile(true);
    } else {
      if (!sidebar.open) sidebar.setOpen(true);
    }
  }

  function handleFilesClick() {
    ensureOpen();
    onFilesClick?.();
  }

  function handleScenesClick() {
    ensureOpen();
    onScenesClick?.();
  }

  const btnBase =
    "flex h-[var(--row-h)] w-[var(--row-h)] items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring";
</script>

<div
  class="fixed inset-y-0 left-0 z-20 flex w-12 flex-col border-r border-sidebar-border bg-sidebar"
  data-testid="icon-rail"
>
  <!-- Top icons: brand + nav -->
  <div class="flex flex-col items-center gap-0.5 pt-2">
    <!-- Brand mark -->
    <button
      type="button"
      aria-label="Grimoire — expand sidebar"
      class={cn(btnBase, "mb-1")}
      onclick={ensureOpen}
    >
      <span class="font-heading text-base font-semibold text-primary select-none">G</span>
    </button>

    <!-- Search -->
    <button
      type="button"
      aria-label="Search"
      class={btnBase}
      onclick={onSearchClick}
    >
      <Search class="size-[var(--icon-rail-icon)]" strokeWidth={1.5} />
    </button>

    <!-- Files -->
    <button
      type="button"
      aria-label="Files"
      class={btnBase}
      onclick={handleFilesClick}
    >
      <Files class="size-[var(--icon-rail-icon)]" strokeWidth={1.5} />
    </button>

    <!-- Scenes -->
    <button
      type="button"
      aria-label="Scenes"
      class={btnBase}
      onclick={handleScenesClick}
    >
      <Music2 class="size-[var(--icon-rail-icon)]" strokeWidth={1.5} />
    </button>
  </div>

  <!-- Bottom: settings (subdued) -->
  <div class="mt-auto flex flex-col items-center pb-2">
    <button
      type="button"
      aria-label="Settings"
      class={cn(btnBase, "text-sidebar-foreground/40 hover:text-sidebar-foreground/60")}
      onclick={onSettingsClick}
    >
      <Settings class="size-[var(--icon-rail-icon)]" strokeWidth={1.5} />
    </button>
  </div>
</div>
