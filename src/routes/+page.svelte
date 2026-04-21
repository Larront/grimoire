<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { vault, type RecentVault } from "$lib/stores/vault.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { Folder, Plus, LoaderCircle } from "@lucide/svelte";

  let recentVaults = $state<RecentVault[]>([]);
  let isLoadingRecents = $state(true);
  let openingPath = $state<string | null>(null);
  let errorMsg = $state<string | null>(null);

  const vaultName = $derived(vault.path?.split(/[\\/]/).pop() ?? "My Vault");

  // Load recent vaults on mount
  $effect(() => {
    if (!vault.isOpen) {
      invoke<RecentVault[]>("get_recent_vaults")
        .then((vaults) => {
          recentVaults = vaults;
        })
        .catch(console.error)
        .finally(() => {
          isLoadingRecents = false;
        });
    }
  });

  async function handleOpenRecent(vaultPath: string) {
    openingPath = vaultPath;
    errorMsg = null;
    try {
      await vault.openVault(vaultPath);
    } catch (e) {
      errorMsg = String(e);
    } finally {
      openingPath = null;
    }
  }

  async function handleOpenOther() {
    openingPath = "__dialog__";
    errorMsg = null;
    try {
      await vault.openVault();
    } catch (e) {
      errorMsg = String(e);
    } finally {
      openingPath = null;
    }
  }

  async function handleCreateNew() {
    // Same as open — open_vault creates the directory if it doesn't exist
    openingPath = "__dialog__";
    errorMsg = null;
    try {
      await vault.openVault();
    } catch (e) {
      errorMsg = String(e);
    } finally {
      openingPath = null;
    }
  }

  function formatRelativeTime(isoString: string): string {
    const diff = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks}w ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  }

  function formatVaultStats(v: RecentVault): string {
    const parts: string[] = [];
    if (v.note_count > 0)
      parts.push(`${v.note_count} note${v.note_count !== 1 ? "s" : ""}`);
    if (v.scene_count > 0)
      parts.push(`${v.scene_count} scene${v.scene_count !== 1 ? "s" : ""}`);
    if (v.map_count > 0)
      parts.push(`${v.map_count} map${v.map_count !== 1 ? "s" : ""}`);
    return parts.join(" · ") || "Empty vault";
  }

  const VAULT_PROMPTS = [
    "Every map begins as a blank page. Every legend begins with a first line.",
    "The world doesn't build itself. Your notes do.",
    "Great stories start somewhere. This one starts here.",
    "Even dragons have origins. Where does yours begin?",
    "Kingdoms rise from a single idea. What's yours?",
    "History is written by those who show up. Start your world.",
  ];

  const vaultPrompt =
    VAULT_PROMPTS[Math.floor(Math.random() * VAULT_PROMPTS.length)];
</script>

{#if vault.isOpen}
  <!-- ── Vault home ─────────────────────────────────────────────── -->
  <div class="h-full overflow-y-auto">
    <div
      class="flex flex-col gap-12 w-full max-w-lg py-16 px-10 mx-auto reveal"
    >
      <div class="flex flex-col gap-1.5">
        <h1
          class="font-display text-[2.25rem] font-semibold tracking-[-0.01em]
                 text-foreground leading-tight"
        >
          {vaultName}
        </h1>
        <p class="font-sans text-sm text-foreground-muted">
          Your worldbuilding vault
        </p>
      </div>

      {#if notes.isLoading}
        <div class="flex items-center gap-2 text-foreground-faint">
          <LoaderCircle class="w-4 h-4 animate-spin" />
          <span class="font-sans text-sm">Loading vault…</span>
        </div>
      {:else}
        <div class="flex flex-col gap-4">
          <span
            class="font-sans text-[10px] uppercase tracking-widest text-foreground-faint"
          >
            Continue writing
          </span>
          <p
            class="font-display text-base italic text-foreground-muted leading-relaxed"
          >
            {vaultPrompt}
          </p>
        </div>
      {/if}
    </div>
  </div>
{:else}
  <!-- ── Splash screen ──────────────────────────────────────────── -->
  <div
    class="flex flex-col items-center justify-center min-h-screen overflow-hidden relative"
  >
    <!-- Radial glow -->
    <div
      class="pointer-events-none absolute top-[30%] left-1/2 -translate-x-1/2 -translate-y-1/2
             w-[500px] h-[300px]"
      style="background: radial-gradient(ellipse, oklch(0.30 0.03 40 / 30%), transparent 70%)"
    ></div>

    <!-- Title -->
    <div class="text-center relative z-10 splash-fade">
      <h1 class="font-heading text-[52px] text-primary tracking-[1px]">
        Grimoire
      </h1>
      <div
        class="w-12 h-px mx-auto mt-3.5"
        style="background: linear-gradient(90deg, transparent, oklch(from var(--primary) l c h / 40%), transparent)"
      ></div>
    </div>

    {#if isLoadingRecents}
      <!-- Minimal loading — title is visible, content loads beneath -->
    {:else if recentVaults.length === 0}
      <!-- ── First-time user ──────────────────────────────────── -->
      <p
        class="font-sans text-sm text-muted-foreground mt-7 text-center max-w-[280px]
               leading-relaxed relative z-10 splash-fade-delay-1"
      >
        A worldbuilding vault for your campaigns, lore, maps, and sessions.
      </p>

      <div
        class="flex flex-col gap-2.5 mt-8 w-[280px] relative z-10 splash-fade-delay-2"
      >
        <Button
          onclick={handleCreateNew}
          class="justify-start gap-2.5 h-auto py-3 px-4"
          disabled={openingPath !== null}
        >
          {#if openingPath === "__dialog__"}
            <LoaderCircle class="w-4 h-4 animate-spin" />
          {:else}
            <Plus class="w-4 h-4" />
          {/if}
          <div class="text-left">
            <div class="text-sm font-bold">Create New Vault</div>
            <div class="text-[10px] opacity-70 font-normal">
              Start fresh with an empty vault
            </div>
          </div>
        </Button>

        <Button
          variant="secondary"
          onclick={handleOpenOther}
          class="justify-start gap-2.5 h-auto py-3 px-4"
          disabled={openingPath !== null}
        >
          <Folder class="w-4 h-4" />
          <div class="text-left">
            <div class="text-sm font-semibold">Open Existing Folder</div>
            <div class="text-[10px] opacity-70 font-normal">
              Choose a folder with your notes and files
            </div>
          </div>
        </Button>
      </div>
    {:else}
      <!-- ── Returning user ───────────────────────────────────── -->
      <div class="w-[320px] mt-8 relative z-10 splash-fade-delay-1">
        <span
          class="font-sans text-[9px] uppercase tracking-[2px] text-muted-foreground mb-2.5 block"
        >
          Recent Vaults
        </span>

        <div class="flex flex-col">
          {#each recentVaults as v (v.path)}
            <button
              class="flex items-center justify-between py-2.5 px-3 rounded-md
                     border-b border-border/30 text-left
                     hover:bg-muted/50 transition-colors duration-150
                     disabled:opacity-50"
              disabled={openingPath !== null}
              onclick={() => handleOpenRecent(v.path)}
            >
              <div class="min-w-0 flex-1">
                {#if openingPath === v.path}
                  <div class="flex items-center gap-2">
                    <LoaderCircle
                      class="w-3.5 h-3.5 animate-spin text-primary"
                    />
                    <span
                      class="font-sans text-[13px] font-semibold text-foreground"
                    >
                      {v.name}
                    </span>
                  </div>
                {:else}
                  <div
                    class="font-sans text-[13px] font-semibold text-foreground truncate"
                  >
                    {v.name}
                  </div>
                {/if}
                <div class="font-sans text-[10px] text-muted-foreground mt-0.5">
                  {formatVaultStats(v)}
                </div>
              </div>
              <div
                class="font-sans text-[10px] text-muted-foreground/60 ml-3 shrink-0"
              >
                {formatRelativeTime(v.last_opened)}
              </div>
            </button>
          {/each}
        </div>
      </div>

      <!-- Action buttons -->
      <div class="flex gap-3 mt-6 relative z-10 splash-fade-delay-2">
        <Button
          variant="outline"
          size="sm"
          onclick={handleOpenOther}
          class="text-[11px] text-primary"
          disabled={openingPath !== null}
        >
          Open Other Vault
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onclick={handleCreateNew}
          class="text-[11px] text-muted-foreground"
          disabled={openingPath !== null}
        >
          Create New Vault
        </Button>
      </div>
    {/if}

    <!-- Error message -->
    {#if errorMsg}
      <p
        class="font-sans text-xs text-destructive mt-4 text-center max-w-[300px] relative z-10"
      >
        {errorMsg}
      </p>
    {/if}
  </div>
{/if}
