<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { ledger, type RecentLedger } from "$lib/stores/ledger.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import { tabs } from "$lib/stores/tabs.svelte";
  import type { Note } from "$lib/types/ledger";
  import { Folder, Plus, LoaderCircle, BookOpen } from "@lucide/svelte";
  import { searchPalette } from "$lib/stores/search.svelte";
  import { validateLedgerName, MISSING_LOCATION_ERROR } from "$lib/utils/ledger-name";

  let recentLedgers = $state<RecentLedger[]>([]);
  let isLoadingRecents = $state(true);
  let openingPath = $state<string | null>(null);
  let errorMsg = $state<string | null>(null);
  let isCreatingNote = $state(false);

  // Create ledger form
  let mode = $state<"idle" | "creating">("idle");
  let newLedgerName = $state("");
  let newLedgerParent = $state<string | null>(null);
  let nameError = $state<string | null>(null);
  let isPickingLocation = $state(false);

  const ledgerName = $derived(ledger.path?.split(/[\\/]/).pop() ?? "My Ledger");

  $effect(() => {
    if (!ledger.isOpen) {
      invoke<RecentLedger[]>("get_recent_ledgers")
        .then((ledgers) => {
          recentLedgers = ledgers;
        })
        .catch(console.error)
        .finally(() => {
          isLoadingRecents = false;
        });
    }
  });

  async function handleOpenRecent(ledgerPath: string) {
    openingPath = ledgerPath;
    errorMsg = null;
    try {
      await ledger.openLedger(ledgerPath);
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
      await ledger.openLedger();
    } catch (e) {
      errorMsg = String(e);
    } finally {
      openingPath = null;
    }
  }

  function startCreate() {
    mode = "creating";
    newLedgerName = "";
    newLedgerParent = null;
    nameError = null;
    errorMsg = null;
  }

  function cancelCreate() {
    mode = "idle";
    nameError = null;
    errorMsg = null;
  }

  async function handleExploreSample() {
    openingPath = "__sample__";
    errorMsg = null;
    try {
      await ledger.exploreSample();
    } catch (e) {
      errorMsg = String(e);
    } finally {
      openingPath = null;
    }
  }

  async function handleChooseLocation() {
    isPickingLocation = true;
    try {
      const selected = await open({
        directory: true,
        title: "Choose Location",
      });
      if (selected && typeof selected === "string") {
        newLedgerParent = selected;
        if (nameError === MISSING_LOCATION_ERROR) nameError = null;
      }
    } finally {
      isPickingLocation = false;
    }
  }

  async function handleCreateLedger() {
    const name = newLedgerName.trim();
    nameError = validateLedgerName(name, newLedgerParent);
    if (nameError) return;

    openingPath = "__creating__";
    errorMsg = null;
    try {
      await ledger.openLedger(`${newLedgerParent}/${name}`);
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
      tabs.openTab({
        type: "note",
        id: newNote.id,
        title: "Untitled",
        rename: true,
      });
    } catch (e) {
      errorMsg = String(e);
    } finally {
      isCreatingNote = false;
    }
  }

  function formatLedgerStats(v: RecentLedger): string {
    const parts: string[] = [];
    if (v.note_count > 0)
      parts.push(`${v.note_count} note${v.note_count !== 1 ? "s" : ""}`);
    if (v.scene_count > 0)
      parts.push(`${v.scene_count} scene${v.scene_count !== 1 ? "s" : ""}`);
    if (v.map_count > 0)
      parts.push(`${v.map_count} map${v.map_count !== 1 ? "s" : ""}`);
    return parts.join(" · ") || "Empty ledger";
  }
</script>

{#if ledger.isOpen}
  <!-- ── Ledger home (new ledger) ────────────────────────────────── -->
  <div class="flex flex-col items-center justify-center h-full">
    <div
      class="flex flex-col items-center gap-8 w-full max-w-120 px-10 splash-fade"
    >
      <h1
        class="font-heading text-[2rem] font-normal text-foreground text-center leading-tight"
      >
        {ledgerName}
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
          {#if notes.noteCount === 0}
            <button
              data-testid="start-from-template"
              onclick={() => {
                searchPalette.open = true;
                searchPalette.openToTemplatePicker = true;
              }}
              class="font-sans text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              …or start from a template
            </button>
          {/if}
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
             w-125 h-75"
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
      <!-- ── Create new ledger form ───────────────────────────────── -->
      <div
        class="flex flex-col gap-3 mt-9 w-70 relative z-10 splash-fade-delay-1"
      >
        <span
          class="font-mono text-[10.5px] uppercase tracking-widest text-foreground-faint"
        >
          New Ledger
        </span>

        <!-- Ledger name -->
        <div class="flex flex-col gap-1.5">
          <label
            for="ledger-name"
            class="font-sans text-[11px] text-muted-foreground"
          >
            Name
          </label>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            id="ledger-name"
            type="text"
            placeholder="My Campaign"
            bind:value={newLedgerName}
            autofocus
            disabled={openingPath !== null}
            onkeydown={(e) => {
              if (e.key === "Enter") handleCreateLedger();
              if (e.key === "Escape") cancelCreate();
            }}
            class="h-9 px-3 rounded-[6px] bg-(--hover-overlay) border border-border
                   text-[13px] text-foreground placeholder:text-foreground-faint
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-primary
                   focus-visible:ring-offset-1 focus-visible:ring-offset-background
                   disabled:opacity-50 w-full"
          />
        </div>

        <!-- Storage location -->
        <div class="flex flex-col gap-1.5">
          <span class="font-sans text-[11px] text-muted-foreground"
            >Location</span
          >
          <button
            type="button"
            onclick={handleChooseLocation}
            disabled={openingPath !== null || isPickingLocation}
            class="h-9 px-3 rounded-[6px] bg-(--hover-overlay) border border-border
                   flex items-center gap-2 text-left w-full min-w-0
                   hover:bg-(--background-elevated) transition-colors duration-150
                   disabled:opacity-50 cursor-default"
          >
            <Folder class="w-3.5 h-3.5 shrink-0 text-muted-foreground/70" />
            {#if newLedgerParent}
              <span
                class="font-sans text-[12px] text-foreground truncate min-w-0"
              >
                {newLedgerParent}
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
          <p
            class="font-sans text-[11px] text-destructive leading-snug"
            role="alert"
          >
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
            onclick={handleCreateLedger}
            disabled={openingPath !== null ||
              !newLedgerName.trim() ||
              !newLedgerParent}
            class="flex-1 text-[11px]"
          >
            {#if openingPath === "__creating__"}
              <LoaderCircle class="w-3 h-3 animate-spin mr-1.5" />
              Creating...
            {:else}
              Create Ledger
            {/if}
          </Button>
        </div>
      </div>
    {:else if recentLedgers.length === 0}
      <!-- ── First-time user ──────────────────────────────────── -->
      <p
        class="font-sans text-sm text-muted-foreground mt-7 text-center max-w-70
               leading-relaxed relative z-10 splash-fade-delay-1"
      >
        A worldbuilding ledger for your campaigns, lore, maps, and sessions.
      </p>

      <div
        class="flex flex-col gap-2.5 mt-8 w-70 relative z-10 splash-fade-delay-2"
      >
        <!-- Primary: Explore sample -->
        <Button
          onclick={handleExploreSample}
          class="justify-start gap-2.5 h-auto py-3 px-4"
          disabled={openingPath !== null}
        >
          {#if openingPath === "__sample__"}
            <LoaderCircle class="w-4 h-4 animate-spin shrink-0" />
          {:else}
            <BookOpen class="w-4 h-4 shrink-0" />
          {/if}
          <div class="text-left">
            <div class="text-sm font-semibold">Explore an example world</div>
            <div class="text-[10px] opacity-70 font-normal">
              A small campaign to wander before you build your own
            </div>
          </div>
        </Button>

        <!-- Secondary: Create / Open -->
        <Button
          variant="secondary"
          onclick={startCreate}
          class="justify-start gap-2.5 h-auto py-3 px-4"
          disabled={openingPath !== null}
        >
          <Plus class="w-4 h-4 shrink-0" />
          <div class="text-left">
            <div class="text-sm font-semibold">Create New Ledger</div>
            <div class="text-[10px] opacity-70 font-normal">
              Start fresh with an empty ledger
            </div>
          </div>
        </Button>

        <Button
          variant="ghost"
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
            <div class="text-sm font-semibold">Open Existing Ledger</div>
            <div class="text-[10px] opacity-70 font-normal">
              Browse for an existing ledger
            </div>
          </div>
        </Button>
      </div>
    {:else}
      <!-- ── Returning user ───────────────────────────────────── -->
      <div class="w-70 mt-8 relative z-10 splash-fade-delay-1">
        <span
          class="font-mono text-[10.5px] uppercase tracking-widest text-foreground-faint mb-2.5 block"
        >
          Recent Ledgers
        </span>

        <div class="flex flex-col">
          {#each recentLedgers as v (v.path)}
            <button
              class="flex items-center justify-between py-2.5 px-3 rounded-sm
                     border-b border-border text-left
                     hover:bg-(--hover-overlay) transition-colors duration-150
                     disabled:opacity-50"
              disabled={openingPath !== null}
              onclick={() => handleOpenRecent(v.path)}
            >
              <div class="min-w-0 flex-1">
                {#if openingPath === v.path}
                  <div class="flex items-center gap-2">
                    <LoaderCircle
                      class="w-3.5 h-3.5 animate-spin text-primary shrink-0"
                    />
                    <span
                      class="font-heading text-[15px] font-normal text-foreground truncate"
                    >
                      {v.name}
                    </span>
                  </div>
                {:else}
                  <div
                    class="font-heading text-[15px] font-normal text-foreground truncate"
                  >
                    {v.name}
                  </div>
                {/if}
                <div class="font-mono text-[10px] text-foreground-muted mt-0.5">
                  {formatLedgerStats(v)}
                </div>
              </div>
              <div
                class="font-mono text-[10px] text-foreground-faint ml-3 shrink-0"
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
          onclick={handleOpenExisting}
          class="text-[11px] text-primary"
          disabled={openingPath !== null}
        >
          {#if openingPath === "__dialog__"}
            <LoaderCircle class="w-3 h-3 animate-spin mr-1.5" />
          {/if}
          Open Existing Ledger
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onclick={startCreate}
          class="text-[11px] text-muted-foreground"
          disabled={openingPath !== null}
        >
          Create New Ledger
        </Button>
      </div>

      <!-- Quiet replay link for returning users -->
      <button
        data-testid="splash-explore-sample"
        class="font-sans text-[11px] text-foreground-faint mt-5 relative z-10
               hover:text-muted-foreground transition-colors duration-150
               disabled:opacity-50"
        onclick={handleExploreSample}
        disabled={openingPath !== null}
      >
        {#if openingPath === "__sample__"}
          <LoaderCircle class="w-3 h-3 animate-spin inline mr-1" />
        {/if}
        New to Grimoire? Explore an example world
      </button>
    {/if}

    <!-- Operation-level error -->
    {#if errorMsg}
      <p
        class="font-sans text-xs text-destructive mt-4 text-center max-w-75 relative z-10"
        role="alert"
      >
        {errorMsg}
      </p>
    {/if}
  </div>
{/if}
