<script lang="ts">
  import { ChevronDown, FolderOpen } from "@lucide/svelte";
  import { ledger, type RecentLedger } from "$lib/stores/ledger.svelte";
  import { buttonVariants } from "$lib/components/ui/button";
  import { cn } from "$lib/utils";

  let open = $state(false);
  let recentLedgers = $state<RecentLedger[]>([]);

  const ledgerName = $derived(
    ledger.path
      ? (ledger.path.replace(/\\/g, "/").split("/").pop() ?? "Untitled")
      : "No ledger"
  );

  async function handleToggle() {
    open = !open;
    if (open) {
      recentLedgers = await ledger.getRecentLedgers();
    }
  }

  async function switchLedger(path: string) {
    open = false;
    await ledger.openLedger(path);
  }

  async function openNewLedger() {
    open = false;
    await ledger.openLedger();
  }
</script>

<div class="relative w-full">
  <button
    type="button"
    aria-label="Ledger selector"
    aria-haspopup="true"
    aria-expanded={open}
    onclick={handleToggle}
    class={cn(
      buttonVariants({ variant: "ghost", size: "sm" }),
      "w-full justify-start gap-2 px-2 text-left"
    )}
  >
    <FolderOpen class="size-3.5 shrink-0 text-muted-foreground" />
    <span class="flex-1 truncate text-(--font-ui)">{ledgerName}</span>
    <ChevronDown
      class={cn(
        "size-3 shrink-0 text-muted-foreground transition-transform duration-150",
        open && "rotate-180"
      )}
    />
  </button>

  {#if open}
    <div
      class="absolute bottom-full left-0 z-50 mb-1 w-56 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-lg"
      role="menu"
    >
      {#each recentLedgers as v (v.path)}
        <button
          type="button"
          role="menuitem"
          class={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "w-full justify-start gap-2 rounded-none px-3 text-(--font-body)"
          )}
          onclick={() => switchLedger(v.path)}
        >
          <FolderOpen class="size-3.5 shrink-0 text-muted-foreground" />
          <span class="truncate">{v.name}</span>
        </button>
      {/each}

      {#if recentLedgers.length > 0}
        <div class="my-1 h-px bg-border" role="separator"></div>
      {/if}

      <button
        type="button"
        role="menuitem"
        class={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "w-full justify-start gap-2 rounded-none px-3 text-(--font-body)"
        )}
        onclick={openNewLedger}
      >
        Open new ledger
      </button>
    </div>
  {/if}
</div>
