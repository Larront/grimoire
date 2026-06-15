<script lang="ts">
  import { api } from '$lib/api';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { LoaderCircle } from '@lucide/svelte';
  import type { TagUsageEntry } from '$lib/bindings.gen';
  import { toastSuccess } from '$lib/toast';

  let { open = $bindable(false) }: { open: boolean } = $props();

  let tags = $state<TagUsageEntry[]>([]);
  let tagStyles = $state<Record<string, { color: string | null; hidden: boolean }>>({});
  let isLoading = $state(true);
  let hasLoaded = $state(false);

  // ── Retag state ──────────────────────────────────────────────────────────────
  let menuOpenFor = $state<string | null>(null);
  /** Active rename/merge input: from tag + current input value */
  let retagInput = $state<{ from: string; value: string } | null>(null);
  /** Pending confirmation: from tag, to tag (null=delete), and impact counts */
  let pendingConfirm = $state<{
    from: string;
    to: string | null;
    noteCount: number;
    pinCount: number;
  } | null>(null);

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
      menuOpenFor = null;
      retagInput = null;
      pendingConfirm = null;
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

  // ── Retag helpers ────────────────────────────────────────────────────────────

  function openMenu(tag: string) {
    menuOpenFor = menuOpenFor === tag ? null : tag;
    retagInput = null;
  }

  function startRename(tag: string) {
    menuOpenFor = null;
    retagInput = { from: tag, value: '' };
  }

  function startMerge(tag: string) {
    menuOpenFor = null;
    retagInput = { from: tag, value: '' };
  }

  function startDelete(tag: string) {
    menuOpenFor = null;
    const entry = tags.find((e) => e.tag === tag);
    pendingConfirm = {
      from: tag,
      to: null,
      noteCount: entry?.note_count ?? 0,
      pinCount: entry?.pin_count ?? 0,
    };
  }

  function submitRetagInput(tag: string) {
    if (!retagInput || retagInput.from !== tag) return;
    const to = retagInput.value.trim();
    if (!to) return;
    const entry = tags.find((e) => e.tag === tag);
    pendingConfirm = {
      from: tag,
      to,
      noteCount: entry?.note_count ?? 0,
      pinCount: entry?.pin_count ?? 0,
    };
    retagInput = null;
  }

  async function confirmRetag() {
    if (!pendingConfirm) return;
    const { from, to, noteCount, pinCount } = pendingConfirm;
    pendingConfirm = null;
    try {
      await api.retagTag(from, to);
      const total = noteCount + pinCount;
      const label = to === null ? `Deleted tag "${from}"` : `Renamed "${from}" → "${to}"`;
      toastSuccess(`${label} across ${total} ${total === 1 ? 'item' : 'items'}`);
      // Refresh tag list
      const [t, s] = await Promise.all([api.getTagUsageCounts(), api.getTagGraphStyles()]);
      tags = t ?? [];
      tagStyles = s ?? {};
    } catch (err) {
      // Error surfaced to user via toast system if needed; for now, silently ignore
    }
  }

  function cancelRetag() {
    pendingConfirm = null;
    retagInput = null;
  }

  function actionLabel(confirm: typeof pendingConfirm): string {
    if (!confirm) return '';
    if (confirm.to === null) return `Delete tag "${confirm.from}"`;
    return `Rename "${confirm.from}" to "${confirm.to}"`;
  }
</script>

<!-- Retag confirmation dialog (outside main Dialog to avoid nesting issues) -->
{#if pendingConfirm}
  <AlertDialog.Root open={true}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay />
      <AlertDialog.Content data-testid="retag-confirm-dialog">
        <AlertDialog.Header>
          <AlertDialog.Title>{actionLabel(pendingConfirm)}</AlertDialog.Title>
          <AlertDialog.Description>
            This will affect {pendingConfirm.noteCount} {pendingConfirm.noteCount === 1 ? 'note' : 'notes'}
            {#if pendingConfirm.pinCount > 0}
              and {pendingConfirm.pinCount} {pendingConfirm.pinCount === 1 ? 'pin' : 'pins'}
            {/if}.
            This can't be undone.
          </AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
          <AlertDialog.Cancel onclick={cancelRetag}>Cancel</AlertDialog.Cancel>
          <AlertDialog.Action
            onclick={confirmRetag}
            data-testid="retag-confirm-btn"
          >
            {pendingConfirm.to === null ? 'Delete' : 'Rename'}
          </AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>
{/if}

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
              class="flex flex-col gap-1 px-1 py-1"
              data-testid="tag-manager-row"
            >
              <div class="flex items-center justify-between gap-3">
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

                  <!-- ⋯ More menu -->
                  <div class="relative">
                    <button
                      type="button"
                      aria-label="More options for {entry.tag}"
                      data-testid="tag-menu-{entry.tag}"
                      onclick={() => openMenu(entry.tag)}
                      class="flex size-6 items-center justify-center rounded text-foreground-muted hover:text-foreground hover:bg-background-elevated text-base leading-none"
                    >⋯</button>

                    {#if menuOpenFor === entry.tag}
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <div
                        class="absolute right-0 top-7 z-50 min-w-[140px] rounded-md border border-border bg-background shadow-lg py-1 flex flex-col"
                        onmouseleave={() => { menuOpenFor = null; }}
                      >
                        <button
                          type="button"
                          data-testid="tag-menu-rename-{entry.tag}"
                          onclick={() => startRename(entry.tag)}
                          class="px-3 py-1.5 text-sm text-left hover:bg-background-elevated"
                        >Rename</button>
                        <button
                          type="button"
                          data-testid="tag-menu-merge-{entry.tag}"
                          onclick={() => startMerge(entry.tag)}
                          class="px-3 py-1.5 text-sm text-left hover:bg-background-elevated"
                        >Merge into…</button>
                        <button
                          type="button"
                          data-testid="tag-menu-delete-{entry.tag}"
                          onclick={() => startDelete(entry.tag)}
                          class="px-3 py-1.5 text-sm text-left text-destructive hover:bg-background-elevated"
                        >Delete</button>
                      </div>
                    {/if}
                  </div>
                </div>
              </div>

              <!-- Inline rename/merge input -->
              {#if retagInput?.from === entry.tag}
                <div class="flex items-center gap-2 pl-1">
                  <input
                    type="text"
                    placeholder="New tag name…"
                    data-testid="retag-input-{entry.tag}"
                    bind:value={retagInput.value}
                    onkeydown={(e) => {
                      if (e.key === 'Enter') submitRetagInput(entry.tag);
                      if (e.key === 'Escape') retagInput = null;
                    }}
                    class="flex-1 rounded border border-border bg-background px-2 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onclick={() => submitRetagInput(entry.tag)}
                    class="text-xs px-2 py-1 rounded bg-primary text-primary-foreground"
                  >Apply</button>
                  <button
                    type="button"
                    onclick={() => { retagInput = null; }}
                    class="text-xs px-2 py-1 rounded border border-border text-foreground-muted"
                  >Cancel</button>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
