<script lang="ts">
  /*
    The notes (and folders) Grimoire couldn't read when the world opened.

    Revised in the 2026-10 design review. It was "Import failures": the OS's own error
    strings under bare paths, nothing to do about them, and gone once closed — while
    the open was quietly deleting the unread notes' records. Now the records are kept
    (`import.rs`), and this says so: the files are untouched, why each one wouldn't
    read in the GM's words, a way to see it on disk, and Try again — which reads the
    world's notes again without reopening it. The list is `unreadableNotes`, which the
    toast, the palette and the file tree all bring back.
  */
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { FileWarning, FolderOpen, FolderX, LoaderCircle } from "@lucide/svelte";
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import { ledger } from "$lib/stores/ledger.svelte";
  import { unreadableNotes } from "$lib/stores/unreadable-notes.svelte";
  import type { FailedImport } from "$lib/bindings.gen";

  let list = $state<HTMLElement | null>(null);
  /** What the last Try again found, said under the list. */
  let outcome = $state<string | null>(null);

  const one = $derived(unreadableNotes.count === 1);
  // The world as the sidebar names it — the Example World's folder is "sample-world".
  const worldName = $derived(
    ledger.isSample
      ? "Example World"
      : (ledger.path?.split(/[\\/]/).filter(Boolean).pop() ?? "World"),
  );

  $effect(() => {
    if (!unreadableNotes.open) outcome = null;
  });

  const isFolder = (item: FailedImport) => item.path.endsWith("/");
  const segments = (item: FailedImport) => item.path.replace(/\/$/, "").split("/");
  const nameOf = (item: FailedImport) => segments(item).pop()!.replace(/\.md$/i, "");

  /** Under the folder they sit in, folders in the order the walk met them. */
  const byFolder = $derived.by(() => {
    const groups = new Map<string, FailedImport[]>();
    for (const item of unreadableNotes.items) {
      const folder = segments(item).slice(0, -1).join("/");
      groups.set(folder, [...(groups.get(folder) ?? []), item]);
    }
    return [...groups.entries()].map(([folder, items]) => ({ folder, items }));
  });

  function absolute(item: FailedImport): string | null {
    if (!ledger.path) return null;
    const sep = ledger.path.includes("\\") ? "\\" : "/";
    return (
      ledger.path.replace(/[\\/]+$/, "") + sep + item.path.replace(/\/$/, "").split("/").join(sep)
    );
  }

  function showInFolder(item: FailedImport) {
    const path = absolute(item);
    if (path) void revealItemInDir(path).catch(() => {});
  }

  async function tryAgain() {
    outcome = null;
    try {
      const opened = await unreadableNotes.retry();
      if (unreadableNotes.count === 0) return;
      outcome =
        opened === 0
          ? "Still couldn't read them."
          : `${opened} ${opened === 1 ? "opens" : "open"} now.`;
    } catch {
      outcome = "Couldn't read the world's notes again. Try reopening the world.";
    }
  }
</script>

<Dialog.Root bind:open={unreadableNotes.open}>
  <Dialog.Content
    data-testid="failed-imports-dialog"
    class="sm:max-w-md w-full max-h-[min(80vh,560px)] flex flex-col p-0 gap-0 overflow-hidden"
    onOpenAutoFocus={(e) => {
      // The list, not its first button: a ring on the first Show in folder read as that
      // being chosen. Tab walks in from here, and the list scrolls from the keyboard.
      e.preventDefault();
      list?.focus();
    }}
  >
    <Dialog.Header class="px-5 pt-5 pb-3 border-b border-border shrink-0 text-left">
      <Dialog.Title>
        {one ? "A note Grimoire couldn't open" : "Notes Grimoire couldn't open"}
      </Dialog.Title>
      <Dialog.Description class="text-(length:--font-ui) text-foreground-muted">
        {one ? "It's" : "They're"} still in your world's folder, untouched. Grimoire couldn't read
        {one ? "it" : "them"} this time, so {one ? "it won't" : "they won't"} open or show up in search
        until it can. It tries again whenever the world opens.
      </Dialog.Description>
    </Dialog.Header>

    <div
      bind:this={list}
      tabindex="-1"
      aria-label="Notes Grimoire couldn't open"
      class="min-h-0 flex-1 overflow-y-auto p-2 outline-none"
    >
      {#each byFolder as group (group.folder)}
        <section aria-label={group.folder || worldName} class="not-first:mt-2">
          <h3
            class="truncate px-2 pt-1 pb-1 text-xs font-semibold text-muted-foreground"
            title={group.folder || worldName}
          >
            {group.folder ? group.folder.split("/").pop() : worldName}
          </h3>
          <ul class="flex flex-col">
            {#each group.items as item (item.path)}
              <li
                data-testid="failed-import-row"
                class="flex min-h-(--row-h) min-w-0 items-start gap-2 rounded-md px-2 py-1.5 hover:bg-surface-hover"
              >
                {#if isFolder(item)}
                  <FolderX
                    class="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                {:else}
                  <FileWarning
                    class="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                {/if}
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="truncate text-(length:--font-ui) text-foreground" title={item.path}>
                    {nameOf(item)}{isFolder(item) ? " (folder)" : ""}
                  </span>
                  <span class="text-xs text-muted-foreground">{item.reason}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="shrink-0 text-muted-foreground"
                  aria-label="Show {nameOf(item)} in its folder"
                  title="Show in folder"
                  onclick={() => showInFolder(item)}
                >
                  <FolderOpen />
                </Button>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>

    <div class="flex items-center gap-3 border-t border-border px-5 py-3 shrink-0">
      <p
        aria-live="polite"
        data-testid="failed-imports-outcome"
        class="min-w-0 flex-1 text-(length:--font-ui) text-foreground-muted"
      >
        {outcome ?? ""}
      </p>
      <Button
        data-testid="failed-imports-retry"
        onclick={() => void tryAgain()}
        disabled={unreadableNotes.retrying}
      >
        {#if unreadableNotes.retrying}
          <LoaderCircle class="animate-spin" aria-hidden="true" />
          Trying…
        {:else}
          Try again
        {/if}
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
