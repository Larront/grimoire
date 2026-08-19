<script lang="ts">
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import { ledger } from "$lib/stores/ledger.svelte";
  import { LoaderCircle } from "@lucide/svelte";

  // The consent prompt in front of a [[Format Migration]] (ADR-0017, #184).
  //
  // Every specific word here comes from the plan the scan produced: the count,
  // one sentence per pending migration that found work, and the warnings. The
  // dialog itself owns only the frame and the two buttons, which is what lets a
  // vault three versions behind render correctly with nobody editing this file.
  //
  // Generic copy — "some things are written differently" — was cheaper and rots
  // in a specific way: it gives the GM nothing to weigh, so the yes becomes
  // reflexive, and a reflexive yes to a mass rewrite of someone's campaign is
  // exactly what consent was for.
  let isMigrating = $state(false);

  const plan = $derived(ledger.formatMigration?.plan ?? null);
  // Composed as strings rather than inline markup: the count and its noun have to
  // read as one phrase, and template whitespace would put a line break inside it.
  const count = $derived(
    plan ? `${plan.file_count} ${plan.file_count === 1 ? "note" : "notes"}` : "",
  );
  const heading = $derived(
    `${count} in this ledger need${plan?.file_count === 1 ? "s" : ""} updating`,
  );

  async function handleMigrate() {
    isMigrating = true;
    try {
      await ledger.migrateLedgerFormat();
    } catch {
      // The command wrapper toasted the failure. Keep the dialog open so the GM
      // can retry or back out — a silent close would leave them at the welcome
      // screen with no idea whether their notes had been touched.
    } finally {
      isMigrating = false;
    }
  }
</script>

<!-- Not dismissible while the pass is running: the notes are being rewritten, and
     a dismissal that only cleared this state would leave the GM watching nothing
     happen while the migration finished and opened the ledger behind it. -->
<AlertDialog.Root
  open={plan !== null}
  onOpenChange={(v) => {
    if (!v && !isMigrating) ledger.dismissFormatMigration();
  }}
>
  <AlertDialog.Portal>
    <AlertDialog.Overlay />
    <AlertDialog.Content data-testid="format-migration-dialog">
      <AlertDialog.Header>
        <AlertDialog.Title>{heading}</AlertDialog.Title>
        <AlertDialog.Description>
          Grimoire has changed how it writes part of your notes. Opening this ledger rewrites {count}
          on disk, once.
        </AlertDialog.Description>
      </AlertDialog.Header>

      {#if plan}
        <div class="space-y-3 text-sm">
          <ul class="text-muted-foreground list-disc space-y-2 pl-5">
            {#each plan.sentences as sentence (sentence)}
              <li>{sentence}</li>
            {/each}
          </ul>

          {#if plan.warnings.length > 0}
            <!-- The one part of the change that edits the GM's own prose rather
                 than Grimoire's syntax, and therefore the part most deserving of
                 being asked about. Named per file, because that is what a GM can
                 act on. -->
            <div class="border-border bg-muted/40 space-y-1.5 rounded-md border p-3">
              <p class="font-medium">
                {plan.warnings.length === 1
                  ? "One line of your own writing changes:"
                  : `${plan.warnings.length} lines of your own writing change:`}
              </p>
              <ul class="text-muted-foreground max-h-32 list-disc space-y-1 overflow-y-auto pl-5">
                {#each plan.warnings as warning (warning)}
                  <li>{warning}</li>
                {/each}
              </ul>
            </div>
          {/if}

          <p class="text-muted-foreground">
            Every note it touches is copied first — plain markdown files inside this ledger's <code
              >.grimoire</code
            > folder, with a report of everything that changed. If you'd rather not, this ledger won't
            be opened and nothing is written.
          </p>
        </div>
      {/if}

      <AlertDialog.Footer>
        <!-- Guarded rather than `disabled`: bits-ui's Cancel does not forward that
             attribute, and there is nothing to cancel anyway — the pass cannot be
             stopped once it is rewriting, so the honest behaviour is to refuse the
             click and say so through `aria-disabled`. -->
        <AlertDialog.Cancel
          data-testid="format-migration-cancel"
          aria-disabled={isMigrating}
          class={isMigrating ? "pointer-events-none opacity-50" : undefined}
          onclick={() => {
            if (!isMigrating) ledger.dismissFormatMigration();
          }}>Don't open</AlertDialog.Cancel
        >
        <AlertDialog.Action
          data-testid="format-migration-confirm"
          disabled={isMigrating}
          onclick={handleMigrate}
        >
          {#if isMigrating}
            <LoaderCircle class="size-3.5 animate-spin" />
            Updating…
          {:else}
            Update {count}
          {/if}
        </AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>
