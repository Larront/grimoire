<script lang="ts">
  import AppShell from "$lib/components/AppShell.svelte";
  import DbRecoveryDialog from "$lib/components/DbRecoveryDialog.svelte";
  import ThemeWatcher from "$lib/components/ThemeWatcher.svelte";
  import { Toaster } from "svelte-sonner";
  import { ledger } from "../lib/stores/ledger.svelte";
  import { appPrefs } from "../lib/stores/app-prefs.svelte";
  import { pendingSaves } from "$lib/stores/pending-saves";
  import { checkForUpdates } from "$lib/updater";
  import "../app.css";

  const { children } = $props();

  // Load persisted global prefs once at startup (fire-and-forget).
  appPrefs.load();

  // Check for a new release on startup (no-ops outside the Tauri runtime).
  checkForUpdates();

  // Keep the OS window title on the open ledger (issue #118): taskbar and
  // alt-tab identify the world, not just the app.
  $effect(() => {
    const name = ledger.isSample
      ? "Example World"
      : ledger.isOpen && ledger.path
        ? (ledger.path.split(/[\\/]/).pop() ?? null)
        : null;
    const title = name ? `${name} — Grimoire` : "Grimoire";
    if ("__TAURI_INTERNALS__" in window) {
      import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
        .catch(() => {});
    }
  });

  // Intercept window close once to flush pending note saves (issue #106) —
  // otherwise an edit inside the 500ms save debounce is silently dropped.
  // The re-entrant close() passes straight through the flushed guard.
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    let flushed = false;
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      const appWindow = getCurrentWindow();
      appWindow.onCloseRequested(async (event) => {
        if (flushed) return;
        event.preventDefault();
        flushed = true;
        try {
          await pendingSaves.flushAll();
        } finally {
          await appWindow.close();
        }
      });
    });
  }
</script>

<ThemeWatcher />
<Toaster richColors closeButton />
<DbRecoveryDialog />

{#if ledger.isOpen}
  <AppShell />
{:else}
  {@render children?.()}
{/if}
