<script lang="ts">
  import { ledger } from "$lib/stores/ledger.svelte";
  import { appPrefs } from "$lib/stores/app-prefs.svelte";
  import { X } from "@lucide/svelte";
</script>

{#if ledger.isSample && !appPrefs.sampleBannerDismissed}
  <div
    data-testid="sample-banner"
    class="flex items-center justify-between gap-3 border-b border-primary/20 bg-primary/8 px-4 py-2"
  >
    <p class="text-xs text-primary/80">
      You're exploring an example world — poke around freely, nothing here affects your real ledgers.
    </p>
    <button
      aria-label="Dismiss banner"
      onclick={() => appPrefs.dismissSampleBanner()}
      class="shrink-0 rounded p-0.5 text-primary/60 hover:bg-primary/10 hover:text-primary/80 transition-colors"
    >
      <X class="size-3.5" />
    </button>
  </div>
{/if}
