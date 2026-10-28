<script lang="ts">
  /*
    Every tag in the world, with what it is used on and how the graph draws it.

    Revised in the 2026-10 design review:
    - A tag's colour is a swatch that opens the app's own picker, with Automatic — its
      ramp step — as the way back. It was the OS colour dialog and a bare "×".
    - Rename and merge happen at once and are undone from the toast; delete asks inside
      its own row. All three used to stop behind a modal that said "can't be undone".
    - The colour goes with the tag: renaming keeps it, merging keeps the target's.
    - Whatever changes here reaches open notes and the graph through `tagsTick`.
  */
  import { tick, untrack } from "svelte";
  import { api } from "$lib/api";
  import { Switch } from "$lib/components/ui/switch";
  import { Button } from "$lib/components/ui/button";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Popover from "$lib/components/ui/popover";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import ColorPicker from "$lib/components/ColorPicker.svelte";
  import { TAG_ALLOWED } from "$lib/components/TagChipEditor.svelte";
  import { CircleX, Ellipsis, GitMerge, LoaderCircle, Pencil, Trash2 } from "@lucide/svelte";
  import type { TagGraphStyleResponse, TagUsageEntry } from "$lib/bindings.gen";
  import { toastUndo } from "$lib/toast";
  import { resolveTagColor } from "$lib/graph-palette";
  import { tagsTick } from "$lib/stores/tags-tick.svelte";

  let { open = $bindable(false) }: { open: boolean } = $props();

  let tags = $state<TagUsageEntry[]>([]);
  let styles = $state<Record<string, TagGraphStyleResponse>>({});
  let isLoading = $state(true);
  let list = $state<HTMLElement | null>(null);

  /** A rename or merge being typed: the tag, which, and the name so far. */
  let editing = $state<{ tag: string; mode: "rename" | "merge"; value: string } | null>(null);
  /** The tag whose row is asking "delete?". */
  let deleting = $state<string | null>(null);

  async function load() {
    try {
      const [t, s] = await Promise.all([api.getTagUsageCounts(), api.getTagGraphStyles()]);
      tags = t ?? [];
      styles = s ?? {};
    } catch {
      tags = [];
      styles = {};
    } finally {
      isLoading = false;
    }
  }

  // Load on open, and again whenever a tag changes anywhere — this dialog's own
  // writes included, and an Undo pressed in a toast after it.
  $effect(() => {
    if (!open) {
      isLoading = true;
      tags = [];
      styles = {};
      editing = null;
      deleting = null;
      return;
    }
    void tagsTick.value;
    untrack(() => void load());
  });

  const lower = (tag: string) => tag.toLowerCase();
  const find = (tag: string) => tags.find((t) => lower(t.tag) === lower(tag));

  /** "3 notes", "1 pin", "3 notes and 1 pin". */
  function places(entry: TagUsageEntry): string {
    const n = entry.note_count;
    const p = entry.pin_count;
    const notes = `${n} ${n === 1 ? "note" : "notes"}`;
    const pins = `${p} ${p === 1 ? "pin" : "pins"}`;
    if (n && p) return `${notes} and ${pins}`;
    return p ? pins : notes;
  }

  function uses(entry: TagUsageEntry): string {
    const total = entry.note_count + entry.pin_count;
    return `${total} ${total === 1 ? "use" : "uses"}`;
  }

  /** What the graph draws the tag in — shared with the graph through graph-palette. */
  const colorOf = (tag: string) => resolveTagColor(styles[tag]);
  /** What Automatic would draw it in: its ramp step, or muted past the eighth. */
  const automaticOf = (tag: string) => resolveTagColor({ color: null, slot: styles[tag]?.slot });

  /** A tag's stored style; a tag nobody has styled has no row yet. */
  const styleOf = (tag: string): TagGraphStyleResponse =>
    (styles[tag] as TagGraphStyleResponse | undefined) ?? {
      color: null,
      hidden: false,
      slot: null,
    };

  function setColor(tag: string, color: string | null) {
    styles = { ...styles, [tag]: { ...styleOf(tag), color } };
    void api.setTagGraphColor(tag, color);
  }

  function setShown(tag: string, shown: boolean) {
    styles = { ...styles, [tag]: { ...styleOf(tag), hidden: !shown } };
    void api.setTagGraphHidden(tag, !shown);
  }

  // ── Focus ───────────────────────────────────────────────────────────────────

  /** Put focus back on a row — its ⋯ button — or on the list if the row is gone. */
  async function focusRow(tag: string | null) {
    await tick();
    const rows = list?.querySelectorAll<HTMLElement>("[data-tag]") ?? [];
    const row = [...rows].find((r) => tag !== null && lower(r.dataset.tag ?? "") === lower(tag));
    (row?.querySelector<HTMLElement>("[data-row-menu]") ?? list)?.focus();
  }

  function autofocus(node: HTMLElement, select: boolean) {
    node.focus();
    if (select && node instanceof HTMLInputElement) node.select();
  }

  // ── Rename and merge ────────────────────────────────────────────────────────

  function startEdit(tag: string, mode: "rename" | "merge") {
    deleting = null;
    editing = { tag, mode, value: mode === "rename" ? tag : "" };
  }

  function cancelEdit() {
    const tag = editing?.tag ?? null;
    editing = null;
    void focusRow(tag);
  }

  const editValue = $derived(editing?.value.trim() ?? "");
  const editInvalid = $derived(editValue !== "" && !TAG_ALLOWED.test(editValue));
  /** The existing tag the typed name lands on, if it is not the tag itself. */
  const editTarget = $derived(
    editing && editValue && lower(editValue) !== lower(editing.tag) ? find(editValue) : undefined,
  );

  /** Merge targets: every other tag containing what has been typed. */
  const suggestions = $derived(
    editing?.mode === "merge"
      ? tags
          .filter((t) => lower(t.tag) !== lower(editing!.tag))
          .filter((t) => lower(t.tag).includes(lower(editValue)))
          .slice(0, 6)
      : [],
  );

  async function submitEdit(to = editValue) {
    const edit = editing;
    if (!edit || !to || !TAG_ALLOWED.test(to)) return;
    if (to === edit.tag) return cancelEdit();
    editing = null;
    try {
      const result = await api.retagTag(edit.tag, to);
      const entry = find(edit.tag);
      const where = entry ? ` on ${places(entry)}` : "";
      toastUndo(
        result.merged
          ? `Merged “${edit.tag}” into “${to}”${where}`
          : `Renamed “${edit.tag}” to “${to}”${where}`,
        () => {},
        () => void api.undoRetag(result.undo),
      );
      await load();
      void focusRow(to);
    } catch {
      // The wrapper has said why; give the GM back what they typed.
      editing = edit;
    }
  }

  function onEditKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      // The row's to close, not the dialog.
      e.preventDefault();
      e.stopPropagation();
      cancelEdit();
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  function cancelDelete() {
    const tag = deleting;
    deleting = null;
    void focusRow(tag);
  }

  async function confirmDelete() {
    const tag = deleting;
    if (!tag) return;
    const index = tags.findIndex((t) => t.tag === tag);
    const entry = tags[index];
    deleting = null;
    try {
      const result = await api.retagTag(tag, null);
      toastUndo(
        `Deleted “${tag}”${entry ? ` from ${places(entry)}` : ""}`,
        () => {},
        () => void api.undoRetag(result.undo),
      );
      await load();
      void focusRow(tags[Math.min(index, tags.length - 1)]?.tag ?? null);
    } catch {
      void focusRow(tag);
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    class="sm:max-w-md w-full max-h-[min(80vh,640px)] flex flex-col p-0 gap-0 overflow-hidden"
    data-testid="tag-manager-dialog"
  >
    <Dialog.Header class="px-5 pt-5 pb-3 border-b border-border shrink-0 text-left">
      <Dialog.Title>Tag Manager</Dialog.Title>
      <Dialog.Description class="text-(length:--font-ui) text-foreground-muted">
        Every tag in this ledger, its colour in the graph, and whether the graph shows it.
      </Dialog.Description>
    </Dialog.Header>

    <div bind:this={list} tabindex="-1" class="min-h-0 flex-1 overflow-y-auto p-2 outline-none">
      {#if isLoading}
        <div class="flex items-center gap-3 p-3">
          <LoaderCircle class="size-4 animate-spin text-foreground-muted" />
          <span class="text-(length:--font-ui) text-foreground-muted">Loading…</span>
        </div>
      {:else if tags.length === 0}
        <p
          class="p-3 text-(length:--font-ui) text-foreground-muted"
          data-testid="tag-manager-empty"
        >
          No tags in this ledger yet. Give a note one under Tags, in its Details.
        </p>
      {:else}
        <ul class="flex flex-col" data-testid="tag-manager-list">
          {#each tags as entry (entry.tag)}
            <li
              data-tag={entry.tag}
              data-testid="tag-manager-row"
              class="flex flex-col gap-2 rounded-md px-2 py-1.5 hover:bg-surface-hover focus-within:bg-surface-hover"
            >
              <div class="flex min-w-0 items-center gap-3">
                <span class="min-w-0 flex-1 truncate text-foreground" title={entry.tag}
                  >{entry.tag}</span
                >
                <span
                  class="shrink-0 text-(length:--font-ui) text-foreground-muted tabular-nums"
                  data-testid="tag-usage-count-{entry.tag}"
                  title={places(entry)}>{uses(entry)}</span
                >

                <!-- Graph colour: the app's own picker, Automatic being its ramp step. -->
                <Popover.Root>
                  <Popover.Trigger>
                    {#snippet child({ props })}
                      <button
                        {...props}
                        type="button"
                        data-testid="tag-color-{entry.tag}"
                        aria-label="Graph colour for {entry.tag}: {styles[entry.tag]?.color ??
                          'Automatic'}"
                        class="size-6 shrink-0 cursor-pointer rounded-md border border-border
                               focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        style="background: {colorOf(entry.tag)}"
                      ></button>
                    {/snippet}
                  </Popover.Trigger>
                  <Popover.Content align="end" class="w-60">
                    <ColorPicker
                      value={styles[entry.tag]?.color ?? null}
                      fallback={automaticOf(entry.tag)}
                      noneSwatch={automaticOf(entry.tag)}
                      defaultLabel="Automatic"
                      onchange={(color) => setColor(entry.tag, color)}
                    />
                  </Popover.Content>
                </Popover.Root>

                <Switch
                  checked={!(styles[entry.tag]?.hidden ?? false)}
                  onCheckedChange={(shown) => setShown(entry.tag, shown)}
                  aria-label="Show {entry.tag} in graph"
                  data-testid="tag-visibility-{entry.tag}"
                />

                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    {#snippet child({ props })}
                      <Button
                        {...props}
                        variant="ghost"
                        size="icon-xs"
                        class="text-foreground-muted"
                        data-row-menu
                        data-testid="tag-menu-{entry.tag}"
                        aria-label="More for {entry.tag}"
                      >
                        <Ellipsis />
                      </Button>
                    {/snippet}
                  </DropdownMenu.Trigger>
                  <!-- Focus stays where the chosen item put it (the name field, or Cancel). -->
                  <DropdownMenu.Content
                    align="end"
                    class="min-w-40"
                    onCloseAutoFocus={(e) => {
                      if (editing || deleting) e.preventDefault();
                    }}
                  >
                    <DropdownMenu.Item
                      data-testid="tag-menu-rename-{entry.tag}"
                      onclick={() => startEdit(entry.tag, "rename")}
                    >
                      <Pencil size={14} /> Rename
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      data-testid="tag-menu-merge-{entry.tag}"
                      onclick={() => startEdit(entry.tag, "merge")}
                    >
                      <GitMerge size={14} /> Merge into…
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item
                      variant="destructive"
                      data-testid="tag-menu-delete-{entry.tag}"
                      onclick={() => {
                        editing = null;
                        deleting = entry.tag;
                      }}
                    >
                      <Trash2 size={14} /> Delete
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </div>

              {#if editing?.tag === entry.tag}
                {@const field = `retag-${entry.tag}`}
                <form
                  class="flex flex-col gap-1.5"
                  onsubmit={(e) => {
                    e.preventDefault();
                    void submitEdit();
                  }}
                >
                  <label for={field} class="sr-only">
                    {editing.mode === "rename"
                      ? `New name for ${entry.tag}`
                      : `Merge ${entry.tag} into`}
                  </label>
                  <div class="flex items-center gap-2">
                    <input
                      id={field}
                      type="text"
                      autocomplete="off"
                      spellcheck="false"
                      placeholder={editing.mode === "rename" ? "New name" : "Tag to merge into"}
                      data-testid="retag-input-{entry.tag}"
                      bind:value={editing.value}
                      use:autofocus={editing.mode === "rename"}
                      onkeydown={onEditKeydown}
                      aria-invalid={editInvalid}
                      aria-describedby="{field}-hint"
                      class="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-(length:--font-ui)
                             text-foreground placeholder:text-foreground-muted
                             focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring
                             aria-invalid:border-error"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!editValue || editInvalid}
                      data-testid="retag-apply-{entry.tag}"
                    >
                      {editTarget || editing.mode === "merge" ? "Merge" : "Rename"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onclick={cancelEdit}
                      >Cancel</Button
                    >
                  </div>
                  <p
                    id="{field}-hint"
                    class="text-(length:--font-ui) text-foreground-muted"
                    aria-live="polite"
                  >
                    {#if editInvalid}
                      <span class="inline-flex items-center gap-1.5 text-error">
                        <CircleX size={14} class="shrink-0" />
                        Tags use letters, numbers, - _ and / only.
                      </span>
                    {:else if editTarget}
                      “{editTarget.tag}” already exists — this merges the two, keeping its colour.
                    {:else if editing.mode === "merge" && editValue}
                      No tag “{editValue}” yet — this renames “{entry.tag}”.
                    {/if}
                  </p>
                  {#if suggestions.length}
                    <div class="flex flex-wrap gap-1.5" aria-label="Existing tags" role="group">
                      {#each suggestions as s (s.tag)}
                        <button
                          type="button"
                          class="max-w-40 truncate rounded-md border border-border px-2 py-0.5 text-(length:--font-ui)
                                 text-foreground hover:bg-surface-hover
                                 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                          title={s.tag}
                          data-testid="retag-suggestion-{s.tag}"
                          onclick={() => void submitEdit(s.tag)}>{s.tag}</button
                        >
                      {/each}
                    </div>
                  {/if}
                </form>
              {/if}

              {#if deleting === entry.tag}
                <!-- Escape answers "no" here rather than closing the whole dialog. -->
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <div
                  class="flex items-center justify-between gap-3"
                  role="group"
                  aria-label="Confirm deleting {entry.tag}"
                  onkeydown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      cancelDelete();
                    }
                  }}
                >
                  <span class="text-(length:--font-ui) text-foreground">
                    Remove “{entry.tag}” from {places(entry)}?
                  </span>
                  <div class="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="tag-delete-cancel-{entry.tag}"
                      {@attach (node: HTMLElement) => node.focus()}
                      onclick={cancelDelete}>Cancel</Button
                    >
                    <Button
                      size="sm"
                      variant="destructive"
                      data-testid="tag-delete-confirm-{entry.tag}"
                      onclick={() => void confirmDelete()}>Delete</Button
                    >
                  </div>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
