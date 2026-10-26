<script lang="ts">
  /*
    The open world, at the foot of the sidebar, and the way to another.

    One control in every world (2026-10 design review). In the example it used to be
    replaced by an "Example World" marker and Make this world mine, which left a GM no
    way back to their own worlds but a folder picker. Now the example keeps the same
    menu — the recent worlds — with Make this world mine added, and is named as itself,
    "The Ashfen Vale", marked as an example. Neutral throughout: the accent is reserved
    for selection, focus, the primary action and what is playing, and "you are in the
    example" is none of those.
  */
  import { dialogs } from "$lib/stores/overlay.svelte";
  import { ChevronDown, FolderOpen, Heart } from "@lucide/svelte";
  import { ledger, type RecentLedger } from "$lib/stores/ledger.svelte";
  import { buttonVariants } from "$lib/components/ui/button";
  import { cn } from "$lib/utils";

  let open = $state(false);
  let recentLedgers = $state<RecentLedger[]>([]);

  async function handleToggle() {
    open = !open;
    if (open) {
      // Missing folders (moved/unmounted) are Splash concerns — a quick-switch
      // menu only lists ledgers that can actually open.
      recentLedgers = (await ledger.getRecentLedgers()).filter((v) => !v.missing);
    }
  }

  async function switchLedger(path: string) {
    open = false;
    try {
      await ledger.openLedger(path);
    } catch (e) {
      console.error("open ledger failed:", e);
    }
  }

  async function openNewLedger() {
    open = false;
    try {
      await ledger.openLedger();
    } catch (e) {
      console.error("open ledger failed:", e);
    }
  }

  function makeMine() {
    open = false;
    dialogs.adoptOpen = true;
  }

  const item = cn(
    buttonVariants({ variant: "ghost", size: "sm" }),
    "w-full justify-start gap-2 rounded-none px-3 text-(length:--font-body)",
  );
</script>

<div class="relative w-full">
  <button
    type="button"
    aria-label="World: {ledger.worldName}{ledger.isSample ? ', an example' : ''}"
    aria-haspopup="true"
    aria-expanded={open}
    data-testid={ledger.isSample ? "sample-world-marker" : undefined}
    onclick={handleToggle}
    class={cn(
      buttonVariants({ variant: "ghost", size: "sm" }),
      "w-full justify-start gap-2 px-2 text-left",
    )}
  >
    <FolderOpen class="size-3.5 shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1 truncate text-(length:--font-ui)" title={ledger.worldName}
      >{ledger.worldName}</span
    >
    {#if ledger.isSample}
      <span class="shrink-0 text-(length:--font-ui) text-muted-foreground">example</span>
    {/if}
    <ChevronDown
      class={cn(
        "size-3 shrink-0 text-muted-foreground transition-transform duration-150",
        open && "rotate-180",
      )}
    />
  </button>

  {#if open}
    <div
      class="absolute bottom-full left-0 z-50 mb-1 w-56 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-float"
      role="menu"
    >
      {#if ledger.isSample}
        <button type="button" role="menuitem" class={item} data-testid="make-mine-btn" onclick={makeMine}>
          <Heart class="size-3.5 shrink-0 text-muted-foreground" />
          Make this world mine
        </button>
        <div class="my-1 h-px bg-border" role="separator"></div>
      {/if}

      {#each recentLedgers as v (v.path)}
        <button type="button" role="menuitem" class={item} onclick={() => switchLedger(v.path)}>
          <FolderOpen class="size-3.5 shrink-0 text-muted-foreground" />
          <span class="truncate">{v.name}</span>
        </button>
      {/each}

      {#if recentLedgers.length > 0}
        <div class="my-1 h-px bg-border" role="separator"></div>
      {/if}

      <button type="button" role="menuitem" class={item} onclick={openNewLedger}>
        Open a world folder…
      </button>
    </div>
  {/if}
</div>
