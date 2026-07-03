<script lang="ts">
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import { ledger } from "$lib/stores/ledger.svelte";
  import { LoaderCircle } from "@lucide/svelte";

  // Shown when open_ledger reported ERR_DB_CORRUPT and no usable snapshot
  // exists (issue #116). Real scene/pin loss is on the table, so this is the
  // one recovery path that asks first — auto-restore (snapshot present)
  // happens without a dialog.
  let isRebuilding = $state(false);

  async function handleRebuild() {
    isRebuilding = true;
    try {
      await ledger.rebuildCorruptLedger();
    } catch {
      // Error state is surfaced by the command wrapper's toast; keep the
      // dialog open so the GM can retry or cancel.
    } finally {
      isRebuilding = false;
    }
  }
</script>

<AlertDialog.Root
  open={ledger.corruptLedgerPath !== null}
  onOpenChange={(v) => {
    if (!v) ledger.dismissCorruptLedger();
  }}
>
  <AlertDialog.Portal>
    <AlertDialog.Overlay />
    <AlertDialog.Content data-testid="db-recovery-dialog">
      <AlertDialog.Header>
        <AlertDialog.Title>This ledger's database is damaged</AlertDialog.Title>
        <AlertDialog.Description>
          No backup exists yet. Rebuilding recovers every note from its file,
          but scenes, pins, and map details will be lost. The damaged database
          file is kept inside the ledger's <code>.grimoire</code> folder in
          case you want to attempt recovery with another tool first.
        </AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel
          data-testid="db-recovery-cancel"
          onclick={() => ledger.dismissCorruptLedger()}
        >Cancel</AlertDialog.Cancel>
        <AlertDialog.Action
          data-testid="db-recovery-rebuild"
          disabled={isRebuilding}
          onclick={handleRebuild}
        >
          {#if isRebuilding}
            <LoaderCircle class="size-3.5 animate-spin" />
            Rebuilding…
          {:else}
            Rebuild ledger
          {/if}
        </AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>
