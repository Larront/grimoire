<script lang="ts">
  import { api } from '$lib/api';
  import * as Dialog from '$lib/components/ui/dialog';
  import { LoaderCircle } from '@lucide/svelte';
  import type { TagUsageEntry } from '$lib/bindings.gen';

  let { open = $bindable(false) }: { open: boolean } = $props();

  let tags = $state<TagUsageEntry[]>([]);
  let tagStyles = $state<Record<string, { color: string | null; hidden: boolean }>>({});
  let isLoading = $state(true);
  let hasLoaded = $state(false);

  $effect(() => {
    if (open && !hasLoaded) {
      hasLoaded = true;
      Promise.all([
        api.getTagUsageCounts(),
        api.getTagGraphStyles(),
      ])
        .then(([t, s]) => {
          tags = t ?? [];
          tagStyles = s ?? {};
        })
        .catch(() => { tags = []; tagStyles = {}; })
        .finally(() => { isLoading = false; });
    }
    if (!open) {
      hasLoaded = false;
      isLoading = true;
      tags = [];
      tagStyles = {};
    }
  });

  function isTagVisible(tag: string): boolean {
    return !(tagStyles[tag]?.hidden ?? false);
  }

  function updateTagStyle(tag: string, patch: Partial<{ color: string | null; hidden: boolean }>) {
    const next = { color: null, hidden: false, ...tagStyles[tag], ...patch };
    tagStyles = { ...tagStyles, [tag]: next };
    return api.setTagGraphStyle(tag, next.color, next.hidden);
  }

  const setTagColor = (tag: string, color: string | null) => updateTagStyle(tag, { color });
  const toggleTagVisibility = (tag: string) => updateTagStyle(tag, { hidden: isTagVisible(tag) });
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md overflow-y-auto max-h-[90vh]" data-testid="tag-manager-dialog">
    <Dialog.Header>
      <Dialog.Title>Tag Manager</Dialog.Title>
      <Dialog.Description class="sr-only">All tags in the ledger with usage counts, graph color, and visibility.</Dialog.Description>
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
              <span class="font-mono text-sm text-foreground truncate flex-1">{entry.tag}</span>

              <div class="flex items-center gap-2 shrink-0">
                <!-- Usage count -->
                <span
                  class="text-xs text-foreground-muted tabular-nums"
                  data-testid="tag-usage-count-{entry.tag}"
                  aria-label="{entry.note_count + entry.pin_count} uses"
                >{entry.note_count + entry.pin_count}</span>

                <!-- Graph color picker -->
                <div class="flex items-center gap-1">
                  <input
                    type="color"
                    aria-label="Graph color for {entry.tag}"
                    data-testid="tag-color-{entry.tag}"
                    value={tagStyles[entry.tag]?.color ?? '#888888'}
                    onchange={(e) => setTagColor(entry.tag, (e.target as HTMLInputElement).value)}
                    class="size-6 rounded cursor-pointer border border-border bg-transparent p-0"
                  />
                  {#if tagStyles[entry.tag]?.color}
                    <button
                      type="button"
                      aria-label="Clear graph color for {entry.tag}"
                      data-testid="tag-color-clear-{entry.tag}"
                      onclick={() => setTagColor(entry.tag, null)}
                      class="text-foreground-muted hover:text-foreground text-xs leading-none"
                    >×</button>
                  {/if}
                </div>

                <!-- Graph visibility toggle -->
                <button
                  type="button"
                  role="switch"
                  aria-checked={isTagVisible(entry.tag)}
                  aria-label="Show {entry.tag} in graph"
                  data-testid="tag-visibility-{entry.tag}"
                  onclick={() => toggleTagVisibility(entry.tag)}
                  class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background {isTagVisible(entry.tag) ? 'bg-primary' : 'bg-input'}"
                >
                  <span
                    class="pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform {isTagVisible(entry.tag) ? 'translate-x-4' : 'translate-x-0'}"
                  ></span>
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
