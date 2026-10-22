<script lang="ts">
  /*
    Every template in the world: open one to edit it, rename it, delete it, or make one.

    Added in the 2026-10 design review. Templates had an accordion in the sidebar
    footer, which pushed the Files tree out of sight when opened and was the only
    place to rename or delete one. A world-wide list a GM tends now and then is the
    Tag Manager's kind of thing, so it takes the Tag Manager's shape: rows, a ⋯ menu,
    rename in place with the reason under the field, delete undone from the toast.
    Making a note from a template is the New menu's and the palette's job, not this.

    Each row says what the template gives besides its text — its tags — which the
    accordion never showed anywhere.
  */
  import { tick, untrack } from "svelte";
  import { api, friendlyMessage } from "$lib/api";
  import { Button } from "$lib/components/ui/button";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import {
    CircleX,
    Ellipsis,
    LayoutTemplate,
    LoaderCircle,
    Pencil,
    Plus,
    SquarePen,
    Trash2,
  } from "@lucide/svelte";
  import { dialogs } from "$lib/stores/overlay.svelte";
  import { templates } from "$lib/stores/templates.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { toastUndo } from "$lib/toast";
  import { nameProblem } from "$lib/utils/file-name";
  import type { TemplateEntry } from "$lib/types/ledger";

  let list = $state<HTMLElement | null>(null);

  /** Deleted, but waiting out the undo toast — hidden so the row goes on click. */
  let pendingDelete = $state<string[]>([]);
  const shown = $derived(templates.templates.filter((t) => !pendingDelete.includes(t.path)));

  /** A rename being typed, or the new template's name (`path: null`). */
  let editing = $state<{ path: string | null; value: string; refused: string | null } | null>(
    null,
  );

  // Read afresh on every open: templates live where the Ledger Watcher doesn't look,
  // so one added outside Grimoire appears the next time this opens.
  $effect(() => {
    if (!dialogs.templatesOpen) {
      editing = null;
      return;
    }
    untrack(() => {
      void templates.load();
      if (dialogs.templatesNaming) {
        dialogs.templatesNaming = false;
        editing = { path: null, value: "", refused: null };
      }
    });
  });

  const lower = (s: string) => s.trim().toLowerCase();

  const editValue = $derived(editing?.value.trim() ?? "");
  /** Why the typed name won't do: said as the GM types, once there is something typed. */
  const editProblem = $derived.by(() => {
    if (!editing || !editValue) return null;
    if (editing.refused) return editing.refused;
    const problem = nameProblem(editValue);
    if (problem) return problem;
    const taken = templates.templates.find(
      (t) => t.path !== editing!.path && lower(t.display_name) === lower(editValue),
    );
    return taken ? `There's already a template called “${taken.display_name}”.` : null;
  });

  function tagsOf(t: TemplateEntry): string {
    return t.tags.join(", ");
  }

  // ── Focus ───────────────────────────────────────────────────────────────────

  /** Put focus back on a row's name, or on the list if the row is gone. */
  async function focusRow(path: string | null) {
    await tick();
    const rows = list?.querySelectorAll<HTMLElement>("[data-template-path]") ?? [];
    const row = [...rows].find((r) => path !== null && r.dataset.templatePath === path);
    (row?.querySelector<HTMLElement>("[data-row-open]") ?? list)?.focus();
  }

  function autofocus(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  // ── Open ────────────────────────────────────────────────────────────────────

  /** Closed by opening a template: focus belongs to the template, not the button
   *  that opened this dialog. `fresh` ones start in their text. */
  let opened: "template" | "fresh" | null = null;

  function onCloseAutoFocus(e: Event) {
    if (!opened) return;
    e.preventDefault();
    // The pane tries too, but while this dialog's focus trap is still up it is
    // pulled straight back; here, the trap has let go. Whichever runs once the
    // editor exists wins.
    if (opened === "fresh") {
      document
        .querySelector<HTMLElement>(`[data-pane-content="${tabs.focusedPane}"] .ProseMirror`)
        ?.focus();
    }
    opened = null;
  }

  /** `fresh`: just made and named here, so it opens ready to write in. */
  function openTemplate(t: TemplateEntry, fresh = false) {
    opened = fresh ? "fresh" : "template";
    dialogs.templatesOpen = false;
    tabs.openTab({
      type: "template",
      id: 0,
      title: t.display_name,
      templatePath: t.path,
      ...(fresh ? { rename: true } : {}),
    });
  }

  // ── New, and rename ─────────────────────────────────────────────────────────

  function startNaming() {
    editing = { path: null, value: "", refused: null };
  }

  function startRename(t: TemplateEntry) {
    editing = { path: t.path, value: t.display_name, refused: null };
  }

  function cancelEdit() {
    const path = editing?.path ?? null;
    editing = null;
    void focusRow(path);
  }

  async function submitEdit() {
    const edit = editing;
    if (!edit || !editValue || editProblem) return;
    try {
      if (edit.path === null) {
        // Quiet surface: a refusal is said under the field, not in a toast.
        const entry = await api.silent.createTemplate(editValue);
        editing = null;
        await templates.load();
        openTemplate(entry, true);
        return;
      }
      const t = templates.templates.find((x) => x.path === edit.path);
      if (!t || editValue === t.display_name) return cancelEdit();
      await api.silent.renameTemplate(t.path, editValue);
      const newPath = t.path.replace(/[^/]+\.md$/, `${editValue}.md`);
      tabs.updateTemplateTab(t.path, editValue, newPath);
      editing = null;
      await templates.load();
      void focusRow(newPath);
    } catch (e) {
      // Keep what they typed, and say why under it.
      editing = { ...edit, refused: friendlyMessage(e) };
    }
  }

  function onEditKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      // The field's to close, not the dialog.
      e.preventDefault();
      e.stopPropagation();
      cancelEdit();
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  function deleteTemplate(t: TemplateEntry) {
    const index = shown.findIndex((x) => x.path === t.path);
    pendingDelete = [...pendingDelete, t.path];
    toastUndo(
      `Deleted “${t.display_name}”`,
      async () => {
        try {
          await api.deleteTemplate(t.path);
          // Only once it is really gone: a tab left open would keep saving into a
          // file that no longer exists.
          tabs.closeTabsByTemplatePath(t.path);
        } finally {
          await templates.load();
          pendingDelete = pendingDelete.filter((p) => p !== t.path);
        }
      },
      () => {
        pendingDelete = pendingDelete.filter((p) => p !== t.path);
      },
    );
    void focusRow(shown[Math.min(index, shown.length - 1)]?.path ?? null);
  }
</script>

{#snippet nameField(label: string, placeholder: string, action: string)}
  {@const field = `template-name-${editing?.path ?? "new"}`}
  <form
    class="flex flex-col gap-1.5"
    onsubmit={(e) => {
      e.preventDefault();
      void submitEdit();
    }}
  >
    <label for={field} class="sr-only">{label}</label>
    <div class="flex items-center gap-2">
      <input
        id={field}
        type="text"
        autocomplete="off"
        spellcheck="false"
        {placeholder}
        data-testid="template-name-input"
        value={editing?.value ?? ""}
        oninput={(e) => {
          if (editing) editing = { ...editing, value: e.currentTarget.value, refused: null };
        }}
        use:autofocus
        onkeydown={onEditKeydown}
        aria-invalid={!!editProblem}
        aria-describedby="{field}-hint"
        class="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-(length:--font-ui)
               text-foreground placeholder:text-foreground-muted
               focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring
               aria-invalid:border-error"
      />
      <Button
        type="submit"
        size="sm"
        disabled={!editValue || !!editProblem}
        data-testid="template-name-apply">{action}</Button
      >
      <Button type="button" size="sm" variant="ghost" onclick={cancelEdit}>Cancel</Button>
    </div>
    <p id="{field}-hint" class="text-(length:--font-ui) text-foreground-muted" aria-live="polite">
      {#if editProblem}
        <span class="inline-flex items-center gap-1.5 text-error">
          <CircleX size={14} class="shrink-0" />
          {editProblem}
        </span>
      {/if}
    </p>
  </form>
{/snippet}

<Dialog.Root bind:open={dialogs.templatesOpen}>
  <Dialog.Content
    class="sm:max-w-md w-full max-h-[min(80vh,640px)] flex flex-col p-0 gap-0 overflow-hidden"
    data-testid="templates-dialog"
    {onCloseAutoFocus}
  >
    <Dialog.Header class="px-5 pt-5 pb-3 border-b border-border shrink-0 text-left">
      <Dialog.Title>Templates</Dialog.Title>
      <Dialog.Description class="text-(length:--font-ui) text-foreground-muted">
        A note made from a template starts with its text and its tags.
      </Dialog.Description>
    </Dialog.Header>

    <div bind:this={list} tabindex="-1" class="min-h-0 flex-1 overflow-y-auto p-2 outline-none">
      {#if editing?.path === null}
        <div class="px-2 py-1.5" data-testid="template-new-row">
          {@render nameField("Name of the new template", "Name the template", "Create")}
        </div>
      {/if}

      {#if templates.isLoading && templates.templates.length === 0}
        <div class="flex items-center gap-3 p-3">
          <LoaderCircle class="size-4 animate-spin text-foreground-muted" />
          <span class="text-(length:--font-ui) text-foreground-muted">Loading…</span>
        </div>
      {:else if shown.length === 0}
        <p
          class="p-3 text-(length:--font-ui) text-foreground-muted"
          data-testid="templates-empty"
        >
          No templates in this world yet. Make one for the kind of note you write again and
          again — an NPC, a location, a session log.
        </p>
      {:else}
        <ul class="flex flex-col" data-testid="templates-list">
          {#each shown as t (t.path)}
            <li
              data-template-path={t.path}
              data-testid="template-row"
              class="flex flex-col gap-2 rounded-md hover:bg-surface-hover focus-within:bg-surface-hover"
            >
              {#if editing?.path === t.path}
                <div class="px-2 py-1.5">
                  {@render nameField(`New name for ${t.display_name}`, "New name", "Rename")}
                </div>
              {:else}
                <div class="flex min-w-0 items-center gap-1 pe-1">
                  <button
                    type="button"
                    data-row-open
                    data-testid="template-open-{t.display_name}"
                    class="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-left
                           focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                    onclick={() => openTemplate(t)}
                  >
                    <LayoutTemplate class="size-4 shrink-0 text-foreground-muted" strokeWidth={1.5} />
                    <span class="min-w-0 flex-1 truncate text-foreground" title={t.display_name}
                      >{t.display_name}</span
                    >
                    {#if t.tags.length}
                      <span
                        class="max-w-[40%] shrink-0 truncate text-(length:--font-ui) text-foreground-muted"
                        title="Notes made from it are tagged {tagsOf(t)}">{tagsOf(t)}</span
                      >
                    {/if}
                  </button>

                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                      {#snippet child({ props })}
                        <Button
                          {...props}
                          variant="ghost"
                          size="icon-xs"
                          class="text-foreground-muted"
                          data-testid="template-menu-{t.display_name}"
                          aria-label="More for {t.display_name}"
                        >
                          <Ellipsis />
                        </Button>
                      {/snippet}
                    </DropdownMenu.Trigger>
                    <!-- Focus stays where the chosen item put it (the name field). -->
                    <DropdownMenu.Content
                      align="end"
                      class="min-w-40"
                      onCloseAutoFocus={(e) => {
                        if (editing) e.preventDefault();
                      }}
                    >
                      <DropdownMenu.Item onclick={() => openTemplate(t)}>
                        <SquarePen size={14} /> Edit
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        data-testid="template-menu-rename-{t.display_name}"
                        onclick={() => startRename(t)}
                      >
                        <Pencil size={14} /> Rename
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item
                        variant="destructive"
                        data-testid="template-menu-delete-{t.display_name}"
                        onclick={() => deleteTemplate(t)}
                      >
                        <Trash2 size={14} /> Delete
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="flex shrink-0 items-center border-t border-border px-3 py-2">
      <Button
        variant="ghost"
        size="sm"
        class="gap-2"
        data-testid="template-new"
        disabled={editing?.path === null}
        onclick={startNaming}
      >
        <Plus strokeWidth={1.5} /> New template
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
