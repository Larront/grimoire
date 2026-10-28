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
  import { isTypingIn } from "$lib/utils/keyboard";
  import "../app.css";

  const { children } = $props();

  // Dev-only toast harness (src/lib/components/dev/ToastLab.svelte). The import
  // is inside the DEV branch on purpose: Vite replaces `import.meta.env.DEV`
  // with `false` for production, so both the branch and the dynamic import are
  // eliminated and the component never enters a release bundle.
  let ToastLab = $state<typeof import("$lib/components/dev/ToastLab.svelte").default | null>(null);
  if (import.meta.env.DEV) {
    import("$lib/components/dev/ToastLab.svelte").then((m) => (ToastLab = m.default));
  }

  // Load persisted global prefs once at startup (fire-and-forget).
  appPrefs.load();

  // Check for a new release on startup (no-ops outside the Tauri runtime).
  checkForUpdates();

  // Keep the OS window title on the open ledger (issue #118): taskbar and
  // alt-tab identify the world, not just the app.
  $effect(() => {
    // The example by its own name, marked as one (2026-10 design review).
    const name = !ledger.isOpen
      ? null
      : ledger.isSample
        ? `${ledger.worldName} (example)`
        : ledger.worldName || null;
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

  // The webview's own menu — Back, Refresh, Save as… — belongs to a browser. Anywhere
  // the app has no menu of its own, a right-click used to raise it, and its Refresh
  // reloads the whole app (2026-10 design review). It stays where it is the GM's tool:
  // in text they can edit (spelling, paste) and over text they have selected (copy).
  function onContextMenu(e: MouseEvent) {
    if (e.defaultPrevented || isTypingIn(e.target)) return;
    if (!(window.getSelection()?.isCollapsed ?? true)) return;
    e.preventDefault();
  }
</script>

<svelte:window oncontextmenu={onContextMenu} />

<ThemeWatcher />
<!-- closeButton is set per-toast (errors, import failures) — transient success
     and undo toasts stay clean; see $lib/toast.

     The icons are passed in because sonner ships solid Heroicons-style glyphs,
     and every other icon in Grimoire is a stroked lucide one — a filled disc in
     the corner of a toast is visibly from another set. circle-check / circle-x
     are the pair DESIGN.md §6 names for confirmation and failure, and they are
     what makes the status legible without relying on the hue (red and green are
     invisible to ~8% of male users). Sonner's own error glyph is an
     exclamation, not an x. Toast colours and geometry are in src/app.css.

     Expanded, up to five: collapsed, sonner hid every toast past the third and
     tucked the rest behind the front one, so an Undo raised before an error sat out
     of sight while its window ran out, and a lasting one could vanish entirely
     (2026-10 design review). What a world needs no longer comes as toasts, so few
     are ever up at once, and each one is meant to be read. -->
<Toaster
  richColors
  expand
  visibleToasts={5}
  successIcon={circleCheckIcon}
  errorIcon={circleXIcon}
  {closeIcon}
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

{#if ToastLab}
  <ToastLab />
{/if}

<DbRecoveryDialog />
<FormatMigrationDialog />

{#if ledger.isOpen}
  <AppShell />
{:else}
  {@render children?.()}
{/if}
