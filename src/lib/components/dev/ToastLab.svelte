<!--
  Dev-only toast harness. Fires every toast $lib/toast can produce so the whole
  family can be reviewed on demand instead of by provoking real failures.

  This never reaches a release build: +layout.svelte imports it dynamically
  behind `import.meta.env.DEV`, which Vite replaces with `false` for production,
  so the branch and the import are both eliminated and this file is not in the
  bundle.

  Theme, accent preset, density and reduce-motion are deliberately NOT duplicated
  here — they are real ledger settings, so change them in Settings and the panel
  stays open beside them. What you see is then exactly what the app renders.

  To remove the harness: delete this file and the ToastLab block in
  src/routes/+layout.svelte.
-->
<script lang="ts">
  import { toast } from "svelte-sonner";
  import { FlaskConical, X } from "@lucide/svelte";
  import {
    toastError,
    toastSuccess,
    toastUndo,
    toastImportFailures,
    toastExternalMoveLinks,
    toastMigrationReport,
  } from "$lib/toast";

  let open = $state(false);

  const REPORT_PATH =
    "C:/Ledgers/Aurelia/.grimoire/backup/2026-08-13-143022/report.md";

  const cases: { label: string; hint: string; fire: () => void }[] = [
    {
      label: "Error",
      hint: "hue spine + tint, close button",
      fire: () => toastError("Couldn't save 'Harbour Watch'"),
    },
    {
      label: "Error, two lines",
      hint: "icon centring on a wrapped title",
      fire: () =>
        toastError(
          "Couldn't save 'Harbour Watch' — the file is open in another program",
        ),
    },
    {
      label: "Success",
      hint: "success spine + tint",
      fire: () => toastSuccess("Scene saved"),
    },
    {
      label: "Undo",
      hint: "neutral, accent spine, one action",
      fire: () =>
        toastUndo("Deleted 'Harbour Watch'", () =>
          console.log("[toast lab] undo window elapsed"),
        ),
    },
    {
      label: "Import failures",
      hint: "error + action button",
      fire: () =>
        toastImportFailures(
          [
            { path: "notes/keep.md", reason: "unreadable frontmatter" },
            { path: "notes/harbour.md", reason: "not UTF-8" },
            { path: "notes/aurelia.md", reason: "empty file" },
          ],
          () => toastSuccess("Show details clicked"),
        ),
    },
    {
      label: "External move",
      hint: "persistent, cancel + action on their own row",
      fire: () =>
        toastExternalMoveLinks("Harbour Watch", 4, () =>
          toastSuccess("Backlinks updated"),
        ),
    },
    {
      label: "Migration, clean",
      hint: "neutral with a description",
      fire: () =>
        toastMigrationReport({
          migrated: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"],
          failed: [],
          report_path: REPORT_PATH,
        }),
    },
    {
      label: "Migration, partial",
      hint: "persistent error + long description",
      fire: () =>
        toastMigrationReport({
          migrated: ["a", "b"],
          failed: [{ path: "notes/keep.md", reason: "unparseable" }],
          report_path: REPORT_PATH,
        }),
    },
  ];

  function fireAll() {
    toastError("Couldn't save 'Harbour Watch'");
    toastSuccess("Scene saved");
    toastExternalMoveLinks("Harbour Watch", 4, () => {});
  }

  // Dismissed one at a time, with a gap. svelte-sonner corrupts its own height
  // table when several toasts unmount in the same update — it throws reading
  // `height.toastId` of an undefined entry, the unmount aborts, and the dead
  // nodes stay in the DOM. Both `toast.dismiss()` and a synchronous per-id loop
  // hit that; letting each removal settle first does not. (The same throw
  // happens upstream whenever three toasts merely stack, with or without this
  // harness — there it is only console noise, since expiry still cleans up.)
  async function dismissAll() {
    for (const t of toast.getActiveToasts()) {
      toast.dismiss(t.id);
      await new Promise((r) => setTimeout(r, 120));
    }
  }
</script>

<div class="fixed bottom-4 left-4 z-[9998] font-sans">
  {#if open}
    <div
      class="w-64 rounded-lg border border-dashed border-background-border bg-background-elevated p-3"
    >
      <div class="mb-2 flex items-center justify-between">
        <span
          class="font-mono text-[10.5px] uppercase tracking-[0.1em] text-foreground-faint"
        >
          Toast lab · dev
        </span>
        <button
          aria-label="Close toast lab"
          onclick={() => (open = false)}
          class="rounded p-1 text-foreground-muted transition-colors duration-150 ease-out hover:bg-hover-overlay hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>

      <div class="flex flex-col gap-1">
        {#each cases as c (c.label)}
          <button
            onclick={c.fire}
            title={c.hint}
            class="rounded px-2 py-1 text-left text-[13px] text-foreground transition-colors duration-150 ease-out hover:bg-primary-subtle"
          >
            {c.label}
          </button>
        {/each}
      </div>

      <div
        class="mt-2 flex gap-1 border-t border-background-border pt-2 text-[13px]"
      >
        <button
          onclick={fireAll}
          class="flex-1 rounded px-2 py-1 text-foreground-muted transition-colors duration-150 ease-out hover:bg-hover-overlay hover:text-foreground"
        >
          Stack of 3
        </button>
        <button
          onclick={dismissAll}
          class="flex-1 rounded px-2 py-1 text-foreground-muted transition-colors duration-150 ease-out hover:bg-hover-overlay hover:text-foreground"
        >
          Dismiss all
        </button>
      </div>

      <p class="mt-2 text-[11px] leading-snug text-foreground-faint">
        Theme, accent and density are real settings — change them in Settings and
        this stays open.
      </p>
    </div>
  {:else}
    <button
      onclick={() => (open = true)}
      title="Dev: fire toasts"
      class="flex items-center gap-1.5 rounded-md border border-dashed border-background-border bg-background-elevated px-2 py-1 text-[11px] text-foreground-muted transition-colors duration-150 ease-out hover:text-foreground"
    >
      <FlaskConical size={13} />
      Toasts
    </button>
  {/if}
</div>
