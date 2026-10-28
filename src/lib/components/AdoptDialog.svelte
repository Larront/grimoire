<script lang="ts">
  /*
    Make this ledger mine — keep the example, edits and all, as the GM's own.

    Revised in the 2026-10 design review:
    - It never copies over a folder that exists. It used to delete one with the same
      name in the chosen place, then put the example there; the backend now refuses
      and this says so under the name.
    - It says what will happen — a new folder, the edits with it, the example left to
      explore — and "Make it mine" is always pressable: pressed too early, it says
      what is missing beside that field rather than sitting greyed out with no reason.
    - It can't be closed while the copy runs, and the world it made is named in a
      toast when it opens.
    - Mounted by the shell, not the sidebar, which unmounts below 1024px and took the
      dialog and the typed name with it.
  */
  import { untrack } from "svelte";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { CircleX, LoaderCircle } from "@lucide/svelte";
  import NewLedgerFields from "$lib/components/NewLedgerFields.svelte";
  import { ledger } from "$lib/stores/ledger.svelte";
  import { toastSuccess } from "$lib/toast";
  import { fieldsReady, shortPath } from "$lib/utils/ledger-name";

  let { open = $bindable(false) }: { open: boolean } = $props();

  let name = $state("");
  let parent = $state<string | null>(null);
  let attempted = $state(false);
  let copying = $state(false);
  /** The backend refused this name in this folder: something is already there. */
  let refused = $state<string | null>(null);
  /** The copy failed for any other reason. */
  let failed = $state<string | null>(null);

  // A refusal is about the name and folder it was given for; change either and it goes.
  $effect(() => {
    void name;
    void parent;
    untrack(() => {
      refused = null;
      failed = null;
    });
  });

  function reset() {
    name = "";
    parent = null;
    attempted = false;
    copying = false;
    refused = null;
    failed = null;
  }

  function cancel() {
    if (copying) return;
    open = false;
    reset();
  }

  async function confirm() {
    attempted = true;
    if (copying || !fieldsReady(name, parent)) return;
    const world = name.trim();
    const folder = parent;
    copying = true;
    refused = null;
    failed = null;
    try {
      await ledger.adopt(folder, world);
      open = false;
      reset();
      toastSuccess(`“${world}” is yours. It's saved in ${shortPath(folder)}.`);
    } catch (e) {
      // The raw error is in the log; the GM gets what to do about it.
      if (String(e).includes("LEDGER_EXISTS")) {
        refused = `There's already a folder called “${world}” there. Choose another name or folder.`;
      } else {
        failed = "Couldn't copy the ledger there. Try another folder.";
      }
    } finally {
      copying = false;
    }
  }
</script>

<Dialog.Root
  bind:open
  onOpenChange={(v) => {
    if (!v) reset();
  }}
>
  <Dialog.Content
    showCloseButton={false}
    class="sm:max-w-md"
    escapeKeydownBehavior={copying ? "ignore" : "close"}
    interactOutsideBehavior={copying ? "ignore" : "close"}
  >
    <div data-testid="adopt-dialog" class="flex min-w-0 flex-col gap-5">
      <Dialog.Header>
        <Dialog.Title>Make this ledger mine</Dialog.Title>
        <Dialog.Description>
          Grimoire copies this ledger, with everything you've changed, into a new folder and opens it
          as yours. The example stays as it is, to come back to from the Splash or start over.
        </Dialog.Description>
      </Dialog.Header>

      <NewLedgerFields
        bind:name
        bind:parent
        placeholder="Name your ledger"
        disabled={copying}
        {attempted}
        nameRefused={refused}
        onSubmit={() => void confirm()}
        onCancel={cancel}
      />

      {#if failed}
        <p
          data-testid="adopt-error"
          role="alert"
          class="flex items-start gap-1.5 text-(length:--font-ui) text-error"
        >
          <CircleX size={14} class="mt-0.5 shrink-0" aria-hidden="true" />
          {failed}
        </p>
      {/if}

      <div class="flex justify-end gap-2">
        <Button variant="ghost" onclick={cancel} disabled={copying}>Cancel</Button>
        <Button data-testid="adopt-confirm-btn" onclick={() => void confirm()} disabled={copying}>
          {#if copying}
            <LoaderCircle class="animate-spin" aria-hidden="true" />
            Copying…
          {:else}
            Make it mine
          {/if}
        </Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
