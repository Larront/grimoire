<script lang="ts">
  import type { Snippet } from 'svelte';
  import { PanelRight, Check } from '@lucide/svelte';

  interface Props {
    title: string;
    saveStatus?: 'idle' | 'saved' | 'error';
    onRetrySave?: () => void;
    onclose?: () => void;
    isEmpty?: boolean;
    children?: Snippet;
    emptyState?: Snippet;
  }

  let {
    title,
    saveStatus = 'idle',
    onRetrySave,
    onclose,
    isEmpty = false,
    children,
    emptyState,
  }: Props = $props();
</script>

<div data-slot="detail-panel" class="flex min-h-0 flex-1 flex-col">
  <div class="flex h-(--tab-bar-h) shrink-0 items-center gap-2 border-b border-background-border px-(--pad-x)">
    <span class="font-heading text-(--font-body) font-medium text-foreground">{title}</span>
    {#if saveStatus === 'saved'}
      <span class="flex items-center gap-1 font-mono text-[10px] text-success">
        <Check class="size-3" />Saved
      </span>
    {:else if saveStatus === 'error'}
      <button
        onclick={onRetrySave}
        class="font-mono text-[10px] text-error hover:underline"
      >Save failed · Retry</button>
    {/if}
    <button
      onclick={onclose}
      class="ml-auto flex size-7 items-center justify-center rounded-md text-foreground-muted transition-colors duration-150 ease-out hover:bg-primary-subtle hover:text-foreground"
      aria-label="Close details panel"
    >
      <PanelRight class="size-4" />
    </button>
  </div>
  <div class="flex-1 overflow-y-auto p-(--pad-x) text-(--font-body) text-foreground-muted">
    {#if isEmpty && emptyState}
      {@render emptyState()}
    {:else}
      {@render children?.()}
    {/if}
  </div>
</div>
