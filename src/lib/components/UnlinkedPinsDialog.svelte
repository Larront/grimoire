<script lang="ts">
  /*
    The pins a repair left without their note, and the way to each (#224).

    The toast says pins lost their note; this says which, on which map, and which note
    each one used to open — and takes the GM to the pin, selected on its map with its
    note search ready. A report they cannot act on would be worse than saying nothing.

    Revised in the 2026-10 design review: grouped by map (the GM works one map at a time,
    and the map name no longer squeezes the pin's out of its row); each row says what the
    pin was linked to; choosing a row selects the pin rather than only opening its map;
    and the list is `unlinkedPins`, which shrinks as pins are fixed and outlives this
    dialog — the toast and the palette both bring it back.
  */
  import * as Dialog from "$lib/components/ui/dialog";
  import { MapPin } from "@lucide/svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { unlinkedPins } from "$lib/stores/unlinked-pins.svelte";
  import type { UnlinkedPin } from "$lib/bindings.gen";

  let list = $state<HTMLElement | null>(null);

  const one = $derived(unlinkedPins.count === 1);

  /** Pins under their map, maps in the order the repair met them. */
  const byMap = $derived.by(() => {
    const groups = new Map<number, { mapId: number; mapTitle: string; pins: UnlinkedPin[] }>();
    for (const pin of unlinkedPins.pins) {
      const group = groups.get(pin.map_id);
      if (group) group.pins.push(pin);
      else groups.set(pin.map_id, { mapId: pin.map_id, mapTitle: pin.map_title, pins: [pin] });
    }
    return [...groups.values()];
  });

  function goTo(pin: UnlinkedPin) {
    unlinkedPins.goToPin(pin);
    tabs.navigateOpen({ type: "map", id: pin.map_id, title: pin.map_title });
  }
</script>

<Dialog.Root bind:open={unlinkedPins.open}>
  <Dialog.Content
    data-testid="unlinked-pins-dialog"
    class="sm:max-w-md w-full max-h-[min(80vh,560px)] flex flex-col p-0 gap-0 overflow-hidden"
    onOpenAutoFocus={(e) => {
      // The list, not its first row: a ring on the first pin read as that pin being
      // chosen. Tab walks in from here.
      e.preventDefault();
      list?.focus();
    }}
  >
    <Dialog.Header class="px-5 pt-5 pb-3 border-b border-border shrink-0 text-left">
      <Dialog.Title>
        {one ? "A pin that needs its note again" : "Pins that need their note again"}
      </Dialog.Title>
      <Dialog.Description class="text-(length:--font-ui) text-foreground-muted">
        Grimoire repaired this world's records. Your notes are intact, but {one
          ? "this pin"
          : "these pins"} lost the link to {one ? "its" : "their"} note. Choose one to go to it on its
        map and link it again.
      </Dialog.Description>
    </Dialog.Header>

    <div bind:this={list} tabindex="-1" class="min-h-0 flex-1 overflow-y-auto p-2 outline-none">
      {#each byMap as group (group.mapId)}
        <section aria-labelledby="unlinked-map-{group.mapId}" class="not-first:mt-2">
          <h3
            id="unlinked-map-{group.mapId}"
            class="truncate px-2 pt-1 pb-1 text-xs font-semibold text-muted-foreground"
            title={group.mapTitle}
          >
            {group.mapTitle}
          </h3>
          <ul class="flex flex-col">
            {#each group.pins as pin (pin.pin_id)}
              <li>
                <button
                  type="button"
                  data-testid="unlinked-pin-row"
                  onclick={() => goTo(pin)}
                  aria-label="Go to {pin.pin_title} on {group.mapTitle}{pin.was_note_title
                    ? `, was linked to ${pin.was_note_title}`
                    : ''}"
                  class="flex min-h-(--row-h) w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left
                         text-(length:--font-ui) hover:bg-surface-hover focus-visible:bg-surface-hover"
                >
                  <MapPin class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span class="min-w-0 flex-1 truncate text-foreground" title={pin.pin_title}
                    >{pin.pin_title}</span
                  >
                  {#if pin.was_note_title}
                    <span
                      class="min-w-0 max-w-[50%] truncate text-muted-foreground"
                      title="Was linked to {pin.was_note_title}">was {pin.was_note_title}</span
                    >
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  </Dialog.Content>
</Dialog.Root>
