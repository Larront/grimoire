<script lang="ts">
  // The Settings surface for [[Statblock Preset]]s (#179).
  //
  // It does two jobs and refuses a third. It **points this vault at a default**, and it
  // **renames and deletes** the shapes the GM has saved. It does not edit one: a preset
  // editor would be a second surface rendering an editable statblock, which ADR-0016
  // blames for the shipped blocks drifting. Changing a shape means stamping it into a
  // note, changing it there, and saving over the name.
  //
  // It is also **where a broken default is diagnosed**. Insertion is silent — a toast
  // fires mid-fight where the GM cannot act — so an unresolvable pointer stamps a blank
  // statblock and says so here instead, as `Goblin (not found)`. The dangling name is
  // kept rather than cleared: the presets file is shared across machines while the
  // pointer is not, so the preset may simply be somewhere else.
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Check, CircleX, Pencil, Trash2, X } from "@lucide/svelte";
  import {
    SHIPPED_PRESETS,
    isShippedName,
    type StatblockPreset,
  } from "$lib/editor/statblock-presets";
  import { statblockPresets } from "$lib/stores/statblock-presets.svelte";
  import { toastUndo } from "$lib/toast";

  let { open = false }: { open?: boolean } = $props();
  const id = $props.id();

  // Re-read on every open rather than trusting what is already in memory: the presets
  // file is app data, so a second Grimoire window on this machine can have changed it.
  $effect(() => {
    if (open) statblockPresets.reload();
  });

  const stored = $derived(statblockPresets.stored);
  const defaultName = $derived(statblockPresets.defaultName);
  const dangling = $derived(defaultName !== null && !statblockPresets.defaultResolves);

  // ── The default pointer ─────────────────────────────────────────────────────

  // "" is blank, which is the absence of a preset rather than one of them — there is no
  // shape to store for it, so choosing it clears the pointer.
  function chooseDefault(value: string) {
    statblockPresets.setDefault(value || null).catch(() => {});
  }

  // ── Rename ──────────────────────────────────────────────────────────────────

  let renaming = $state<string | null>(null);
  let draft = $state("");

  function startRename(preset: StatblockPreset) {
    renaming = preset.name;
    draft = preset.name;
  }

  /** A shipped name is not the GM's to take, so the field says so and Save stays shut. */
  const renameReserved = $derived(!!draft.trim() && isShippedName(draft));

  async function commitRename() {
    const from = renaming;
    const to = draft.trim();
    if (!from || renameReserved) return;
    renaming = null;
    if (!to || to === from) return;
    try {
      await statblockPresets.rename(from, to);
    } catch {
      // api.* has already toasted; the list is untouched, so nothing to undo here.
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  /**
   * Gone at once, with Undo (2026-10 design review). It asked first in a modal, which
   * DESIGN.md §6 refuses for a delete this cheap to reverse: the preset is text, and the
   * store still has it to save back. Statblocks already stamped from it are copies and
   * are untouched either way. A vault whose default named it keeps the name, so Undo puts
   * the default back as well.
   */
  async function remove(preset: StatblockPreset) {
    try {
      await statblockPresets.remove(preset.name);
    } catch {
      return; // api.* has already toasted.
    }
    toastUndo(
      `Deleted the “${preset.name}” preset`,
      () => {},
      () => void statblockPresets.save(preset.name, preset.fence).catch(() => {}),
    );
  }
</script>

<div class="flex flex-col divide-y divide-border">
  <!-- Default preset -->
  <div class="flex items-center justify-between gap-4 py-3 first:pt-0">
    <div class="flex flex-col gap-0.5">
      <span id="{id}-default" class="text-(length:--font-body) font-medium text-foreground"
        >Default preset</span
      >
      <span id="{id}-default-desc" class="text-(length:--font-ui) text-foreground-muted">
        What <code>/statblock</code> stamps in this ledger. Presets are shared by every ledger; this
        choice is not.
      </span>
    </div>
    <!-- Settings' own controls: 32px, a 6px radius, the hover overlay, and the 2px focus
         ring every control has — not the black well and 1px border it was. -->
    <select
      data-testid="statblock-default-select"
      aria-labelledby="{id}-default"
      aria-describedby="{id}-default-desc"
      value={defaultName ?? ""}
      onchange={(e) => chooseDefault((e.target as HTMLSelectElement).value)}
      class="h-8 max-w-56 shrink-0 cursor-pointer rounded-md border border-border bg-transparent px-2.5
             text-(length:--font-ui) text-foreground transition-colors hover:bg-surface-hover
             focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
    >
      <option value="">Blank</option>
      {#each statblockPresets.available as preset (preset.name)}
        <option value={preset.name}>{preset.name}</option>
      {/each}
      {#if dangling && defaultName}
        <!-- Kept selectable so the pointer shows itself rather than reading as Blank —
             the whole diagnosis this section exists to give. -->
        <option value={defaultName}>{defaultName} (not found)</option>
      {/if}
    </select>
  </div>

  <!-- Saved presets -->
  <div class="flex flex-col gap-2 py-3">
    <div class="flex flex-col gap-0.5">
      <span class="text-(length:--font-body) font-medium text-foreground">Saved presets</span>
      <span class="text-(length:--font-ui) text-foreground-muted">
        Add one with “Save shape as preset” on any statblock. To change a shape, stamp it into a
        note, edit it there, and save over the same name.
      </span>
    </div>

    <div class="flex flex-col" data-testid="statblock-preset-list">
      {#each stored as preset (preset.name)}
        <div class="flex items-center justify-between gap-3 py-1.5">
          {#if renaming === preset.name}
            <Input
              bind:value={draft}
              class="h-7 max-w-64"
              aria-label={`Rename ${preset.name}`}
              data-testid="preset-rename-input"
              onkeydown={(e: KeyboardEvent) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  renaming = null;
                }
              }}
            />
            <div class="flex shrink-0 items-center gap-1">
              {#if renameReserved}
                <!-- An error says so twice, as every error in the app does: the icon and
                     the word, never the colour alone. -->
                <span
                  class="flex items-center gap-1 text-(length:--font-ui) text-destructive"
                  data-testid="rename-reserved"
                >
                  <CircleX class="size-3.5" /> Built-in name
                </span>
              {/if}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Save name"
                title="Save name"
                disabled={renameReserved}
                onclick={commitRename}><Check class="size-3.5" /></Button
              >
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Cancel rename"
                title="Cancel"
                onclick={() => (renaming = null)}><X class="size-3.5" /></Button
              >
            </div>
          {:else}
            <span class="truncate text-(length:--font-body) text-foreground">{preset.name}</span>
            <div class="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Rename ${preset.name}`}
                title="Rename"
                onclick={() => startRename(preset)}><Pencil class="size-3.5" /></Button
              >
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${preset.name}`}
                title="Delete"
                class="hover:text-destructive"
                onclick={() => remove(preset)}><Trash2 class="size-3.5" /></Button
              >
            </div>
          {/if}
        </div>
      {:else}
        <span class="py-1.5 text-(length:--font-ui) text-foreground-muted">
          You haven't saved any presets yet.
        </span>
      {/each}
    </div>
  </div>

  <!-- Built in -->
  <div class="flex flex-col gap-2 py-3">
    <div class="flex flex-col gap-0.5">
      <span class="text-(length:--font-body) font-medium text-foreground">Built in</span>
      <span class="text-(length:--font-ui) text-foreground-muted">
        These ship with Grimoire and can't be renamed, edited or deleted — their names aren't
        available for your own presets either.
      </span>
    </div>
    <div class="flex flex-col" data-testid="statblock-builtin-list">
      {#each SHIPPED_PRESETS as preset (preset.name)}
        <span class="py-1.5 text-(length:--font-body) text-foreground">{preset.name}</span>
      {/each}
    </div>
  </div>
</div>
