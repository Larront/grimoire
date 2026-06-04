<script lang="ts">
  import { ledger } from "$lib/stores/ledger.svelte";
  import { appPrefs } from "$lib/stores/app-prefs.svelte";
  import { BookOpen, X } from "@lucide/svelte";
</script>

{#if ledger.isSample && !appPrefs.sampleBannerDismissed}
  <div
    data-testid="sample-banner"
    class="flex items-center justify-between gap-3 border-b border-primary/20 bg-primary/8 px-4 py-2"
  >
    <!-- The accent rides on the icon and border; the prose stays neutral -->
    <div class="flex items-center gap-2 min-w-0">
      <BookOpen class="size-3.5 shrink-0 text-primary" />
      <p class="text-xs text-muted-foreground">
        You're exploring an example world. Poke around freely; nothing here affects your real ledgers.
      </p>
    </div>
    <button
      aria-label="Dismiss banner"
      onclick={() => appPrefs.setSampleBannerDismissed(true)}
      class="shrink-0 rounded p-1 text-muted-foreground hover:bg-primary/10 hover:text-foreground transition-colors"
    >
      <X class="size-3.5" />
    </button>
  </div>
{/if}
