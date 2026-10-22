<script lang="ts">
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import { Button } from "$lib/components/ui/button";
  import { ledger, worldNameOf } from "$lib/stores/ledger.svelte";
  import { CircleX, LoaderCircle } from "@lucide/svelte";
  import { revealItemInDir } from "@tauri-apps/plugin-opener";

  // Shown when open_ledger reported ERR_DB_CORRUPT and no usable snapshot
  // exists (issue #116). Real scene, pin and Quick Note loss is on the table
  // (Quick Notes are database-only by ADR-0018), so this is the one recovery
  // path that asks first — auto-restore (snapshot present) happens without a
  // dialog.
  //
  // Revised in the 2026-10 design review: it names the world (over the Example World
  // it read as if the world on screen were damaged), says what Rebuild brings back —
  // notes, and maps from their images — and what it can't, rather than "map details";
  // shows the kept file rather than pointing at a folder; and can't be closed while
  // rebuilding. A failed rebuild is said here, not in a passing toast, and what was
  // recovered is said after, lastingly (`toastDbRebuilt`).
  let isRebuilding = $state(false);

  const world = $derived(ledger.corruptLedgerPath ? worldNameOf(ledger.corruptLedgerPath) : "");

  async function handleRebuild() {
    isRebuilding = true;
    try {
      await ledger.rebuildCorruptLedger();
    } catch {
      // Said in the dialog (`ledger.rebuildError`); it stays open to try again.
    } finally {
      isRebuilding = false;
    }
  }

  /** The damaged database as it sits now, before a rebuild moves it aside. */
  function showDamagedFile() {
    const root = ledger.corruptLedgerPath;
    if (!root) return;
    const sep = root.includes("\\") ? "\\" : "/";
    const file = [root.replace(/[\\/]+$/, ""), ".grimoire", "ledger.db"].join(sep);
    void revealItemInDir(file).catch(() => {});
  }
</script>

<AlertDialog.Root
  open={ledger.corruptLedgerPath !== null}
  onOpenChange={(v) => {
    if (!v && !isRebuilding) ledger.dismissCorruptLedger();
  }}
>
  <AlertDialog.Content
    data-testid="db-recovery-dialog"
    class="data-[size=default]:sm:max-w-md"
    escapeKeydownBehavior={isRebuilding ? "ignore" : "close"}
  >
    <AlertDialog.Header>
      <AlertDialog.Title>“{world}” can't open as it is</AlertDialog.Title>
      <AlertDialog.Description class="flex flex-col gap-2 text-(length:--font-ui)">
        <span>
          Its database — where Grimoire keeps its scenes, maps and their pins, and Quick Notes — is
          damaged, and there's no backup to restore it from.
        </span>
        <span>
          Rebuilding brings back every note from its file, and each map from its image, without its
          pins. Scenes and Quick Notes can't be brought back.
        </span>
        <span>
          The damaged file is kept, untouched, if you'd like to try recovering it with another tool
          first.
        </span>
      </AlertDialog.Description>
    </AlertDialog.Header>

    {#if ledger.rebuildError}
      <p
        role="alert"
        data-testid="db-recovery-error"
        class="flex items-start gap-1.5 text-(length:--font-ui) text-error"
      >
        <CircleX size={14} class="mt-0.5 shrink-0" aria-hidden="true" />
        Couldn't rebuild it: {ledger.rebuildError}
      </p>
    {/if}

    <div class="flex items-center gap-2">
      <Button
        variant="ghost"
        class="mr-auto text-muted-foreground"
        data-testid="db-recovery-show-file"
        onclick={showDamagedFile}>Show damaged file</Button
      >
      <AlertDialog.Cancel
        data-testid="db-recovery-cancel"
        disabled={isRebuilding}
        onclick={() => ledger.dismissCorruptLedger()}>Not now</AlertDialog.Cancel
      >
      <AlertDialog.Action
        data-testid="db-recovery-rebuild"
        disabled={isRebuilding}
        onclick={(e: MouseEvent) => {
          // The dialog closes itself when the rebuild succeeds; until then it stays.
          e.preventDefault();
          void handleRebuild();
        }}
      >
        {#if isRebuilding}
          <LoaderCircle class="size-3.5 animate-spin" aria-hidden="true" />
          Rebuilding…
        {:else}
          Rebuild from notes
        {/if}
      </AlertDialog.Action>
    </div>
  </AlertDialog.Content>
</AlertDialog.Root>
