# ADR-0010 — Command error posture: toast floor + coded messages

**Status:** Accepted
**Date:** 2026-06-05

## Context

ADR-0009 gave the frontend↔backend seam a typed wrapper but left it
posture-neutral: every call site decided independently what to do on failure.
A survey of the migrated code found five coexisting responses — contextual
toast, silent `.catch(() => {})`, `console.error` + swallow, fallback value, and
the Details Source status machine. Two problems followed:

- **Silent failures.** Some commands could fail and produce no toast, no log, no
  state change — no trail at all.
- **Leaked developer strings.** Commands reject with raw Rust strings
  (`"No ledger open"`, `"Path escapes ledger root"`). Any generic
  `toastError(String(e))` would surface those to a GM mid-session.

An extraction of all ~80 command error strings showed the genuinely
*GM-actionable* failures are a tiny set: a name collision (note/template rename),
an unsupported image format, and a Spotify connection failure. Everything else is
either a bug/never-happens guard or an I/O failure the GM can't act on.

## Decision

The Command Wrapper (`$lib/api`) owns error posture, via two surfaces and a
small message catalog.

- **`api.*`** — on failure: resolve a GM-friendly message, **toast** it, then
  **rethrow**.
- **`api.silent.*`** — on failure: **log** only, then **rethrow**. No toast.
  For background work that owns its own error UI (the Details Source status
  machine) and true fire-and-forget calls (which add their own `.catch`).

Both surfaces **always log the raw error** and **rethrow** — control flow still
aborts, so a failed command never silently proceeds as if it succeeded.

**Message resolution.** Commands stamp genuinely actionable failures with a
stable `ERR_CODE:` prefix on the error string. The wrapper matches the prefix
against a small `code → friendly copy` map; anything unmatched gets one calm
generic line (*"Something went wrong — please try again."*). The raw string is
logged regardless. Current codes:

| Code | Sites | Friendly copy |
| --- | --- | --- |
| `ERR_NAME_TAKEN` | note rename, template rename | "That name is already taken." |
| `ERR_UNSUPPORTED_IMAGE` | image assign / copy | "That image format isn't supported — use PNG, JPG, GIF, or WebP." |
| `ERR_SPOTIFY_AUTH` | Spotify auth flow | "Couldn't connect to Spotify — please try again." |

## Rationale

- **Toast + rethrow (not swallow).** Swallowing would force every result-reading
  caller to null-check and widen all ~100 return types to nullable; worse, the
  Details Source drives its status machine from a thrown error inside a
  try/catch — swallowing would break it. Rethrow composes: callers that need
  cleanup keep their `try/catch` (and drop their now-redundant manual toast);
  callers that don't do nothing, and an uncaught throw in an event handler is
  harmless console noise *after* the user already saw the toast.
- **Error-code convention, not an enum.** A stable `ERR_CODE:` prefix gives the
  robustness of structured errors (match a token we own, not prose) without
  changing `Result<T, String>` to a second error type across ~100 commands. The
  trade is that it's a convention, not type-enforced — acceptable for a
  single-digit set of codes, and a clean later migration to a real enum sits
  behind the same `code → copy` map without touching call sites.
- **Coded only where actionable.** The extraction showed the actionable set is
  ~3. Writing ~100 per-command messages was rejected as low-value; the generic
  floor covers the rest and the operation detail lives in the log.

## Consequences

- Manual `toastError` calls on command failure were removed across the panes,
  dashboard, palette, settings, and ledger selector — the wrapper owns the toast.
  `toastSuccess` and `toastImportFailures` are unaffected.
- Bucket-C calls (telemetry `record_recent`, prefs `save_*`, `get_recent_ledgers`,
  both Details Source modules, `add_recent_ledger`) use `api.silent`.
- A new code is one Rust one-liner (`"ERR_FOO: …"`) plus one entry in the
  wrapper's map. No backend type change.
- `api.silent` still logs, so "silent" suppresses only the *toast* — nothing
  fails without a trace (the original goal).
