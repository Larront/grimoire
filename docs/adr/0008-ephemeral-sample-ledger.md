# The Sample Ledger is an ephemeral bundled resource

First-time onboarding is delivered by a **Sample Ledger** — a small, pre-populated fantasy world shipped as a Tauri bundle resource (`src-tauri/sample-world/`, plain markdown + images, no `.grimoire/`). On *Explore an example world* (from the first-time Splash or the *Explore example world* palette command), the app copies the read-only resource tree into a writable sandbox at `app_data_dir/sample-world/`, resetting it to pristine each time, and opens it **ephemerally**. The only ledger state persisted across a restart is `recent-ledgers.json` (`get_ledger_path` is in-memory only — there is no cross-restart auto-reopen), so "ephemeral" reduces to a single requirement: the sample open goes through the ordinary `open_ledger` (setting in-memory state so the app functions) but the frontend skips the `add_recent_ledger` call. In-memory state is discarded on restart, so a relaunch naturally returns to the Splash. The only way to keep work is *Make this world mine*, which copies the current (edited) sandbox to a GM-chosen location and opens it via the normal `openLedger` path, where it becomes an ordinary persisted ledger. Derived indexes regenerate on open via the existing idempotent Ledger setup framework.

## Considered Options

- **Treat the sample as a normal ledger** (rejected): it would leave a phantom Recent Ledgers entry and flip the GM to the "returning" Splash state forever after one peek. Skipping `add_recent_ledger` for the sample keeps `recents.length === 0` an honest first-run signal and keeps the demo reliably pristine.
- **Open the bundled resource in place** (rejected): the resource dir is read-only (inside the app bundle on macOS, Program Files on Windows), so the ledger could not write its derived indexes or accept edits. The copy-to-sandbox step is mandatory, not a convenience.

## Consequences

- Editing the sample and then restarting *without* adopting loses the changes. This is intended — no commitment was made, and *Make this world mine* is the documented path to persist work.
- The sample cannot use the vanilla `openLedger` path (which unconditionally records recents and persists the current ledger). It needs an ephemeral open that skips both.
- New backend surface is minimal: an ephemeral sample-open path plus one "copy a directory tree to a chosen destination" primitive (shared by *Explore*'s reset-copy and *Make this world mine*).
