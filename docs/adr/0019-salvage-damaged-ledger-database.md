# ADR-0019 — Salvage a damaged ledger database before asking to rebuild it

**Status:** Accepted
**Date:** 2026-10-23

## Context

A world's database (`.grimoire/ledger.db`) that fails its `quick_check` on open is restored from
the `.grimoire/backups` snapshot when one is usable (issue #116). Without one, the only fix was
`DbRecoveryDialog`'s **Rebuild from notes**: notes come back from their files and maps from their
images, but scenes, pins and Quick Notes — which only the database holds
([ADR-0018](./0018-quick-notes-are-rows-not-notes.md)) — are gone.

A damaged SQLite file is rarely damaged everywhere. A torn write or a bad sector usually spoils a
few pages and leaves the rest readable. The 2026-10 design review asked whether SQLite's own
recovery could get those rows back before the GM is asked anything.

## Findings

- **The bundled SQLite does not include it.** libsqlite3-sys 0.28 (`bundled`, pulled in for
  diesel 2.3) compiles SQLite **3.45.0** from the amalgamation. The recover API
  (`sqlite3_recover_*`, SQLite ≥ 3.40) lives in `ext/recover/` and is never part of the
  amalgamation; no libsqlite3-sys feature adds it. It also reads pages through the
  `sqlite_dbpage` virtual table, which needs `SQLITE_ENABLE_DBPAGE_VTAB` — not among the flags
  libsqlite3-sys sets.
- **Bundling it is small.** libsqlite3-sys honours a `LIBSQLITE3_FLAGS` environment variable for
  extra compile flags, so `src-tauri/.cargo/config.toml` sets `-DSQLITE_ENABLE_DBPAGE_VTAB` for
  every cargo invocation in `src-tauri/` (`tauri dev`, `tauri build`, tests). The extension is
  three public-domain C files (`sqlite3recover.c`, `sqlite3recover.h`, `dbdata.c`, ~125 KB),
  vendored unmodified at `version-3.45.0` in `src-tauri/vendor/sqlite-recover/` and compiled by
  `build.rs` with `cc` against the bundled `sqlite3.h` (exported as `DEP_SQLITE3_INCLUDE`). Its
  symbols resolve against libsqlite3-sys's static SQLite, so there is still one SQLite in the
  binary. No CLI is shipped.
- **It works on the damage that matters.** A test overwrites a page in the middle of a 400-note
  table: `quick_check` fails, recovery keeps every scene, map, pin and Quick Note on undamaged
  pages, keeps rowids (so a pin still points at its map), and the result passes `quick_check` and
  the migrations.

## Decision

**On a corrupt open with no usable snapshot, salvage first; ask only if the salvage fails or
brings nothing back.** The order in `open_ledger` is: restore from snapshot → salvage → rebuild
dialog. The snapshot stays first because it is a consistent image; a salvage can be missing rows
nobody can name.

`db::salvage_damaged_db`:

1. Recovers the damaged file (opened read-only, never changed) into `ledger.db.salvage`.
2. Proves it the way every open is proved: `quick_check`, then the app's migrations.
3. Settles rows whose parent was on a lost page as the schema would have settled a deletion:
   `ON DELETE SET NULL` clears the reference (a pin loses its note), anything else removes the
   row (a pin whose map is gone), repeated until `foreign_key_check` is clean.
4. Uses it only if it holds at least one scene, map with an image, pin or Quick Note. Otherwise the
   rebuild gives the same result, and the dialog asks first.
5. Moves the damaged file aside as `ledger.db.corrupt-<ts>` (as a restore does) and puts the
   salvage in its place.

`open_ledger` then runs the rebuild's own recovery over it: maps the database lost come back from
their images, without pins. Notes come back from their files on every open regardless. The open
result carries a `SalvageSummary`, and a lasting, closable toast says what came back and that
whatever was on the damaged part of the file couldn't.

## Considered Options

- **Ship the `sqlite3` CLI and run `.recover`** (rejected) — a second binary per platform to sign
  and update, and a subprocess on the open path, for the same C code compiled in.
- **Copy table by table with `SELECT`, skipping rows that error** (rejected) — needs no C, but
  gives up at the first unreadable interior page and needs an intact `sqlite_schema`. The recover
  extension reads leaf pages directly and rebuilds the schema.
- **Salvage into a rebuilt database, merging rows table by table** (not needed) — the salvage
  already is a fresh database holding the readable rows. Running the rebuild's recoveries over it
  (notes from files, maps from images) is the merge.
- **Salvage even when a snapshot exists** (rejected) — the snapshot is taken as a world opens and
  as it closes, so it is rarely behind, and it is whole.

## Consequences

- **libsqlite3-sys upgrades must update the vendored files** to the new bundled SQLite version
  (see `vendor/sqlite-recover/README.md`). `the_bundled_sqlite_can_read_a_damaged_database_page_by_page`
  fails if the `sqlite_dbpage` flag is lost, and `recover::recover_into` refuses rather than
  pretending.
- **Cargo must run from `src-tauri/`** for the flag to apply, as it already must for
  `rust-toolchain.toml`. A `--manifest-path` build from the repo root would still compile, with
  salvage quietly falling back to the dialog.
- **A salvage cannot say what it lost.** The toast says rows on the damaged part are gone without
  naming them. A pin whose note row was lost is unlinked without being listed among the
  [[unlinked pins]] (#224), because nothing remembers which note it opened.
- **The rebuild dialog is now the last resort**, reached when the file is unreadable as SQLite or
  holds nothing only the database could.
