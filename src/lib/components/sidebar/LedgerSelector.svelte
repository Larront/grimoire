<script lang="ts">
  import { ChevronDown, FolderOpen } from "@lucide/svelte";
  import { vault, type RecentVault } from "$lib/stores/vault.svelte";
  import { buttonVariants } from "$lib/components/ui/button";
  import { cn } from "$lib/utils";

  let open = $state(false);
  let recentVaults = $state<RecentVault[]>([]);

  const vaultName = $derived(
    vault.path
      ? (vault.path.replace(/\\/g, "/").split("/").pop() ?? "Untitled")
      : "No vault"
  );

  async function handleToggle() {
    open = !open;
    if (open) {
      recentVaults = await vault.getRecentVaults();
    }
  }

  async function switchVault(path: string) {
    open = false;
    await vault.openVault(path);
  }

  async function openNewVault() {
    open = false;
    await vault.openVault();
  }
</script>

<div class="relative w-full">
  <button
    type="button"
    aria-label="Vault selector"
    aria-haspopup="true"
    aria-expanded={open}
    onclick={handleToggle}
    class={cn(
      buttonVariants({ variant: "ghost", size: "sm" }),
      "w-full justify-start gap-2 px-2 text-left"
    )}
  >
    <FolderOpen class="size-3.5 shrink-0 text-muted-foreground" />
    <span class="flex-1 truncate text-(--font-ui)">{vaultName}</span>
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
      {#each recentVaults as v (v.path)}
        <button
          type="button"
          role="menuitem"
          class={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "w-full justify-start gap-2 rounded-none px-3 text-(--font-body)"
          )}
          onclick={() => switchVault(v.path)}
        >
          <FolderOpen class="size-3.5 shrink-0 text-muted-foreground" />
          <span class="truncate">{v.name}</span>
        </button>
      {/each}

      {#if recentVaults.length > 0}
        <div class="my-1 h-px bg-border" role="separator"></div>
      {/if}

      <button
        type="button"
        role="menuitem"
        class={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "w-full justify-start gap-2 rounded-none px-3 text-(--font-body)"
        )}
        onclick={openNewVault}
      >
        Open new vault
      </button>
    </div>
  {/if}
</div>
