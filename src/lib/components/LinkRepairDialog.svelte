<script lang="ts">
  /*
    Links that point to where a note used to be, and the note each could mean now — the
    "Repair links" tool (ADR-0014's escape hatch for the bulk path, 2026-10 design
    review). Nothing is rewritten until the GM chooses Update, and only the links they
    ticked: the GM's documents are never rewritten without being asked.

    A link with one note of its name is ticked and ready. One with several waits for the
    GM to choose which (the owner's choice), and is left alone if they don't.
  */
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { ChoiceGroup } from "$lib/components/ui/choice-group";
  import { ArrowRight, LoaderCircle } from "@lucide/svelte";
  import { linkRepairs } from "$lib/stores/link-repairs.svelte";
  import type { LinkRepair } from "$lib/bindings.gen";

  /** The note each link will point at, by target; absent until chosen. */
  let chosen = $state<Record<string, number>>({});
  /** The links the GM has set aside, by target. */
  let unticked = $state<Record<string, boolean>>({});
  let updating = $state(false);
  let list = $state<HTMLElement | null>(null);

  // Seeded each time the list is opened, from the list as found then.
  $effect(() => {
    if (!linkRepairs.open) return;
    const seed: Record<string, number> = {};
    for (const r of linkRepairs.repairs) {
      if (r.candidates.length === 1) seed[r.target] = r.candidates[0].id;
    }
    chosen = seed;
    unticked = {};
  });

  const ticked = $derived(
    linkRepairs.repairs.filter((r) => chosen[r.target] !== undefined && !unticked[r.target]),
  );
  const tickedLinks = $derived(ticked.reduce((n, r) => n + r.sources.length, 0));
  const updateLabel = $derived(`Update ${tickedLinks} ${tickedLinks === 1 ? "link" : "links"}`);

  /** A path as the GM reads it: no `.md`. */
  const shown = (path: string) => path.replace(/\.md$/i, "");

  /** "In Harbor and Mira", "In Harbor, Mira and 3 more". */
  function heldBy(r: LinkRepair): string {
    const names = r.sources.map((s) => s.title);
    if (names.length === 1) return `In ${names[0]}`;
    if (names.length <= 3) return `In ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    return `In ${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
  }

  function choose(r: LinkRepair, id: string) {
    chosen[r.target] = Number(id);
    unticked[r.target] = false;
  }

  async function update() {
    updating = true;
    try {
      await linkRepairs.apply(
        ticked.map((r) => ({ target: r.target, note_id: chosen[r.target] })),
      );
    } catch {
      // The api has said why; the list stays open to try again.
    } finally {
      updating = false;
    }
  }
</script>

<Dialog.Root bind:open={linkRepairs.open}>
  <Dialog.Content
    data-testid="link-repair-dialog"
    class="sm:max-w-lg w-full max-h-[min(80vh,640px)] flex flex-col p-0 gap-0 overflow-hidden"
    onOpenAutoFocus={(e) => {
      // The list, not its first checkbox: a ring on a ticked box read as a choice
      // being made, as it did on the pins dialog. Tab walks in from here.
      // With nothing to repair there is no list, and Close takes the focus.
      if (!list) return;
      e.preventDefault();
      list.focus();
    }}
  >
    <Dialog.Header class="px-5 pt-5 pb-3 border-b border-border shrink-0 text-left">
      <Dialog.Title>Repair links</Dialog.Title>
      <Dialog.Description class="text-(length:--font-ui) text-foreground-muted">
        {#if linkRepairs.repairs.length}
          These links point to where a note used to be. A note with the same name is somewhere
          else now. Update points each ticked link at it; the rest stay as they are.
        {:else}
          No links need repairing. Links to notes you haven't written yet are left as they are.
        {/if}
      </Dialog.Description>
    </Dialog.Header>

    {#if linkRepairs.repairs.length}
      <ul
        bind:this={list}
        tabindex="-1"
        class="min-h-0 flex-1 overflow-y-auto px-3 py-2 outline-none"
        data-pane-scroll
      >
        {#each linkRepairs.repairs as r (r.target)}
          {@const id = `repair-${r.target}`}
          {@const choice = chosen[r.target]}
          {@const many = r.candidates.length > 1}
          <li
            data-testid="link-repair-row"
            class="flex gap-3 px-2 py-2.5 not-first:border-t not-first:border-border"
          >
            <input
              {id}
              type="checkbox"
              class="mt-1 size-3.5 shrink-0 accent-primary"
              checked={choice !== undefined && !unticked[r.target]}
              disabled={choice === undefined}
              aria-label="Update links to {shown(r.target)}"
              onchange={(e) => (unticked[r.target] = !e.currentTarget.checked)}
            />
            <div class="flex min-w-0 flex-1 flex-col gap-1.5">
              <label
                for={id}
                class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-(length:--font-ui)"
              >
                <span class="break-all text-foreground-muted">{shown(r.target)}</span>
                <ArrowRight class="size-3.5 shrink-0 text-foreground-muted" aria-hidden="true" />
                {#if !many}
                  <span class="break-all text-foreground">{shown(r.candidates[0].path)}</span>
                {:else}
                  <span class="text-foreground">which one?</span>
                {/if}
              </label>
              {#if many}
                <ChoiceGroup
                  label="Which note {shown(r.target)} means"
                  options={r.candidates.map((c) => ({ value: String(c.id), label: shown(c.path) }))}
                  value={choice === undefined ? "" : String(choice)}
                  onChange={(v) => choose(r, v)}
                  class="flex flex-col"
                  optionClass={(selected) =>
                    `flex min-h-7 items-center gap-2 rounded-sm px-1 text-left text-(length:--font-ui) hover:bg-surface-hover focus-visible:bg-surface-hover ${
                      selected ? "text-foreground" : "text-foreground-muted"
                    }`}
                >
                  {#snippet option(item, selected)}
                    <span
                      class="grid size-3.5 shrink-0 place-items-center rounded-full border {selected
                        ? 'border-primary'
                        : 'border-foreground-muted'}"
                      aria-hidden="true"
                    >
                      {#if selected}<span class="size-1.5 rounded-full bg-primary"></span>{/if}
                    </span>
                    <span class="break-all">{item.label}</span>
                  {/snippet}
                </ChoiceGroup>
              {/if}
              <span class="text-xs text-muted-foreground">{heldBy(r)}</span>
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <Dialog.Footer class="m-0 rounded-none px-5 py-3">
      {#if linkRepairs.repairs.length}
        <Button variant="outline" data-testid="link-repair-leave" onclick={() => linkRepairs.leave()}
          >Leave them</Button
        >
        <Button data-testid="link-repair-update" disabled={!tickedLinks || updating} onclick={update}>
          {#if updating}
            <LoaderCircle class="size-3.5 animate-spin" aria-hidden="true" />
            Updating…
          {:else}
            {updateLabel}
          {/if}
        </Button>
      {:else}
        <Button variant="outline" onclick={() => (linkRepairs.open = false)}>Close</Button>
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
