<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import { MapPin } from "@lucide/svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import type { UnlinkedPin } from "$lib/stores/ledger.svelte";

  // The other half of the repair message (#224). The toast says pins lost their
  // note; this says *which* pins and on which map, and takes the GM to one — a
  // report they cannot act on would be worse than saying nothing at all.
  let {
    open = $bindable(false),
    pins,
  }: {
    open: boolean;
    pins: UnlinkedPin[];
  } = $props();

  function goToMap(pin: UnlinkedPin) {
    open = false;
    tabs.navigateOpen({ type: "map", id: pin.map_id, title: pin.map_title });
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Pins that need their note again</Dialog.Title>
      <Dialog.Description>
        Opening this ledger repaired some of its bookkeeping. Every note came
        through unchanged, but {pins.length === 1 ? "this pin" : "these pins"} lost
        the link to {pins.length === 1 ? "its" : "their"} note along the way. Open
        a map to re-link {pins.length === 1 ? "it" : "them"}.
      </Dialog.Description>
    </Dialog.Header>

    <ul class="flex max-h-72 flex-col gap-1 overflow-y-auto py-1 text-sm">
      {#each pins as pin (pin.pin_id)}
        <li>
          <button
            type="button"
            onclick={() => goToMap(pin)}
            class="flex w-full items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-left transition-colors hover:bg-accent"
          >
            <MapPin class="size-4 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate font-medium text-foreground">
              {pin.pin_title}
            </span>
            <span class="shrink-0 text-muted-foreground">{pin.map_title}</span>
          </button>
        </li>
      {/each}
    </ul>
  </Dialog.Content>
</Dialog.Root>
