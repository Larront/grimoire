<script lang="ts">
  // A stand-in Row List consumer for the Row List's tests. Its rows are plain
  // strings drawn by its own snippet — deliberately not `Label: value`, so the
  // list's claim to know nothing about a row's content is exercised rather than
  // described.
  import RowList from "$lib/components/editor/RowList.svelte";
  import { remapRowIndices, type RowChange } from "$lib/editor/row-list";

  let { rows = [] }: { rows?: string[] } = $props();

  // svelte-ignore state_referenced_locally
  let _rows = $state<string[]>([...rows]);
  let _changes = $state<RowChange[]>([]);
  let _focusOuts = $state<{ index: number; contained: HTMLElement }[]>([]);
  // Stands in for view state a block keys by row index, to prove the change
  // descriptor is enough to carry it along.
  let _marked = $state(new Set<number>());

  export const rowsNow = () => $state.snapshot(_rows);
  export const changes = () => $state.snapshot(_changes);
  export const focusOuts = () => _focusOuts;
  export const marked = () => [..._marked].sort((a, b) => a - b);
</script>

<RowList
  rows={_rows}
  noun="thing"
  createRow={() => "fresh"}
  onChange={(next, change) => {
    _rows = next;
    _changes = [..._changes, change];
    _marked = remapRowIndices(_marked, change);
  }}
  onRowFocusOut={(index, rowEl) => {
    _focusOuts = [..._focusOuts, { index, contained: rowEl }];
  }}
>
  {#snippet row(item, i)}
    <div class="flex-1">
      <button type="button" onclick={() => (_marked = new Set([..._marked, i]))}>
        {item}
      </button>
    </div>
  {/snippet}
</RowList>
