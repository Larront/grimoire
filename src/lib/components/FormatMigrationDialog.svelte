<script lang="ts">
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import { ledger, worldNameOf } from "$lib/stores/ledger.svelte";
  import { CircleX, LoaderCircle } from "@lucide/svelte";
  import type { MigrationPlan } from "$lib/bindings.gen";

  // The consent prompt in front of a [[Format Migration]] (ADR-0017, #184).
  //
  // Every specific word here comes from the plan the scan produced: the notes, one
  // line per pending migration that found work, and the warnings. The dialog owns
  // only the frame and the two buttons, which is what lets a vault three versions
  // behind render correctly with nobody editing this file.
  //
  // Revised in the 2026-10 design review, on the frame its sibling DbRecoveryDialog
  // had just been given: it names the world (over another one it read as that one
  // being rewritten), and the notes — by name, under their folders — rather than a
  // count. What changes is one short line each; the reasons are the report's. A
  // warning sits under the note it is about. Everything is in the description, so a
  // screen reader hears all of it, and it can't be closed while the update runs.
  let isMigrating = $state(false);

  // Rendered from the last plan, not the live one: the store clears the plan before
  // the close animation ends, and the prompt used to flash empty on its way out.
  let shown = $state<{ path: string; plan: MigrationPlan } | null>(null);
  $effect(() => {
    if (ledger.formatMigration) shown = ledger.formatMigration;
  });
  const plan = $derived(shown?.plan ?? null);
  const world = $derived(shown ? worldNameOf(shown.path) : "");
  /** The world is already open — reached by reopening it to finish an update. */
  const samePath = (a: string, b: string) => {
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    return norm(a) === norm(b);
  };
  const alreadyOpen = $derived(
    !!shown && ledger.isOpen && ledger.path !== null && samePath(ledger.path, shown.path),
  );

  const count = $derived(
    plan ? `${plan.file_count} ${plan.file_count === 1 ? "note" : "notes"}` : "",
  );

  /** A note as the GM knows it: its name, not its path. */
  function noteName(path: string): string {
    const name = path.split("/").pop()?.replace(/\.md$/i, "") ?? path;
    return path.startsWith(".grimoire/templates/") ? `${name} (template)` : name;
  }

  const SHOWN_NOTES = 8;
  /** Notes under their folders, as many as fit, then "and N more". */
  const groups = $derived.by(() => {
    if (!plan) return { folders: [], more: 0 };
    const folders = new Map<string, MigrationPlan["notes"]>();
    for (const note of plan.notes.slice(0, SHOWN_NOTES)) {
      const folder = note.path.startsWith(".grimoire/templates/")
        ? "Templates"
        : note.path.split("/").slice(0, -1).join("/") || world;
      folders.set(folder, [...(folders.get(folder) ?? []), note]);
    }
    return {
      folders: [...folders.entries()],
      more: Math.max(0, plan.notes.length - SHOWN_NOTES),
    };
  });

  const warningCount = $derived(plan?.warnings.length ?? 0);

  async function handleMigrate() {
    isMigrating = true;
    try {
      await ledger.migrateLedgerFormat();
    } catch {
      // Said in the dialog (`ledger.migrateError`); it stays open to try again or
      // back out — a silent close would leave the GM not knowing whether their
      // notes had been touched.
    } finally {
      isMigrating = false;
    }
  }
</script>

<!-- Not dismissible while the pass is running: the notes are being rewritten, and
     a dismissal that only cleared this state would leave the GM watching nothing
     happen while the migration finished and opened the ledger behind it. -->
<AlertDialog.Root
  open={ledger.formatMigration !== null}
  onOpenChange={(v) => {
    if (!v && !isMigrating) ledger.dismissFormatMigration();
  }}
>
  <AlertDialog.Content
    data-testid="format-migration-dialog"
    class="data-[size=default]:sm:max-w-md"
    escapeKeydownBehavior={isMigrating ? "ignore" : "close"}
  >
    <AlertDialog.Header>
      <AlertDialog.Title>“{world}” has {count} to update</AlertDialog.Title>
      <AlertDialog.Description class="flex flex-col gap-3 text-(length:--font-ui)">
        <p>
          Grimoire has changed how it writes part of your notes. Each note is copied before it's
          rewritten, once, and a report says what changed.
        </p>

        {#if plan}
          <ul class="list-disc space-y-1 pl-5" data-testid="format-migration-changes">
            {#each plan.changes as change (change)}
              <li>{change}</li>
            {/each}
          </ul>

          <div class="flex flex-col gap-2">
            {#if warningCount > 0}
              <p class="text-foreground">
                {warningCount === 1
                  ? "One line of your own writing changes — it's marked below."
                  : `${warningCount} lines of your own writing change — they're marked below.`}
              </p>
            {/if}
            <div
              data-pane-scroll
              data-testid="format-migration-notes"
              class="max-h-56 overflow-y-auto rounded-md border border-border px-3 py-2"
            >
              {#each groups.folders as [folder, notes] (folder)}
                <p class="pt-1 text-xs font-semibold text-muted-foreground" title={folder}>
                  {folder.split("/").pop()}
                </p>
                <ul class="mb-1">
                  {#each notes as note (note.path)}
                    <li class="py-0.5">
                      <span class="text-foreground" title={note.path}>{noteName(note.path)}</span>
                      {#each note.warnings as warning (warning)}
                        <span class="mt-0.5 block border-l-2 border-border pl-2 text-xs">
                          {warning}
                        </span>
                      {/each}
                    </li>
                  {/each}
                </ul>
              {/each}
              {#if groups.more > 0}
                <p class="pt-1 text-xs">and {groups.more} more — the report lists every one.</p>
              {/if}
            </div>
          </div>

          <p>
            The copies and the report go in this world's hidden <code class="font-mono text-xs"
              >.grimoire</code
            >
            folder.
            {alreadyOpen
              ? "If not now, it will ask again next time this ledger opens."
              : "If you'd rather not, the ledger won't open and nothing is written."}
          </p>
        {/if}
      </AlertDialog.Description>
    </AlertDialog.Header>

    {#if ledger.migrateError}
      <p
        role="alert"
        data-testid="format-migration-error"
        class="flex items-start gap-1.5 text-(length:--font-ui) text-error"
      >
        <CircleX size={14} class="mt-0.5 shrink-0" aria-hidden="true" />
        Couldn't update them: {ledger.migrateError}
      </p>
    {/if}

    <div class="flex items-center justify-end gap-2">
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
        }}>{alreadyOpen ? "Not now" : "Don't open"}</AlertDialog.Cancel
      >
      <AlertDialog.Action
        data-testid="format-migration-confirm"
        disabled={isMigrating}
        onclick={(e: MouseEvent) => {
          // The dialog closes itself when the update lands; until then it stays.
          e.preventDefault();
          void handleMigrate();
        }}
      >
        {#if isMigrating}
          <LoaderCircle class="size-3.5 animate-spin" aria-hidden="true" />
          Updating…
        {:else}
          Update {count}
        {/if}
      </AlertDialog.Action>
    </div>
  </AlertDialog.Content>
</AlertDialog.Root>
