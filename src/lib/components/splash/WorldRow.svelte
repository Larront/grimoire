<script lang="ts">
  /*
    One recent world on the Splash: its name, what is in it, when it was last opened.
    The row opens it. A ✕ takes it off the list (the folder is untouched), for any
    world, not only one whose folder has gone.

    A world whose folder can't be found can't be opened. It says so, with the end of
    its path — the folder that matters, not "C:/Users/…" — and offers Find it, for a
    folder that has moved, and Look again, for a drive that has just been plugged back in.
  */
  import MiddleTruncate from "$lib/components/MiddleTruncate.svelte";
  import type { RecentLedger } from "$lib/stores/ledger.svelte";
  import { FolderSearch, LoaderCircle, RotateCw, X } from "@lucide/svelte";
  import { shortPath } from "$lib/utils/ledger-name";
  import { timeAgo, worldContents } from "$lib/utils/world-words";

  let {
    world,
    busy,
    onOpen,
    onRemove,
    onLookAgain,
    onFind,
    nameClass = "font-heading text-base",
    primary = false,
  }: {
    world: RecentLedger;
    busy: string | null;
    onOpen: (path: string) => void;
    onRemove: (path: string) => void;
    onLookAgain: () => void;
    onFind: (path: string, name: string) => void;
    /** How the name is set, which each layout decides. */
    nameClass?: string;
    /** The row a launch focuses, so Enter opens it. */
    primary?: boolean;
  } = $props();

  const opening = $derived(busy === world.path);
</script>

<li class="group/world relative flex items-center rounded-md hover:bg-surface-hover focus-within:bg-surface-hover">
  {#if world.missing}
    <div class="min-w-0 flex-1 px-3 py-2.5" data-testid="recent-missing">
      <MiddleTruncate text={world.name} title={world.name} class="text-foreground-muted {nameClass}" />
      <MiddleTruncate
        path
        text="Folder not found · {shortPath(world.path)}"
        title={world.path}
        class="mt-0.5 text-(length:--font-ui) text-foreground-muted"
      />
    </div>
    {#if opening}
      <LoaderCircle class="me-2 size-3.5 shrink-0 animate-spin text-foreground-muted" />
    {/if}
    <button
      type="button"
      class="flex size-8 shrink-0 items-center justify-center rounded-md text-foreground-muted
             hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
      aria-label="Find {world.name}…"
      title="Find it… — choose where its folder is now"
      data-testid="recent-find-btn"
      disabled={busy !== null}
      onclick={() => onFind(world.path, world.name)}
    >
      <FolderSearch class="size-4" strokeWidth={1.5} />
    </button>
    <button
      type="button"
      class="flex size-8 shrink-0 items-center justify-center rounded-md text-foreground-muted
             hover:bg-surface-hover hover:text-foreground"
      aria-label="Look for {world.name} again"
      title="Look again"
      onclick={onLookAgain}
    >
      <RotateCw class="size-4" strokeWidth={1.5} />
    </button>
  {:else}
    <button
      type="button"
      class="flex min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-2.5 text-left disabled:opacity-50"
      disabled={busy !== null}
      data-splash-primary={primary || undefined}
      data-testid="recent-world"
      onclick={() => onOpen(world.path)}
    >
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-2">
          {#if opening}
            <LoaderCircle class="size-3.5 shrink-0 animate-spin text-foreground-muted" />
          {/if}
          <MiddleTruncate text={world.name} title={world.name} class="text-foreground {nameClass}" />
        </span>
        <span class="mt-0.5 block truncate text-(length:--font-ui) text-foreground-muted">
          {worldContents(world)}
        </span>
      </span>
      <span class="shrink-0 text-(length:--font-ui) text-foreground-muted">
        {timeAgo(world.last_opened)}
      </span>
    </button>
  {/if}
  <button
    type="button"
    class="me-1 flex size-8 shrink-0 items-center justify-center rounded-md text-foreground-muted
           opacity-0 group-hover/world:opacity-100 focus-visible:opacity-100
           hover:bg-surface-hover hover:text-foreground
           {world.missing ? 'opacity-100' : ''}"
    aria-label="Remove {world.name} from recent worlds"
    title="Remove from this list — the folder stays where it is"
    data-testid="recent-remove-btn"
    onclick={() => onRemove(world.path)}
  >
    <X class="size-4" strokeWidth={1.5} />
  </button>
</li>
