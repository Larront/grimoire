# ADR-0009 — tauri-specta generates the typed command seam

**Status:** Accepted
**Date:** 2026-06-05

## Context

The frontend↔backend command seam is the most-used interface in the app — ~88
distinct `#[tauri::command]`s reached from ~150 raw `invoke()` call sites across
~32 frontend files — yet no module owns it. Each call site independently re-decides
three things:

- **Command identity** — the command-name string (`"read_note_content"`) and the
  camelCase arg-shape (`{ notePath }`) that Tauri silently maps to the Rust
  `note_path`. Both are stringly-typed and fail only at runtime.
- **Return type** — hand-written TS mirrors of the Rust return structs (in
  `types/ledger.ts`), kept in sync manually. Nothing prevents drift.
- **Error posture** — three incompatible conventions coexist: toast, silent
  `.catch(() => …)`, and rethrow.

This is the "shallow seam smeared across N callers" friction from the
architecture review (candidate #2). Renaming a Rust command means grepping 32
files; "what can the frontend ask the backend?" is unanswerable in one place.

## Decision

Adopt **tauri-specta** to generate a typed TypeScript bindings file from the Rust
command definitions, and consume it through a thin hand-written wrapper that owns
error posture.

- Rust models that cross the seam derive `specta::Type`; commands gain
  `#[specta::specta]`. A `tauri_specta::Builder` collects them and exports
  `src/lib/bindings.gen.ts` (generated, committed, never hand-edited) at
  debug-startup under `#[cfg(debug_assertions)]` — **not** via `cargo test`
  (see Consequences).
- Frontend code never imports `bindings.gen.ts` directly. A single boundary
  module (working name **the command wrapper**) re-exports the generated
  `commands` object with the project's error posture applied. The recently
  extracted Details Source modules are its first consumers.
- The error-handling mode (`Throw` vs `Result`) is deferred to implementation
  time, decided against the generated output and how it meshes with the existing
  `toast.ts` and the Details Source save-status machine.

## Rationale

- **Closes the gaps hand-wrapping can't.** A hand-written typed layer (the Jan /
  Hopp pattern) fixes command-identity and error posture but leaves Rust↔TS
  type-drift as a permanent manual risk — both of those projects' own code notes
  the absence of a compile-time guarantee, and Hopp's hand-wrapper migration is
  visibly incomplete. Codegen removes the drift and the arg-shape footgun for
  free.
- **It is where serious Tauri apps converged.** Of the open-source apps surveyed
  from awesome-tauri, the two most heavily-engineered — Cap (Solid) and
  Whispering (Svelte) — both use tauri-specta. Whispering is **Svelte + Tauri on
  `specta = 2.0.0-rc.25`**, the exact stack and version proposed here: direct
  evidence it works for our framework.
- **Our models are specta-clean.** The Diesel structs that cross the seam are
  plain `i32` / `String` / `Option<T>` / `f32` / `bool` fields already deriving
  `Serialize`/`Deserialize`; adding `specta::Type` is mechanical and the Diesel
  derives do not interfere.

## Considered alternatives

- **Hand-written typed per-command functions** (rejected, but viable fallback):
  ~88 thin TS wrappers grouped by domain, no new Rust deps, no toolchain pin,
  zero RC risk. Solves identity + posture but not type-drift. Rejected because
  codegen closes strictly more of the gap at comparable call-site ergonomics,
  and the survey shows hand-wrapping tends to rot (partial adoption, silent
  drift). Retained as the escape hatch if the RC dependency becomes untenable.
- **Generic `cmd<T>(name, args, opts)` wrapper only** (rejected): centralizes
  error posture but leaves command strings, arg-shapes, and types at every call
  site — solves the smallest part of the problem.
- **Keep raw `invoke()` everywhere** (rejected): the status quo; the friction
  this ADR exists to remove.

## Consequences

- **RC dependency.** `tauri-specta`/`specta` are `2.0.0-rc.*`. Mitigated: same
  version as a 4.6k-star shipping app (Whispering). The architecture is
  forward-compatible — a future stable specta, or a fallback to hand-written
  wrappers, slots in behind the same wrapper surface without touching call sites.
- **Toolchain floor.** `specta` rc.25 uses `fmt::from_fn`, stabilized in Rust
  **1.93**. A `rust-toolchain.toml` pinning `channel >= 1.93` is required so
  contributors and CI don't hit `E0658 (debug_closure_helpers)`. (This was the
  cause of an initial spike false-negative on a stale local 1.92 toolchain.)
- **Bindings are generated at debug-startup, not `cargo test`.** Exporting via a
  `#[cfg(test)]` test that instantiates `Builder::<tauri::Wry>` fails on Windows
  with `STATUS_ENTRYPOINT_NOT_FOUND` (the test exe doesn't get WebView2Loader
  wired the way the real app binary does). Cap's pattern — export inside `run()`
  under `#[cfg(debug_assertions)]` — is used instead.
- **One regeneration discipline.** Adding or changing a command means annotating
  it and re-running the app once in debug to regenerate `bindings.gen.ts`. The
  generated file is committed so CI and non-Rust contributors get types without
  building the backend.
- **Commands returning raw bytes** (e.g. image/audio blobs via
  `tauri::ipc::Response`) can't be typed by specta and stay hand-wrapped in the
  command wrapper, routed to a raw `invoke` — the same carve-out Whispering uses.
