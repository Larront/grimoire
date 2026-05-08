<script lang="ts">
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import type { RightRailState } from '$lib/stores/right-rail.svelte.js';
  import { focusedDocument } from '$lib/stores/focused-document.svelte.js';

  const { rail }: { rail: RightRailState } = $props();
</script>

{#snippet railContent()}
  <div class="flex h-full flex-col">
    <div class="flex h-[var(--tab-bar-h)] shrink-0 items-center gap-2 border-b border-sidebar-border px-[var(--pad-x)]">
      {#if focusedDocument.name}
        <span
          data-testid="right-rail-doc-breadcrumb"
          class="truncate text-[var(--font-ui)] text-muted-foreground"
        >{focusedDocument.name}</span>
      {/if}
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
{:else if rail.open}
  <aside
    data-slot="right-rail"
    data-mobile="false"
    class="hidden w-[300px] shrink-0 border-l border-sidebar-border bg-sidebar lg:flex lg:flex-col"
  >
    {@render railContent()}
  </aside>
{/if}
