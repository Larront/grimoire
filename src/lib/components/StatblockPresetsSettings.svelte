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
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Check, Pencil, Trash2, X } from "@lucide/svelte";
  import {
    SHIPPED_PRESETS,
    isShippedName,
    type StatblockPreset,
  } from "$lib/editor/statblock-presets";
  import { statblockPresets } from "$lib/stores/statblock-presets.svelte";
  import { toastSuccess } from "$lib/toast";

  let { open = false }: { open?: boolean } = $props();

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

  let deleting = $state<StatblockPreset | null>(null);

  async function confirmDelete() {
    const preset = deleting;
    if (!preset) return;
    try {
      await statblockPresets.remove(preset.name);
      toastSuccess(`Deleted the “${preset.name}” preset`);
    } catch {
      // api.* has already toasted.
    }
    deleting = null;
  }
</script>

<div class="flex flex-col divide-y divide-border">
  <!-- Default preset -->
  <div class="flex items-center justify-between gap-4 py-3 first:pt-0">
    <div class="flex flex-col gap-0.5">
      <span class="text-(--font-body) font-medium text-foreground">Default preset</span>
      <span class="text-(--font-ui) text-foreground-muted">
        What <code>/statblock</code> stamps in this campaign. Presets are shared by every campaign; this
        choice is not.
      </span>
    </div>
    <select
      data-testid="statblock-default-select"
      aria-label="Default statblock preset"
      value={defaultName ?? ""}
      onchange={(e) => chooseDefault((e.target as HTMLSelectElement).value)}
      class="shrink-0 max-w-56 cursor-pointer rounded-lg border border-border bg-background-subtle
             px-3 py-1.5 text-(--font-ui) text-foreground outline-none focus:border-primary"
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
      <span class="text-(--font-body) font-medium text-foreground">Saved presets</span>
      <span class="text-(--font-ui) text-foreground-muted">
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
                <span class="text-(--font-ui) text-destructive" data-testid="rename-reserved">
                  Built-in name
                </span>
              {/if}
              <Button
                variant="ghost"
                size="sm"
                aria-label="Save name"
                disabled={renameReserved}
                onclick={commitRename}><Check class="size-3.5" /></Button
              >
              <Button
                variant="ghost"
                size="sm"
                aria-label="Cancel rename"
                onclick={() => (renaming = null)}><X class="size-3.5" /></Button
              >
            </div>
          {:else}
            <span class="truncate text-(--font-body) text-foreground">{preset.name}</span>
            <div class="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Rename ${preset.name}`}
                onclick={() => startRename(preset)}><Pencil class="size-3.5" /></Button
              >
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Delete ${preset.name}`}
                onclick={() => (deleting = preset)}><Trash2 class="size-3.5" /></Button
              >
            </div>
          {/if}
        </div>
      {:else}
        <span class="py-1.5 text-(--font-ui) italic text-foreground-muted">
          You haven't saved any presets yet.
        </span>
      {/each}
    </div>
  </div>

  <!-- Built in -->
  <div class="flex flex-col gap-2 py-3">
    <div class="flex flex-col gap-0.5">
      <span class="text-(--font-body) font-medium text-foreground">Built in</span>
      <span class="text-(--font-ui) text-foreground-muted">
        These ship with Grimoire and can't be renamed, edited or deleted — their names aren't
        available for your own presets either.
      </span>
    </div>
    <div class="flex flex-col" data-testid="statblock-builtin-list">
      {#each SHIPPED_PRESETS as preset (preset.name)}
        <span class="py-1.5 text-(--font-body) text-foreground">{preset.name}</span>
      {/each}
    </div>
  </div>
</div>

<AlertDialog.Root
  open={deleting !== null}
  onOpenChange={(v) => {
    if (!v) deleting = null;
  }}
>
  <AlertDialog.Portal>
    <AlertDialog.Overlay />
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>Delete “{deleting?.name}”?</AlertDialog.Title>
        <AlertDialog.Description>
          This removes the preset from every campaign on this machine. Statblocks you have already
          written are copies and are left exactly as they are.
        </AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
        <AlertDialog.Action data-testid="preset-delete-confirm" onclick={confirmDelete}>
          Delete
        </AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>
