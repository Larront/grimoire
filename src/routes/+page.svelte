<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { vault, type RecentVault } from "$lib/stores/vault.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import { goto } from "$app/navigation";
  import type { Note } from "$lib/types/vault";
  import { Folder, Plus, LoaderCircle } from "@lucide/svelte";

  let recentVaults = $state<RecentVault[]>([]);
  let isLoadingRecents = $state(true);
  let openingPath = $state<string | null>(null);
  let errorMsg = $state<string | null>(null);
  let isCreatingNote = $state(false);

  // Create vault form
  let mode = $state<"idle" | "creating">("idle");
  let newVaultName = $state("");
  let newVaultParent = $state<string | null>(null);
  let nameError = $state<string | null>(null);
  let isPickingLocation = $state(false);

  const vaultName = $derived(vault.path?.split(/[\\/]/).pop() ?? "My Vault");

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

  async function handleOpenExisting() {
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

  function startCreate() {
    mode = "creating";
    newVaultName = "";
    newVaultParent = null;
    nameError = null;
    errorMsg = null;
  }

  function cancelCreate() {
    mode = "idle";
    nameError = null;
    errorMsg = null;
  }

  async function handleChooseLocation() {
    isPickingLocation = true;
    try {
      const selected = await open({ directory: true, title: "Choose Location" });
      if (selected && typeof selected === "string") {
        newVaultParent = selected;
        if (nameError === "Please choose a storage location.") nameError = null;
      }
    } finally {
      isPickingLocation = false;
    }
  }

  async function handleCreateVault() {
    nameError = null;
    const name = newVaultName.trim();

    if (!name) {
      nameError = "Please enter a vault name.";
      return;
    }
    if (/[/\\:*?"<>|]/.test(name)) {
      nameError = 'Name contains invalid characters ( / \\ : * ? " < > | ).';
      return;
    }
    if (name === "." || name === "..") {
      nameError = "Invalid vault name.";
      return;
    }
    if (!newVaultParent) {
      nameError = "Please choose a storage location.";
      return;
    }

    openingPath = "__creating__";
    errorMsg = null;
    try {
      await vault.openVault(`${newVaultParent}/${name}`);
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

  async function handleCreateFirstNote() {
    isCreatingNote = true;
    errorMsg = null;
    try {
      const newNote = await invoke<Note>("create_note", {
        noteTitle: "Untitled",
        notePath: "Untitled.md",
        noteParentPath: null,
      });
      await notes.load();
      goto(`/note/${newNote.id}?new=1`);
    } catch (e) {
      errorMsg = String(e);
    } finally {
      isCreatingNote = false;
    }
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

</script>

{#if vault.isOpen}
  <!-- ── Vault home (new vault) ────────────────────────────────── -->
  <div class="flex flex-col items-center justify-center h-full">
    <div class="flex flex-col items-center gap-8 w-full max-w-[480px] px-10 splash-fade">
      <h1 class="font-heading text-[2rem] font-normal text-foreground text-center leading-tight">
        {vaultName}
      </h1>

      {#if !notes.isLoading}
        <div class="flex flex-col items-center gap-6">
          <p class="font-sans text-sm italic text-foreground-muted text-center">
            Every world begins with its first note.
          </p>
          <Button
            onclick={handleCreateFirstNote}
            disabled={isCreatingNote}
            class="gap-2"
          >
            {#if isCreatingNote}
              <LoaderCircle class="w-3.5 h-3.5 animate-spin" />
              Creating...
            {:else}
              New note
            {/if}
          </Button>
        </div>
      {/if}

      {#if errorMsg}
        <p class="font-sans text-xs text-destructive text-center" role="alert">
          {errorMsg}
        </p>
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
      <!-- Minimal loading — title visible, content loads beneath -->
    {:else if mode === "creating"}
      <!-- ── Create new vault form ───────────────────────────────── -->
      <div
        class="flex flex-col gap-3 mt-9 w-[280px] relative z-10 splash-fade-delay-1"
      >
        <span
          class="font-mono text-[10.5px] uppercase tracking-[0.1em] text-foreground-faint"
        >
          New Vault
        </span>

        <!-- Vault name -->
        <div class="flex flex-col gap-1.5">
          <label for="vault-name" class="font-sans text-[11px] text-muted-foreground">
            Name
          </label>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            id="vault-name"
            type="text"
            placeholder="My Campaign"
            bind:value={newVaultName}
            autofocus
            disabled={openingPath !== null}
            onkeydown={(e) => {
              if (e.key === "Enter") handleCreateVault();
              if (e.key === "Escape") cancelCreate();
            }}
            class="h-9 px-3 rounded-[6px] bg-[var(--hover-overlay)] border border-border
                   text-[13px] text-foreground placeholder:text-foreground-faint
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-primary
                   focus-visible:ring-offset-1 focus-visible:ring-offset-background
                   disabled:opacity-50 w-full"
          />
        </div>

        <!-- Storage location -->
        <div class="flex flex-col gap-1.5">
          <span class="font-sans text-[11px] text-muted-foreground">Location</span>
          <button
            type="button"
            onclick={handleChooseLocation}
            disabled={openingPath !== null || isPickingLocation}
            class="h-9 px-3 rounded-[6px] bg-[var(--hover-overlay)] border border-border
                   flex items-center gap-2 text-left w-full min-w-0
                   hover:bg-[var(--background-elevated)] transition-colors duration-150
                   disabled:opacity-50 cursor-default"
          >
            <Folder class="w-3.5 h-3.5 shrink-0 text-muted-foreground/70" />
            {#if newVaultParent}
              <span class="font-sans text-[12px] text-foreground truncate min-w-0">
                {newVaultParent}
              </span>
            {:else}
              <span class="font-sans text-[12px] text-foreground/30 italic">
                Choose location...
              </span>
            {/if}
          </button>
        </div>

        <!-- Inline validation error -->
        {#if nameError}
          <p class="font-sans text-[11px] text-destructive leading-snug" role="alert">
            {nameError}
          </p>
        {/if}

        <!-- Actions -->
        <div class="flex gap-2 mt-1">
          <Button
            variant="ghost"
            size="sm"
            onclick={cancelCreate}
            disabled={openingPath !== null}
            class="flex-1 text-[11px] text-muted-foreground"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onclick={handleCreateVault}
            disabled={openingPath !== null || !newVaultName.trim() || !newVaultParent}
            class="flex-1 text-[11px]"
          >
            {#if openingPath === "__creating__"}
              <LoaderCircle class="w-3 h-3 animate-spin mr-1.5" />
              Creating...
            {:else}
              Create Vault
            {/if}
          </Button>
        </div>
      </div>
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
          onclick={startCreate}
          class="justify-start gap-2.5 h-auto py-3 px-4"
          disabled={openingPath !== null}
        >
          <Plus class="w-4 h-4 shrink-0" />
          <div class="text-left">
            <div class="text-sm font-semibold">Create New Vault</div>
            <div class="text-[10px] opacity-70 font-normal">
              Start fresh with an empty vault
            </div>
          </div>
        </Button>

        <Button
          variant="secondary"
          onclick={handleOpenExisting}
          class="justify-start gap-2.5 h-auto py-3 px-4"
          disabled={openingPath !== null}
        >
          {#if openingPath === "__dialog__"}
            <LoaderCircle class="w-4 h-4 animate-spin shrink-0" />
          {:else}
            <Folder class="w-4 h-4 shrink-0" />
          {/if}
          <div class="text-left">
            <div class="text-sm font-semibold">Open Existing Vault</div>
            <div class="text-[10px] opacity-70 font-normal">
              Browse for an existing vault
            </div>
          </div>
        </Button>
      </div>
    {:else}
      <!-- ── Returning user ───────────────────────────────────── -->
      <div class="w-[280px] mt-8 relative z-10 splash-fade-delay-1">
        <span
          class="font-mono text-[10.5px] uppercase tracking-[0.1em] text-foreground-faint mb-2.5 block"
        >
          Recent Vaults
        </span>

        <div class="flex flex-col">
          {#each recentVaults as v (v.path)}
            <button
              class="flex items-center justify-between py-2.5 px-3 rounded-sm
                     border-b border-border text-left
                     hover:bg-[var(--hover-overlay)] transition-colors duration-150
                     disabled:opacity-50"
              disabled={openingPath !== null}
              onclick={() => handleOpenRecent(v.path)}
            >
              <div class="min-w-0 flex-1">
                {#if openingPath === v.path}
                  <div class="flex items-center gap-2">
                    <LoaderCircle class="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
                    <span class="font-heading text-[15px] font-normal text-foreground truncate">
                      {v.name}
                    </span>
                  </div>
                {:else}
                  <div class="font-heading text-[15px] font-normal text-foreground truncate">
                    {v.name}
                  </div>
                {/if}
                <div class="font-mono text-[10px] text-foreground-muted mt-0.5">
                  {formatVaultStats(v)}
                </div>
              </div>
              <div class="font-mono text-[10px] text-foreground-faint ml-3 shrink-0">
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
          onclick={handleOpenExisting}
          class="text-[11px] text-primary"
          disabled={openingPath !== null}
        >
          {#if openingPath === "__dialog__"}
            <LoaderCircle class="w-3 h-3 animate-spin mr-1.5" />
          {/if}
          Open Existing Vault
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onclick={startCreate}
          class="text-[11px] text-muted-foreground"
          disabled={openingPath !== null}
        >
          Create New Vault
        </Button>
      </div>
    {/if}

    <!-- Operation-level error -->
    {#if errorMsg}
      <p
        class="font-sans text-xs text-destructive mt-4 text-center max-w-[300px] relative z-10"
        role="alert"
      >
        {errorMsg}
      </p>
    {/if}
  </div>
{/if}
