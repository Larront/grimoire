<script lang="ts">
  /*
    Making a ledger from the Splash: a name and a folder (NewLedgerFields, shared with
    the Adopt dialog), then Create ledger. It takes the right-hand column, where the
    ledgers were, so the left side — and the wordmark — stays where it is. Its title is
    a heading, not a small label stacked over the Name label, and Cancel or Escape
    gives focus back to New ledger.
  */
  import { Button } from "$lib/components/ui/button";
  import { LoaderCircle } from "@lucide/svelte";
  import NewLedgerFields from "$lib/components/NewLedgerFields.svelte";

  let {
    name = $bindable(""),
    parent = $bindable(null),
    attempted,
    creating,
    onSubmit,
    onCancel,
  }: {
    name?: string;
    parent?: string | null;
    attempted: boolean;
    creating: boolean;
    onSubmit: () => void;
    onCancel: () => void;
  } = $props();
</script>

<section class="flex max-w-[24rem] flex-col gap-4 splash-fade" aria-labelledby="splash-new-world">
  <h2 id="splash-new-world" class="text-base font-semibold text-foreground">New ledger</h2>
  <NewLedgerFields
    bind:name
    bind:parent
    placeholder="Name your ledger"
    disabled={creating}
    {attempted}
    {onSubmit}
    {onCancel}
  />
  <div class="mt-1 flex justify-end gap-2">
    <Button variant="ghost" disabled={creating} onclick={onCancel}>Cancel</Button>
    <Button disabled={creating} onclick={onSubmit}>
      {#if creating}
        <LoaderCircle class="animate-spin" />
        Creating…
      {:else}
        Create ledger
      {/if}
    </Button>
  </div>
</section>
