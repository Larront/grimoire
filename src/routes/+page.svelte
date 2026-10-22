<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { ledger, type RecentLedger } from "$lib/stores/ledger.svelte";
  import { api, friendlyMessage } from "$lib/api";
  import { Folder, Plus, LoaderCircle, BookOpen, X } from "@lucide/svelte";
  import NewLedgerFields from "$lib/components/NewLedgerFields.svelte";
  import { fieldsReady, ledgerDestination } from "$lib/utils/ledger-name";

  let recentLedgers = $state<RecentLedger[]>([]);
  let isLoadingRecents = $state(true);
  let openingPath = $state<string | null>(null);
  let errorMsg = $state<string | null>(null);

  /**
   * What the Splash says when an open fails: nothing when a dialog has taken the
   * refusal over (a damaged database, notes on an older format) — that dialog says it
   * all — and otherwise the GM's words, never the raw error. It used to print
   * "ERR_DB_CORRUPT: file is not a database" in red under the recovery dialog, and
   * leave it there after Cancel (2026-10 design review).
   */
  function splashError(e: unknown): string | null {
    if (ledger.corruptLedgerPath || ledger.formatMigration) return null;
    return friendlyMessage(e);
  }

  // Create ledger form
  let mode = $state<"idle" | "creating">("idle");
  let newLedgerName = $state("");
  let newLedgerParent = $state<string | null>(null);
  /** Whether Create has been pressed — the fields show their problems from then. */
  let createAttempted = $state(false);

  $effect(() => {
    if (!ledger.isOpen) {
      api
        .getRecentLedgers()
        .then((ledgers) => {
          recentLedgers = ledgers;
        })
        .catch(console.error)
        .finally(() => {
          isLoadingRecents = false;
        });
    }
  });

  async function handleRemoveRecent(ledgerPath: string) {
    try {
      await api.removeRecentLedger(ledgerPath);
      recentLedgers = recentLedgers.filter((v) => v.path !== ledgerPath);
    } catch (e) {
      errorMsg = splashError(e);
    }
  }

  async function handleOpenRecent(ledgerPath: string) {
    openingPath = ledgerPath;
    errorMsg = null;
    try {
      await ledger.openLedger(ledgerPath);
    } catch (e) {
      errorMsg = splashError(e);
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
      errorMsg = splashError(e);
    } finally {
      openingPath = null;
    }
  }

  function startCreate() {
    mode = "creating";
    newLedgerName = "";
    newLedgerParent = null;
    createAttempted = false;
    errorMsg = null;
  }

  function cancelCreate() {
    mode = "idle";
    createAttempted = false;
    errorMsg = null;
  }

  async function handleExploreSample() {
    openingPath = "__sample__";
    errorMsg = null;
    try {
      await ledger.exploreSample();
    } catch (e) {
      errorMsg = splashError(e);
    } finally {
      openingPath = null;
    }
  }

  async function handleCreateLedger() {
    createAttempted = true;
    if (openingPath !== null || !fieldsReady(newLedgerName, newLedgerParent)) return;

    openingPath = "__creating__";
    errorMsg = null;
    try {
      await ledger.openLedger(ledgerDestination(newLedgerParent, newLedgerName));
    } catch (e) {
      errorMsg = splashError(e);
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

  function formatLedgerStats(v: RecentLedger): string {
    const parts: string[] = [];
    if (v.note_count > 0) parts.push(`${v.note_count} note${v.note_count !== 1 ? "s" : ""}`);
    if (v.scene_count > 0) parts.push(`${v.scene_count} scene${v.scene_count !== 1 ? "s" : ""}`);
    if (v.map_count > 0) parts.push(`${v.map_count} map${v.map_count !== 1 ? "s" : ""}`);
    return parts.join(" · ") || "Empty ledger";
  }
</script>

{#if !ledger.isOpen}
  <!-- ── Splash screen ──────────────────────────────────────────────
       This page renders only while no ledger is open; once one opens the
       layout swaps to AppShell (the empty-ledger home lives in LedgerHome,
       rendered from PaneContent). -->

  <div class="flex flex-col items-center justify-center min-h-screen overflow-hidden relative">
    <!-- Radial glow -->
    <div
      class="pointer-events-none absolute top-[30%] left-1/2 -translate-x-1/2 -translate-y-1/2
             w-125 h-75"
      style="background: radial-gradient(ellipse, oklch(0.30 0.03 40 / 30%), transparent 70%)"
    ></div>

    <!-- Title -->
    <div class="text-center relative z-10 splash-fade">
      <h1 class="font-heading text-[52px] text-primary tracking-[1px]">Grimoire</h1>
      <div
        class="w-12 h-px mx-auto mt-3.5"
        style="background: linear-gradient(90deg, transparent, oklch(from var(--primary) l c h / 40%), transparent)"
      ></div>
    </div>

    {#if isLoadingRecents}
      <!-- Minimal loading — title visible, content loads beneath -->
    {:else if mode === "creating"}
      <!-- ── Create new ledger form ───────────────────────────────── -->
      <div class="flex flex-col gap-3 mt-9 w-70 relative z-10 splash-fade-delay-1">
        <span class="text-xs font-semibold text-foreground-muted"> New Ledger </span>

        <NewLedgerFields
          bind:name={newLedgerName}
          bind:parent={newLedgerParent}
          placeholder="My Campaign"
          disabled={openingPath !== null}
          attempted={createAttempted}
          onSubmit={() => void handleCreateLedger()}
          onCancel={cancelCreate}
        />

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
            disabled={openingPath !== null}
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

      <div class="flex flex-col gap-2.5 mt-8 w-70 relative z-10 splash-fade-delay-2">
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
            <div class="text-[11px] opacity-70 font-normal">A small campaign to wander</div>
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
            <div class="text-[11px] opacity-70 font-normal">Start fresh with an empty ledger</div>
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
            <div class="text-[11px] opacity-70 font-normal">Browse for an existing ledger</div>
          </div>
        </Button>
      </div>
    {:else}
      <!-- ── Returning user ───────────────────────────────────── -->
      <div class="w-70 mt-8 relative z-10 splash-fade-delay-1">
        <span class="text-xs font-semibold text-foreground-muted mb-2.5 block">
          Recent Ledgers
        </span>

        <div class="flex flex-col">
          {#each recentLedgers as v (v.path)}
            {#if v.missing}
              <!-- Folder moved, deleted, or on an unmounted drive: not
                   clickable, not silently dropped — removal is the GM's call. -->
              <div
                data-testid="recent-missing"
                class="flex items-center justify-between py-2.5 px-3 rounded-sm
                       border-b border-border text-left"
              >
                <div class="min-w-0 flex-1 opacity-50">
                  <div class="font-heading text-[15px] font-normal text-foreground truncate">
                    {v.name}
                  </div>
                  <div
                    class="font-mono text-[11px] text-foreground-muted mt-0.5 truncate"
                    title={v.path}
                  >
                    Folder not found — {v.path}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Remove {v.name} from recent ledgers"
                  data-testid="recent-remove-btn"
                  class="ml-3 shrink-0 rounded-sm p-1 text-foreground-faint
                         hover:text-foreground hover:bg-(--hover-overlay)
                         transition-colors duration-150 focus-visible:outline-none
                         focus-visible:ring-2 focus-visible:ring-primary"
                  onclick={() => handleRemoveRecent(v.path)}
                >
                  <X class="w-3.5 h-3.5" />
                </button>
              </div>
            {:else}
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
                  <div class="font-mono text-[11px] text-foreground-muted mt-0.5">
                    {formatLedgerStats(v)}
                  </div>
                </div>
                <div class="font-mono text-[11px] text-foreground-faint ml-3 shrink-0">
                  {formatRelativeTime(v.last_opened)}
                </div>
              </button>
            {/if}
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
        class="font-sans text-[11px] text-muted-foreground mt-5 relative z-10
               hover:text-foreground transition-colors duration-150
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
