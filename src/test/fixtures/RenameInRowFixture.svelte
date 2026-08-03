<script lang="ts">
  // A stand-in for the rows a rename field lives inside: a file-tree folder or
  // a scene card, both of which treat Space and Enter as "activate me". The
  // rename field is deliberately nested inside that row, so the tests exercise
  // whether keys typed into the field leak out to the row.
  import * as Rename from "$lib/components/ui/rename";

  let { name = "Old Name" }: { name?: string } = $props();

  // svelte-ignore state_referenced_locally
  let _value = $state(name);
  let _mode = $state<"edit" | "view">("edit");
  let _activations = $state(0);
  let _saved = $state<string[]>([]);

  export const activations = () => _activations;
  export const saved = () => [..._saved];
  export const mode = () => _mode;
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  data-testid="row"
  role="button"
  tabindex="0"
  onclick={() => (_activations += 1)}
  onkeydown={(e) => {
    // Mirrors bits-ui's collapsible trigger, which is the real ancestor in the
    // file tree: it claims Space and Enter *and* preventDefaults them, which is
    // why the space never even reached the input.
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      _activations += 1;
    }
  }}
>
  <Rename.Root
    this="span"
    bind:value={_value}
    bind:mode={_mode}
    blurBehavior="exit"
    onSave={(val) => {
      _saved = [..._saved, val];
    }}
  />
</div>
