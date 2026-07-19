import { toast } from "svelte-sonner";
import type { Update } from "@tauri-apps/plugin-updater";
import { toastError } from "$lib/toast";
import { logWarn, logError } from "$lib/log";

const INSTALL_TOAST_ID = "update-install-progress";

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
        onClick: () => void installAndRestart(update),
      },
    });
  } catch (err) {
    // Offline, no published release yet, or endpoint unreachable — log and move on.
    logWarn("Update check failed:", err);
  }
}

/**
 * Download, install, and relaunch into the new version — with continuous
 * feedback. Clicking the action button dismisses the source toast, so without
 * this the download (potentially many seconds over the network) would be
 * completely invisible and the window would look frozen until it abruptly
 * relaunched (#138). A single persistent progress toast fills that gap and, on
 * failure, surfaces an error instead of dying silently.
 */
async function installAndRestart(update: Update): Promise<void> {
  toast.loading("Downloading update…", {
    id: INSTALL_TOAST_ID,
    duration: Infinity,
  });

  try {
    let total = 0;
    let downloaded = 0;

    await update.downloadAndInstall((progress) => {
      switch (progress.event) {
        case "Started":
          total = progress.data.contentLength ?? 0;
          break;
        case "Progress":
          downloaded += progress.data.chunkLength;
          toast.loading(
            total > 0
              ? `Downloading update… ${Math.round((downloaded / total) * 100)}%`
              : `Downloading update… ${Math.round(downloaded / 1_000_000)} MB`,
            { id: INSTALL_TOAST_ID, duration: Infinity },
          );
          break;
        case "Finished":
          toast.loading("Installing — restarting…", {
            id: INSTALL_TOAST_ID,
            duration: Infinity,
          });
          break;
      }
    });

    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (err) {
    // Download/verify/install failed — the minisign check rejects tampered
    // bundles here, but so does a dropped connection. Clear the progress toast
    // and tell the user rather than leaving a spinner up forever.
    logError("Update install failed:", err);
    toast.dismiss(INSTALL_TOAST_ID);
    toastError("Update failed to install. Please try again later.");
  }
}
