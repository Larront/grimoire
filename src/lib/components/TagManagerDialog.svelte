<script lang="ts">
  import { api } from '$lib/api';
  import * as Dialog from '$lib/components/ui/dialog';
  import { LoaderCircle } from '@lucide/svelte';
  import type { TagUsageEntry } from '$lib/bindings.gen';

  let { open = $bindable(false) }: { open: boolean } = $props();

  let tags = $state<TagUsageEntry[]>([]);
  let isLoading = $state(true);
  let hasLoaded = $state(false);

  $effect(() => {
    if (open && !hasLoaded) {
      hasLoaded = true;
      api.getTagUsageCounts()
        .then((t) => { tags = t ?? []; })
        .catch(() => { tags = []; })
        .finally(() => { isLoading = false; });
    }
    if (!open) {
      hasLoaded = false;
      isLoading = true;
      tags = [];
    }
  });
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md overflow-y-auto max-h-[90vh]" data-testid="tag-manager-dialog">
    <Dialog.Header>
      <Dialog.Title>Tag Manager</Dialog.Title>
      <Dialog.Description class="sr-only">All tags in the ledger with usage counts.</Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-4 py-2">
      {#if isLoading}
        <div class="flex items-center gap-3 p-4 rounded-lg bg-background-elevated border border-border">
          <LoaderCircle class="size-4 animate-spin text-foreground-muted" />
          <span class="text-(--font-ui) text-foreground-muted">Loading…</span>
        </div>
      {:else if tags.length === 0}
        <p class="text-(--font-ui) text-foreground-muted" data-testid="tag-manager-empty">
          No tags in ledger yet.
        </p>
      {:else}
        <div class="flex flex-col gap-1" data-testid="tag-manager-list">
          {#each tags as entry (entry.tag)}
            <div
              class="flex items-center justify-between gap-3 px-1 py-1.5"
              data-testid="tag-manager-row"
            >
              <span class="font-mono text-sm text-foreground truncate">{entry.tag}</span>
              <span
                class="shrink-0 text-xs text-foreground-muted tabular-nums"
                data-testid="tag-usage-count-{entry.tag}"
                aria-label="{entry.note_count + entry.pin_count} uses"
              >{entry.note_count + entry.pin_count}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
