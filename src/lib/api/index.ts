// The Command Wrapper (see CONTEXT.md). The single boundary over the generated
// Command Bindings. Frontend code imports commands from here — never from
// `$lib/bindings.gen` directly (ADR-0009).
//
// Error posture (ADR-0010):
//   api.*         — on failure: resolve a GM-friendly message, toast it, rethrow.
//   api.silent.*  — on failure: log only, rethrow (no toast). For background work
//                   that owns its own error UI (the Details Source) or true
//                   fire-and-forget calls (which add their own `.catch`).
// Both rethrow so control flow still aborts — a failed command never silently
// proceeds as if it succeeded. The raw (developer) error is always logged; the
// GM only ever sees friendly copy.
import { invoke } from "@tauri-apps/api/core";
import { commands } from "$lib/bindings.gen";
import type { MapAnnotation } from "$lib/bindings.gen";
import { toastError } from "$lib/toast";

// ── Friendly-message resolution ──────────────────────────────────────────────
// Commands stamp genuinely user-actionable failures with a stable `ERR_CODE:`
// prefix (see the Rust command modules). Everything else falls through to one
// calm generic line — the technical detail goes to the log, not the GM.
const FRIENDLY_BY_CODE: Record<string, string> = {
  ERR_NAME_TAKEN: "That name is already taken.",
  ERR_UNSUPPORTED_IMAGE: "That image format isn't supported — use PNG, JPG, GIF, or WebP.",
  ERR_UNSUPPORTED_PDF: "That file isn't a PDF.",
  ERR_SPOTIFY_AUTH: "Couldn't connect to Spotify — please try again.",
};

// Honest for both reads and writes — "your work is safe" would mislead when a
// save is what failed.
const GENERIC_MESSAGE = "Something went wrong — please try again.";

function friendlyMessage(error: unknown): string {
  const raw = String(error);
  const match = raw.match(/^([A-Z][A-Z0-9_]+):/);
  if (match && FRIENDLY_BY_CODE[match[1]]) return FRIENDLY_BY_CODE[match[1]];
  return GENERIC_MESSAGE;
}

// ── Surface construction ─────────────────────────────────────────────────────
type AnyFn = (...args: unknown[]) => Promise<unknown>;

/** Wrap every generated command with an on-failure behaviour, preserving types. */
function wrap<C extends Record<string, AnyFn>>(
  source: C,
  onError: (error: unknown) => void,
): C {
  const out = {} as Record<string, AnyFn>;
  for (const [name, fn] of Object.entries(source)) {
    out[name] = async (...args: unknown[]) => {
      try {
        return await fn(...args);
      } catch (error) {
        onError(error);
        throw error;
      }
    };
  }
  return out as C;
}

// Carve-out (ADR-0009): create_annotation's 14 params exceed tauri-specta's
// arity limit, so it's excluded from the generated bindings and hand-typed here.
const carveouts = {
  createAnnotation: (args: {
    mapId: number;
    kind: string;
    x: number;
    y: number;
    x2: number | null;
    y2: number | null;
    radius: number | null;
    label: string | null;
    color: string;
    strokeColor: string;
    strokeWidth: number;
    fontSize: number;
    opacity: number;
  }) => invoke<MapAnnotation>("create_annotation", args),
};

const all = { ...commands, ...carveouts } as Record<string, AnyFn>;

type Surface = typeof commands & typeof carveouts;

/** Quiet surface: logs on failure, then rethrows. No toast. */
const silent = wrap(all, (error) => {
  console.error("[api:silent]", error);
}) as Surface;

/** Default surface: toasts a friendly message on failure, then rethrows.
 *  `api.silent.*` is the quiet variant for background / fire-and-forget calls. */
export const api = Object.assign(
  wrap(all, (error) => {
    console.error("[api]", error);
    toastError(friendlyMessage(error));
  }) as Surface,
  { silent },
);
