/**
 * Frontend logging seam (issue #107). Mirrors everything to the devtools
 * console and, inside the Tauri runtime, forwards to tauri-plugin-log so it
 * lands in the persisted log file a beta user can attach to a bug report.
 * Fire-and-forget: a logging failure must never break the calling path.
 */

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function forward(level: "error" | "warn" | "info", message: string): void {
  if (!inTauri) return;
  import("@tauri-apps/plugin-log")
    .then((log) => log[level](message))
    .catch(() => {});
}

function stringify(parts: unknown[]): string {
  return parts
    .map((p) => (p instanceof Error ? (p.stack ?? p.message) : typeof p === "string" ? p : JSON.stringify(p)))
    .join(" ");
}

export function logError(...parts: unknown[]): void {
  console.error(...parts);
  forward("error", stringify(parts));
}

export function logWarn(...parts: unknown[]): void {
  console.warn(...parts);
  forward("warn", stringify(parts));
}

export function logInfo(...parts: unknown[]): void {
  console.info(...parts);
  forward("info", stringify(parts));
}
