<script lang="ts">
  // "Save shape as preset" (#179) — the whole of preset authoring, and deliberately
  // the only part of it.
  //
  // **There is no preset editor.** An editor would be a second surface that renders an
  // editable statblock, which is exactly what ADR-0016 blames for the three shipped
  // blocks drifting apart. Editing a preset therefore means stamping it into a note,
  // changing it there, and saving over the name — one rendering surface, one set of
  // behaviours, and the thing being edited is a real block rather than a picture of one.
  //
  // The preview is **read-only and verbatim**. It is here to answer the one question a
  // GM has at the naming step — *is this the shape I meant?* — and it shows the fence
  // exactly as it will be stored, played values and all. Nothing is cleaned on the way
  // in: pools count in opposite directions, so Grimoire cannot know whether a tidy
  // `HP: 3/12` means `12/12` or `0/12`, which makes value-cleaning impossible rather
  // than merely unwanted.
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { statblockPresets } from "$lib/stores/statblock-presets.svelte";
  import { isShippedName, sameName } from "$lib/editor/statblock-presets";
  import { toastSuccess } from "$lib/toast";

  let {
    open = $bindable(false),
    fence,
    suggestedName = "",
  }: {
    open: boolean;
    /** The block's fence text, verbatim — captured fresh each time the dialog opens. */
    fence: string;
    /** The block's own name, offered as the preset's. */
    suggestedName?: string;
  } = $props();

  let name = $state("");
  let saving = $state(false);

  // The name is seeded from the block each time the dialog opens rather than once at
  // construction: the same node view is reused as the GM edits, so a stale suggestion
  // would offer the creature's old name.
  $effect(() => {
    if (open) {
      name = suggestedName;
      saving = false;
      // Re-read rather than trust memory: the warning below is the GM's only notice
      // that Save will overwrite, and a stale list would withhold it.
      statblockPresets.reload();
    }
  });

  const trimmed = $derived(name.trim());

  /** An existing shape of this name — the save will replace it, so the GM is told. */
  const replaces = $derived(
    statblockPresets.stored.find((preset) => sameName(preset.name, trimmed)) ?? null,
  );

  /** A shipped name, which cannot be taken: the built-ins are read-only constants. */
  const reserved = $derived(!!trimmed && isShippedName(trimmed));

  async function save() {
    if (!trimmed || reserved || saving) return;
    saving = true;
    try {
      await statblockPresets.save(trimmed, fence);
      toastSuccess(`Saved “${trimmed}” as a statblock preset`);
      open = false;
    } catch {
      // api.* has already toasted the failure; the dialog stays open to retry.
      saving = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-lg" data-testid="save-preset-dialog">
    <Dialog.Header>
      <Dialog.Title>Save shape as preset</Dialog.Title>
      <Dialog.Description>
        Presets are shared by every campaign on this machine. Stamping one copies its
        text into the note — nothing here can reach a statblock you have already written.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-3">
      <label class="flex flex-col gap-1.5">
        <span class="text-(--font-ui) text-foreground-muted">Preset name</span>
        <Input
          bind:value={name}
          placeholder="Goblin"
          data-testid="preset-name-input"
          onkeydown={(e: KeyboardEvent) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
        />
      </label>

      {#if reserved}
        <p class="text-(--font-ui) text-destructive" data-testid="preset-reserved">
          “{trimmed}” is a built-in preset. Pick another name.
        </p>
      {:else if replaces}
        <p class="text-(--font-ui) text-foreground-muted" data-testid="preset-replaces">
          Saves over your existing “{replaces.name}” preset.
        </p>
      {/if}

      <div class="flex flex-col gap-1.5">
        <span class="text-(--font-ui) text-foreground-muted">What gets saved</span>
        <pre
          data-testid="preset-preview"
          class="max-h-56 overflow-auto rounded-md border border-border bg-muted/40 px-3 py-2
                 font-mono text-xs leading-relaxed whitespace-pre text-foreground">{fence}</pre>
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
      <Button
        data-testid="preset-save-btn"
        disabled={!trimmed || reserved || saving}
        onclick={save}>Save preset</Button
      >
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
