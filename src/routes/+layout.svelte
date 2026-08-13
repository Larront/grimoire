<script lang="ts">
  import AppShell from "$lib/components/AppShell.svelte";
  import DbRecoveryDialog from "$lib/components/DbRecoveryDialog.svelte";
  import FormatMigrationDialog from "$lib/components/FormatMigrationDialog.svelte";
  import ThemeWatcher from "$lib/components/ThemeWatcher.svelte";
  import { Toaster } from "svelte-sonner";
  import { CircleCheck, CircleX, X } from "@lucide/svelte";
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
    let closing = false;
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      const appWindow = getCurrentWindow();
      appWindow.onCloseRequested(async (event) => {
        if (closing) return;
        event.preventDefault();
        closing = true;
        try {
          await pendingSaves.flushAll();
        } finally {
          // Use destroy(), not close(): calling close() from inside a
          // close-requested handler re-emits the event and the window never
          // actually tears down (Tauri v2 re-entrancy). destroy() force-closes
          // without re-firing, so the flush-then-close path completes.
          await appWindow.destroy();
        }
      });
    });
  }
</script>

<ThemeWatcher />
<!-- closeButton is set per-toast (errors, import failures) — transient success
     and undo toasts stay clean; see $lib/toast.

     The icons are passed in because sonner ships solid Heroicons-style glyphs,
     and every other icon in Grimoire is a stroked lucide one — a filled disc in
     the corner of a toast is visibly from another set. circle-check / circle-x
     are the pair DESIGN.md §6 names for confirmation and failure, and they are
     what makes the status legible without relying on the hue (red and green are
     invisible to ~8% of male users). Sonner's own error glyph is an
     exclamation, not an x. Toast colours and geometry are in src/app.css. -->
<Toaster
  richColors
  successIcon={circleCheckIcon}
  errorIcon={circleXIcon}
  closeIcon={closeIcon}
/>

{#snippet circleCheckIcon()}
  <CircleCheck size={16} strokeWidth={2} aria-hidden="true" />
{/snippet}

{#snippet circleXIcon()}
  <CircleX size={16} strokeWidth={2} aria-hidden="true" />
{/snippet}

{#snippet closeIcon()}
  <X size={14} strokeWidth={2} aria-hidden="true" />
{/snippet}

<DbRecoveryDialog />
<FormatMigrationDialog />

{#if ledger.isOpen}
  <AppShell />
{:else}
  {@render children?.()}
{/if}
