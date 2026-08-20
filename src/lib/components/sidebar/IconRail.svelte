<script lang="ts">
  import { Search, Files, Music2, Settings, Network, Inbox } from "@lucide/svelte";
  import { useSidebar } from "$lib/components/ui/sidebar/context.svelte.js";
  import { cn } from "$lib/utils";

  let {
    onFilesClick,
    onScenesClick,
    onSearchClick,
    onSettingsClick,
    onGraphClick,
    onQuickNotesClick,
    quickNoteCount = 0,
  }: {
    onFilesClick?: () => void;
    onScenesClick?: () => void;
    onSearchClick?: () => void;
    onSettingsClick?: () => void;
    onGraphClick?: () => void;
    onQuickNotesClick?: () => void;
    /** How many [[Quick Note]]s the ledger holds (#233). Zero draws no badge at
     *  all rather than a `0`, following the Scene Player panel's rule that
     *  sidebar furniture stays quiet until it has something to say. */
    quickNoteCount?: number;
  } = $props();

  const sidebar = useSidebar();

  function handleFilesClick() {
    if (sidebar.isMobile) sidebar.setOpenMobile(true);
    else sidebar.setOpen(true);
    onFilesClick?.();
  }

  const btnBase =
    "flex size-(--row-h) items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring";
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
      onclick={sidebar.toggle}
    >
      <span class="font-heading text-base font-semibold text-primary select-none">G</span>
    </button>

    <!-- Search -->
    <button type="button" aria-label="Search" class={btnBase} onclick={onSearchClick}>
      <Search class="size-(--icon-rail-icon)" strokeWidth={1.5} />
    </button>

    <!-- Files -->
    <button type="button" aria-label="Files" class={btnBase} onclick={handleFilesClick}>
      <Files class="size-(--icon-rail-icon)" strokeWidth={1.5} />
    </button>

    <!-- Scenes -->
    <button type="button" aria-label="Scenes" class={btnBase} onclick={onScenesClick}>
      <Music2 class="size-(--icon-rail-icon)" strokeWidth={1.5} />
    </button>

    <!-- Graph -->
    <button type="button" aria-label="Graph" class={btnBase} onclick={onGraphClick}>
      <Network class="size-(--icon-rail-icon)" strokeWidth={1.5} />
    </button>

    <!-- Quick Notes: an inbox, and the badge is what is still in it. One click
         opens the pane; there is no sidebar step, as Graph has none. -->
    <div class="relative">
      <button
        type="button"
        aria-label={quickNoteCount > 0 ? `Quick Notes — ${quickNoteCount} held` : "Quick Notes"}
        class={btnBase}
        data-testid="rail-quick-notes"
        onclick={onQuickNotesClick}
      >
        <Inbox class="size-(--icon-rail-icon)" strokeWidth={1.5} />
      </button>
      {#if quickNoteCount > 0}
        <span
          data-testid="rail-quick-notes-count"
          aria-hidden="true"
          class="pointer-events-none absolute -top-0.5 right-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10.5px] leading-none font-medium text-primary-foreground tabular-nums select-none"
        >
          {quickNoteCount}
        </span>
      {/if}
    </div>
  </div>

  <!-- Bottom: settings (subdued) -->
  <div class="mt-auto flex flex-col items-center pb-2">
    <button
      type="button"
      aria-label="Settings"
      class={cn(btnBase, "text-sidebar-foreground/40 hover:text-sidebar-foreground/60")}
      onclick={onSettingsClick}
    >
      <Settings class="size-(--icon-rail-icon)" strokeWidth={1.5} />
    </button>
  </div>
</div>
