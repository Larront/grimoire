<script lang="ts">
  // A stand-in sealed Note Block view for the node-view connector's tests: the
  // smallest thing that has attributes, a write-back and a selected state.
  let {
    label = "",
    count = 0,
    onUpdate,
  }: {
    label?: string;
    count?: number;
    onUpdate?: (partial: Record<string, unknown>) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let _label = $state(label);
  // svelte-ignore state_referenced_locally
  let _count = $state(count);
  let _selected = $state(false);

  export function setAttrs(attrs: { label: string; count: number }) {
    _label = attrs.label;
    _count = attrs.count;
  }

  export function setSelected(value: boolean) {
    _selected = value;
  }
</script>

<p data-fixture-label data-selected={_selected}>{_label}/{_count}</p>
<button type="button" onclick={() => onUpdate?.({ count: _count + 1 })}>bump</button>
