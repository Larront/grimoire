<script lang="ts">
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import type { RightRailState } from '$lib/stores/right-rail.svelte.js';

  const { rail }: { rail: RightRailState } = $props();
</script>

{#snippet railContent()}
  <div class="flex h-full flex-col">
    <div class="flex h-[var(--tab-bar-h)] shrink-0 items-center gap-2 border-b border-sidebar-border px-[var(--pad-x)]">
      <span class="ml-auto text-[var(--font-body)] font-medium text-foreground">Details</span>
    </div>
    <div class="flex-1 overflow-y-auto p-[var(--pad-x)] text-[var(--font-body)] text-muted-foreground">
    </div>
  </div>
{/snippet}

{#if rail.isMobile}
  <Sheet.Root
    bind:open={() => rail.openMobile, (v) => rail.setOpenMobile(v)}
  >
    <Sheet.Content
      side="right"
      data-slot="right-rail"
      data-mobile="true"
      class="w-[300px] p-0 [&>button]:hidden"
      showCloseButton={false}
    >
      <Sheet.Header class="sr-only">
        <Sheet.Title>Details panel</Sheet.Title>
        <Sheet.Description>Document metadata and details.</Sheet.Description>
      </Sheet.Header>
      {@render railContent()}
    </Sheet.Content>
  </Sheet.Root>
{:else}
  <aside
    data-slot="right-rail"
    data-mobile="false"
    data-state={rail.open ? 'open' : 'closed'}
    class="hidden w-0 shrink-0 overflow-hidden transition-[width] duration-200 ease-linear data-[state=open]:w-[300px] lg:flex lg:flex-col"
  >
    <div class="flex h-full w-[300px] flex-col border-l border-sidebar-border bg-sidebar">
      {@render railContent()}
    </div>
  </aside>
{/if}
