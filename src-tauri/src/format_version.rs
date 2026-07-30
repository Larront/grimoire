//! [[Ledger Format Version]] — the stamp recording which on-disk format a
//! ledger's *notes* are written in, and the three-outcome gate in front of
//! changing it (ADR-0017, issue #183).
//!
//! Two things make this file's shape non-obvious, and both are load-bearing:
//!
//! **The stamp lives in its own file, not in `.grimoire/prefs.json`.**
//! Preferences are read with `.ok()` and `unwrap_or_default()`
//! (`commands/preferences.rs`), so a mangled prefs file silently becomes empty.
//! That is the right posture for "which accent colour" and catastrophic for
//! "which format are your files in", because absence reads as *old* and offers
//! to rewrite hundreds of already-correct notes. Different failure appetites
//! must not share a file — hence a corrupt stamp here fails loudly rather than
//! defaulting to anything.
//!
//! **Both mismatch outcomes are refusals.** There is no compatibility mode and
//! no "open at your own risk", because this mechanism is the *sole* guard
//! against old-format content: with no reader underneath, opening an
//! un-migrated vault does not expose the GM to a risk they accepted, it
//! destroys content they will not see leave.

use std::path::{Path, PathBuf};

/// The note format this build of Grimoire reads and writes: the highest
/// `to_version` in the [[Format Migration]] registry, *derived* from the array
/// rather than declared beside it, so shipping a migration that never runs is not
/// something you can forget your way into.
pub const APP_FORMAT_VERSION: u32 = crate::format_migration::target_version();

/// Where the stamp lives. Inside `.grimoire/` because that is Grimoire's own
/// bookkeeping — writing it is the one thing exempt from the consent rule.
pub fn stamp_path(ledger_path: &Path) -> PathBuf {
    ledger_path.join(".grimoire").join("format-version")
}

/// Read the vault's stamp.
///
/// A missing file is **0** — never "unknown" and never "current". No attempt is
/// made to tell a pre-versioning vault from a brand-new one: the distinction
/// dissolves, because a new vault has no notes and a foreign Obsidian folder has
/// no old blocks, so both find no work and are stamped in silence.
///
/// Anything present that is not a bare non-negative integer is an error. A
/// stamp that cannot be read must fail loudly; defaulting it to a value is the
/// exact failure this file exists separately to avoid.
pub fn read_stamp(ledger_path: &Path) -> Result<u32, String> {
    let path = stamp_path(ledger_path);
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => {
            return Err(format!(
                "ERR_FORMAT_STAMP_UNREADABLE: could not read {}: {e}",
                path.display()
            ))
        }
    };

    parse_stamp(&raw).ok_or_else(|| {
        format!(
            "ERR_FORMAT_STAMP_UNREADABLE: {} does not hold a format version (found {:?})",
            path.display(),
            raw.chars().take(40).collect::<String>()
        )
    })
}

/// Parse stamp file contents: one bare non-negative integer, surrounding
/// whitespace forgiven (an editor's trailing newline is not corruption).
/// `None` means unparseable — including empty, which is not 0.
fn parse_stamp(raw: &str) -> Option<u32> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || !trimmed.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    trimmed.parse::<u32>().ok()
}

/// Write the stamp. Grimoire's own bookkeeping, so it is silent and needs no
/// consent — but it is not best-effort: a stamp that failed to land would
/// re-offer completed work on the next open.
///
/// Written to a temp file and renamed, the same shape as the database snapshot
/// (`db/mod.rs`), because the two failure appetites meet badly here: a read
/// refuses to guess at a damaged stamp, so a half-written one would leave the
/// vault refusing to open with no in-app way back. The rename makes the file
/// either the old value or the new one, never a torn one.
pub fn write_stamp(ledger_path: &Path, version: u32) -> Result<(), String> {
    let path = stamp_path(ledger_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!("Failed to create {} for the format stamp: {e}", parent.display())
        })?;
    }

    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, format!("{version}\n"))
        .map_err(|e| format!("Failed to write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Failed to write {}: {e}", path.display())
    })
}

/// What opening a vault at a given stamp should do. Three outcomes, and two of
/// them are refusals.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FormatGate {
    /// The stamp equals the app's version: open normally, no dialog and no scan
    /// cost beyond what already happens.
    Open,
    /// Behind, with nothing on disk to migrate: stamp forward and open, in
    /// silence. Covers both a brand-new vault and a foreign Obsidian folder —
    /// the GM never learns this mechanism exists.
    StampThenOpen { to: u32 },
    /// Behind, with work to do: the vault does not open until the migration
    /// completes or is declined, and declining opens nothing.
    NeedsMigration { from: u32, to: u32 },
    /// Ahead: refuse, with no button, flag, or setting that opens it anyway.
    ///
    /// The more dangerous direction, and it arrives ordinarily — two machines,
    /// one synced vault, one updated app. Behind fails safe because the
    /// mechanism is built to notice it; ahead fails silently, because the older
    /// app reads a fence it has never heard of, gets nothing, and autosaves the
    /// loss.
    Ahead { vault: u32, app: u32 },
}

/// The comparison, as a pure function.
///
/// `has_migratable_content` is what the scan answers — the migration with the
/// write left off — and it is taken lazily so that "only a vault that is behind
/// pays for the scan" is structural rather than a comment at the call site.
/// This function is the sole authority on which outcome a stamp deserves.
pub fn gate(vault: u32, app: u32, has_migratable_content: impl FnOnce() -> bool) -> FormatGate {
    match vault.cmp(&app) {
        std::cmp::Ordering::Equal => FormatGate::Open,
        std::cmp::Ordering::Greater => FormatGate::Ahead { vault, app },
        std::cmp::Ordering::Less if has_migratable_content() => {
            FormatGate::NeedsMigration { from: vault, to: app }
        }
        std::cmp::Ordering::Less => FormatGate::StampThenOpen { to: app },
    }
}

/// Proof that this gate has been satisfied for one open.
///
/// `finish_open` in `commands/ledger.rs` takes one, so a code path that opens a
/// ledger has to obtain one, and the only two ways to do that each *name* how the
/// vault earned its open: the comparison passing ([`enforce_at_open`]) or a
/// consented migration having just run ([`cleared_by_consented_migration`]).
/// That is the guarantee, and it is a guarantee about legibility rather than
/// safety — a future caller can mint the second one; what it cannot do is open a
/// ledger without saying which of the two it is claiming.
#[must_use]
#[derive(Debug)]
pub struct FormatCleared(());

/// The refusal a vault ahead of this build earns, in one place because two code
/// paths reach it: the gate at open, and the migration pass refusing to stamp a
/// vault backwards.
pub fn ahead_error(vault: u32, app: u32) -> String {
    format!("ERR_FORMAT_AHEAD: vault notes are on format {vault}, this Grimoire only reads {app}")
}

/// The vault's notes are on the format after a [[Format Migration]] the GM
/// consented to, whether or not every file made it (a partial failure **opens**
/// the vault and names the casualties; the stamp is what stays behind).
pub fn cleared_by_consented_migration() -> FormatCleared {
    FormatCleared(())
}

/// The gate at ledger open.
///
/// Called from the one choke point every open passes through, so it refuses on
/// its own rather than trusting a separate check command to have run — the
/// refusal is the safety property, a check would only be the courtesy, and a
/// future code path that opens without asking meets a locked door.
pub fn enforce_at_open(ledger_path: &Path) -> Result<FormatCleared, String> {
    let vault = read_stamp(ledger_path)?;
    let outcome = gate(vault, APP_FORMAT_VERSION, || {
        crate::format_migration::has_work(ledger_path, vault)
    });

    act(ledger_path, outcome)
}

/// Carry out a gate outcome. Split from `enforce_at_open` so every branch is
/// exercisable without arranging a vault on disk for it.
fn act(ledger_path: &Path, outcome: FormatGate) -> Result<FormatCleared, String> {
    match outcome {
        FormatGate::Open => Ok(FormatCleared(())),
        FormatGate::StampThenOpen { to } => {
            write_stamp(ledger_path, to)?;
            log::info!("[format_version] stamped vault at note format {to} (nothing to migrate)");
            Ok(FormatCleared(()))
        }
        // The refusal *is* the prompt's entry point: the frontend recognises this
        // code, asks `plan_format_migration` what would change, and comes back
        // through `migrate_ledger_format` on a yes. A decline opens nothing, which
        // is this same refusal left standing.
        FormatGate::NeedsMigration { from, to } => Err(format!(
            "ERR_FORMAT_MIGRATION_REQUIRED: vault notes are on format {from}, this Grimoire writes {to}"
        )),
        FormatGate::Ahead { vault, app } => Err(ahead_error(vault, app)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    // ── The comparison, table-driven ─────────────────────────────────────────

    #[test]
    fn gate_covers_equal_behind_ahead_and_absent() {
        // (vault stamp, app version, work found, expected outcome)
        let cases: &[(u32, u32, bool, FormatGate)] = &[
            // Equal — open normally, whatever the scan would have said.
            (0, 0, false, FormatGate::Open),
            (3, 3, false, FormatGate::Open),
            (3, 3, true, FormatGate::Open),
            // Absent, read as 0, against an app that has shipped migrations.
            (0, 1, true, FormatGate::NeedsMigration { from: 0, to: 1 }),
            (0, 1, false, FormatGate::StampThenOpen { to: 1 }),
            // Behind by more than one version — one prompt, one catch-up.
            (1, 4, true, FormatGate::NeedsMigration { from: 1, to: 4 }),
            (1, 4, false, FormatGate::StampThenOpen { to: 4 }),
            // Ahead — a refusal, and the scan's answer is irrelevant to it.
            (2, 1, false, FormatGate::Ahead { vault: 2, app: 1 }),
            (2, 1, true, FormatGate::Ahead { vault: 2, app: 1 }),
            (99, 0, true, FormatGate::Ahead { vault: 99, app: 0 }),
        ];

        for &(vault, app, has_work, expected) in cases {
            assert_eq!(
                gate(vault, app, || has_work),
                expected,
                "vault={vault} app={app} has_work={has_work}"
            );
        }
    }

    #[test]
    fn only_a_vault_behind_pays_for_the_scan() {
        // "A vault whose stamp equals the app's version opens with no dialog and
        // no scan cost beyond what already happens" — so the scan must not even
        // be consulted unless the vault is behind.
        for (vault, app) in [(3u32, 3u32), (4, 3), (1, 0)] {
            let mut asked = false;
            gate(vault, app, || {
                asked = true;
                true
            });
            assert!(!asked, "vault={vault} app={app} must not consult the scan");
        }

        let mut asked = false;
        gate(0, 1, || {
            asked = true;
            false
        });
        assert!(asked, "a vault behind must consult the scan");
    }

    #[test]
    fn ahead_has_no_outcome_that_opens() {
        // Guards the refusal against being "improved" into a compatibility
        // mode: no combination of inputs turns ahead into an open.
        for vault in 1..=8u32 {
            for app in 0..vault {
                for has_work in [false, true] {
                    assert_eq!(gate(vault, app, || has_work), FormatGate::Ahead { vault, app });
                }
            }
        }
    }

    // ── The stamp file ───────────────────────────────────────────────────────

    #[test]
    fn stamp_lives_in_its_own_file_under_grimoire() {
        let dir = tempdir().unwrap();
        assert_eq!(
            stamp_path(dir.path()),
            dir.path().join(".grimoire").join("format-version")
        );
    }

    #[test]
    fn missing_stamp_reads_as_zero() {
        let dir = tempdir().unwrap();
        assert_eq!(read_stamp(dir.path()).unwrap(), 0);
    }

    #[test]
    fn missing_stamp_reads_as_zero_even_when_grimoire_dir_exists() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".grimoire")).unwrap();
        assert_eq!(read_stamp(dir.path()).unwrap(), 0);
    }

    #[test]
    fn write_then_read_round_trips() {
        let dir = tempdir().unwrap();
        write_stamp(dir.path(), 7).unwrap();
        assert_eq!(read_stamp(dir.path()).unwrap(), 7);
    }

    #[test]
    fn write_stamp_creates_the_grimoire_directory() {
        let dir = tempdir().unwrap();
        write_stamp(dir.path(), 1).unwrap();
        assert!(stamp_path(dir.path()).exists());
    }

    #[test]
    fn write_stamp_overwrites_a_previous_value() {
        let dir = tempdir().unwrap();
        write_stamp(dir.path(), 1).unwrap();
        write_stamp(dir.path(), 2).unwrap();
        assert_eq!(read_stamp(dir.path()).unwrap(), 2);
    }

    #[test]
    fn surrounding_whitespace_is_forgiven() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".grimoire")).unwrap();
        for raw in ["3", "3\n", "3\r\n", "  3  \n", "\n3\n"] {
            std::fs::write(stamp_path(dir.path()), raw).unwrap();
            assert_eq!(read_stamp(dir.path()).unwrap(), 3, "raw={raw:?}");
        }
    }

    #[test]
    fn corrupt_stamp_fails_loudly_rather_than_defaulting() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".grimoire")).unwrap();
        // Empty is not 0; a decimal is not an integer; a negative, a hex
        // string, YAML left by a hand-edit, and two numbers are all corruption.
        for raw in ["", "   \n", "abc", "1.0", "-1", "0x2", "2 3", "v2", "4294967296", "version: 2"] {
            std::fs::write(stamp_path(dir.path()), raw).unwrap();
            let err = read_stamp(dir.path()).expect_err(&format!("raw={raw:?} must not parse"));
            assert!(
                err.starts_with("ERR_FORMAT_STAMP_UNREADABLE:"),
                "raw={raw:?} err={err}"
            );
        }
    }

    // ── The gate at open ─────────────────────────────────────────────────────

    #[test]
    fn open_is_allowed_when_the_stamp_matches_the_app() {
        let dir = tempdir().unwrap();
        write_stamp(dir.path(), APP_FORMAT_VERSION).unwrap();
        assert!(enforce_at_open(dir.path()).is_ok());
    }

    #[test]
    fn an_unstamped_vault_with_no_old_content_opens_and_is_stamped_in_silence() {
        // Absence is 0, so an empty folder is behind — but the scan finds nothing
        // to migrate, so it is stamped forward with no dialog. Covers both a
        // brand-new vault and a foreign Obsidian folder.
        let dir = tempdir().unwrap();
        assert!(enforce_at_open(dir.path()).is_ok());
        assert_eq!(read_stamp(dir.path()).unwrap(), APP_FORMAT_VERSION);
    }

    #[test]
    fn an_unstamped_vault_holding_old_content_does_not_open() {
        // End to end through the real scan: an old-grammar timeline is what makes
        // this vault behind-with-work rather than behind-and-empty.
        let dir = tempdir().unwrap();
        std::fs::write(
            dir.path().join("Chronicle.md"),
            "```timeline\nTitle: The Shattering\n```",
        )
        .unwrap();

        let err = enforce_at_open(dir.path()).expect_err("an un-migrated vault must not open");

        assert!(err.starts_with("ERR_FORMAT_MIGRATION_REQUIRED:"), "err={err}");
        assert_eq!(read_stamp(dir.path()).unwrap(), 0, "a refusal may not stamp");
    }

    #[test]
    fn a_vault_ahead_of_the_app_refuses_to_open() {
        let dir = tempdir().unwrap();
        write_stamp(dir.path(), APP_FORMAT_VERSION + 1).unwrap();
        let err = enforce_at_open(dir.path()).expect_err("a vault ahead must not open");
        assert!(err.starts_with("ERR_FORMAT_AHEAD:"), "err={err}");
    }

    #[test]
    fn a_vault_with_nothing_to_migrate_is_stamped_in_silence() {
        // Covers both a brand-new vault and a foreign Obsidian folder: behind,
        // but the scan found no old-format content, so the stamp moves forward
        // with nothing shown to the GM.
        let dir = tempdir().unwrap();
        assert!(act(dir.path(), FormatGate::StampThenOpen { to: 4 }).is_ok());
        assert_eq!(read_stamp(dir.path()).unwrap(), 4);
    }

    #[test]
    fn a_vault_behind_with_work_to_do_does_not_open() {
        let dir = tempdir().unwrap();
        let err = act(dir.path(), FormatGate::NeedsMigration { from: 1, to: 3 })
            .expect_err("a vault needing migration must not open");
        assert!(err.starts_with("ERR_FORMAT_MIGRATION_REQUIRED:"), "err={err}");
        // Refusing must not advance the stamp: the files are still on format 1.
        assert_eq!(read_stamp(dir.path()).unwrap(), 0);
    }

    #[test]
    fn a_corrupt_stamp_refuses_to_open() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".grimoire")).unwrap();
        std::fs::write(stamp_path(dir.path()), "not a version").unwrap();
        let err = enforce_at_open(dir.path()).expect_err("a corrupt stamp must not open");
        assert!(err.starts_with("ERR_FORMAT_STAMP_UNREADABLE:"), "err={err}");
    }
}
