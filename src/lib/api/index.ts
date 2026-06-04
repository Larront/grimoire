// The Command Wrapper (see CONTEXT.md). The single boundary over the generated
// Command Bindings. Frontend code imports commands from here — never from
// `$lib/bindings.gen` directly (ADR-0009).
//
// Throw mode (ADR-0009): each command returns `Promise<T>` and rejects with the
// Rust `Err` payload. Callers that already own their error handling (the entity
// stores, the Details Source modules) use these typed commands directly. A
// toast-on-throw posture will be layered here once the error posture is settled;
// doing so changes nothing at the call sites.
import { invoke } from "@tauri-apps/api/core";
import { commands } from "$lib/bindings.gen";
import type { MapAnnotation } from "$lib/bindings.gen";

export const api = {
  ...commands,
  /**
   * Carve-out (ADR-0009): `create_annotation` has 14 params, exceeding
   * tauri-specta's `SpectaFn` arity limit, so it is excluded from the generated
   * bindings and hand-typed here over a raw `invoke`. Takes an object (13
   * positional args would be unreadable) matching the Rust parameter names.
   */
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
