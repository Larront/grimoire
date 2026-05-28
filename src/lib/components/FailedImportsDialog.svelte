<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import type { FailedImport } from '$lib/stores/ledger.svelte';

  let {
    open = $bindable(false),
    failures,
  }: {
    open: boolean;
    failures: FailedImport[];
  } = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Import failures</Dialog.Title>
      <Dialog.Description>
        {failures.length} file{failures.length === 1 ? '' : 's'} could not be imported.
      </Dialog.Description>
    </Dialog.Header>

    <ul class="flex flex-col gap-1 max-h-72 overflow-y-auto py-1 text-sm">
      {#each failures as { path, reason } (path)}
        <li class="flex flex-col gap-0.5 rounded-md px-2 py-1.5 bg-muted/50">
          <span class="font-medium text-foreground break-all">{path}</span>
          <span class="text-foreground-muted">{reason}</span>
        </li>
      {/each}
    </ul>
  </Dialog.Content>
</Dialog.Root>
