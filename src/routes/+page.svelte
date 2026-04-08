<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { vault } from "$lib/stores/vault.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { Folder, LoaderCircle } from "@lucide/svelte";

  let isOpening = $state(false);
  let errorMsg = $state<string | null>(null);

  const vaultName = $derived(vault.path?.split(/[\\/]/).pop() ?? "My Vault");

  // --- Logic placeholders ---
  async function handleOpen() {
    isOpening = true;
    errorMsg = null;
    try {
      await vault.openVault();
    } catch (e) {
      errorMsg = String(e);
    } finally {
      isOpening = false;
    }
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
  <!-- ── Vault home ─────────────────────────────────────────────────────── -->
  <div class="h-full overflow-y-auto">
    <div
      class="flex flex-col gap-12 w-full max-w-lg py-16 px-10 mx-auto reveal"
    >
      <!-- Vault heading -->
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
  </div>{:else}
  <div
    class="flex flex-col items-center justify-center min-h-screen overflow-hidden relative font-body"
  >
    <header class="text-center m-8">
      <h1 class="text-[150px] font-heading">Grimoire</h1>
    </header>

    <div class="flex flex-col mx-auto gap-2">
      <Button
        onclick={handleOpen}
        class="text-lg py-5 px-20"
        disabled={isOpening}
      >
        {#if isOpening}
          <LoaderCircle class="animate-spin" />
          Opening...
        {:else}
          <Folder />
          Open Vault
        {/if}
      </Button>
    </div>
  </div>
{/if}
