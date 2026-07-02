import { toast } from "svelte-sonner";
import { logWarn } from "$lib/log";

/**
 * Check GitHub Releases for a newer signed bundle and, if one exists, offer to
 * install it. Verification is handled by the updater plugin against the public
 * key in tauri.conf.json — a tampered bundle fails the minisign check and is
 * rejected before install.
 *
 * Safe to call unconditionally on startup: it no-ops outside the Tauri runtime
 * (e.g. `vite dev` in a plain browser, or static prerender) and swallows
 * network/offline errors so a failed check never blocks the app.
 */
export async function checkForUpdates(): Promise<void> {
  // No Tauri runtime → nothing to update against.
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return;
  }

  try {
    // Dynamic import so the plugin code is never pulled into a non-Tauri build.
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return;

    toast(`Update available — v${update.version}`, {
      description: "A new version of Grimoire is ready to install.",
      duration: Infinity,
      action: {
        label: "Install & restart",
        onClick: async () => {
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await update.downloadAndInstall();
          await relaunch();
        },
      },
    });
  } catch (err) {
    // Offline, no published release yet, or endpoint unreachable — log and move on.
    logWarn("Update check failed:", err);
  }
}
