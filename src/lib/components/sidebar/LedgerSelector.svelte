<script lang="ts">
  import { dialogs } from "$lib/stores/overlay.svelte";
  import { BookOpen, ChevronDown, FolderOpen, Heart } from "@lucide/svelte";
  import { ledger, type RecentLedger } from "$lib/stores/ledger.svelte";
  import { buttonVariants } from "$lib/components/ui/button";
  import { cn } from "$lib/utils";

  let open = $state(false);
  let recentLedgers = $state<RecentLedger[]>([]);

  const ledgerName = $derived(
    ledger.path ? (ledger.path.replace(/\\/g, "/").split("/").pop() ?? "Untitled") : "No ledger",
  );

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
</script>

{#if ledger.isSample}
  <!-- Neutral on purpose: the accent is reserved for selection, focus, the primary
       action and what is playing, and "you are in the sample" is none of those. It is
       a fact about where the GM is, said once, in the chrome's own quiet voice. -->
  <div class="flex flex-col gap-0.5 w-full rounded-md border border-border p-1">
    <div
      data-testid="sample-world-marker"
      class="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground"
    >
      <BookOpen class="size-3.5 shrink-0" />
      <span class="font-medium">Example World</span>
    </div>
    <button
      type="button"
      data-testid="make-mine-btn"
      onclick={() => {
        dialogs.adoptOpen = true;
      }}
      class={cn(
        buttonVariants({ variant: "ghost", size: "sm" }),
        "w-full justify-start gap-2 px-2 text-xs text-foreground",
      )}
    >
      <Heart class="size-3.5 shrink-0" />
      Make this world mine
    </button>
  </div>
{:else}
  <div class="relative w-full">
    <button
      type="button"
      aria-label="Ledger selector"
      aria-haspopup="true"
      aria-expanded={open}
      onclick={handleToggle}
      class={cn(
        buttonVariants({ variant: "ghost", size: "sm" }),
        "w-full justify-start gap-2 px-2 text-left",
      )}
    >
      <FolderOpen class="size-3.5 shrink-0 text-muted-foreground" />
      <span class="flex-1 truncate text-(length:--font-ui)">{ledgerName}</span>
      <ChevronDown
        class={cn(
          "size-3 shrink-0 text-muted-foreground transition-transform duration-150",
          open && "rotate-180",
        )}
      />
    </button>

    {#if open}
      <div
        class="absolute bottom-full left-0 z-50 mb-1 w-56 overflow-hidden rounded-lg border border-border bg-popover py-1"
        role="menu"
      >
        {#each recentLedgers as v (v.path)}
          <button
            type="button"
            role="menuitem"
            class={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "w-full justify-start gap-2 rounded-none px-3 text-(length:--font-body)",
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
            "w-full justify-start gap-2 rounded-none px-3 text-(length:--font-body)",
          )}
          onclick={openNewLedger}
        >
          Open new ledger
        </button>
      </div>
    {/if}
  </div>
{/if}
