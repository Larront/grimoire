//! [[Format Migration]] — the mechanism that brings a vault's *notes* from one
//! on-disk format to the next, once, with consent (ADR-0017, issue #184).
//!
//! The registry is [`MIGRATIONS`]: **an array and a function pointer**, no
//! framework and no authoring API. A migration owes three things — the version it
//! takes the vault to, one GM-facing sentence, and one function that given a
//! file's text returns either nothing or the rewritten text plus warnings — and
//! the app's target version is [`target_version`], *derived* from the highest
//! entry, so shipping a migration that never runs is not something you can forget
//! your way into.
//!
//! A migration is also handed a [`MigrationContext`], and it holds exactly what
//! the shipped migrations need and nothing speculative: **scene names**. That was
//! the predicted trigger and it arrived on schedule — Scene's rewrite (#185)
//! writes a scene's name into the note beside its id, which no amount of reading
//! the file can supply. Timeline's transform ignores it.
//!
//! Four properties are load-bearing, and each one is a shape rather than a rule
//! someone has to remember:
//!
//! **The scan is the migration with the write left off.** [`run`] takes a `write`
//! flag and is the only code that finds work, so the prompt cannot lie about what
//! will be touched. Separate find-and-do code eventually disagrees — the prompt
//! says 23 notes and 24 are written — and that class of bug is invisible until it
//! is someone's campaign.
//!
//! **Catching up several versions is a fold.** [`fold_migrations`] threads every
//! pending function over the same text in version order, so a note three versions
//! behind is read once and written once.
//!
//! **The backup is written from the bytes the transform read.** [`Affected`]
//! carries the original text alongside the new one for exactly this reason: a
//! second read of the file opens a window in which something else edits it, after
//! which the backup is a copy of something that never existed in the vault.
//!
//! **The stamp is withheld on any failure.** A note that cannot be written is
//! skipped and named; the stamp stays where it was, which makes re-running the
//! resume mechanism for free — work is found by scanning, so the notes already
//! rewritten need nothing on the next pass.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use diesel::prelude::*;
use diesel::SqliteConnection;

mod scene_v2;
mod timeline_v1;

/// What a migration is handed besides the file's text.
///
/// Deliberately not a general-purpose bag: it holds what the shipped migrations
/// actually need, and it grew this one member the day a rewrite could not be a
/// function of the text alone. Loading it costs one query per pass, not per file.
pub struct MigrationContext {
    /// Scene id → name, as the ledger's database holds them right now.
    scene_names: BTreeMap<i32, String>,
}

impl MigrationContext {
    /// Read the context out of an open ledger database.
    ///
    /// Best-effort on the query: a database that cannot list its scenes yields an
    /// empty map, which costs a migrated fence its *name* and never its id. The
    /// alternative — failing the pass — would refuse to open a vault over a copy
    /// of a value the file does not depend on.
    pub fn load(conn: &mut SqliteConnection) -> Self {
        use crate::db::schema::scenes::dsl as s;
        let rows: Vec<(i32, String)> = s::scenes
            .select((s::id, s::name))
            .load(conn)
            .unwrap_or_else(|e| {
                log::warn!("[format_migration] could not read scene names: {e}");
                Vec::new()
            });
        Self {
            scene_names: rows.into_iter().collect(),
        }
    }

    /// A context that knows no scene names. Test-only: in production the context is
    /// always read from the open database, which answers "no scenes" by coming back
    /// empty on its own.
    #[cfg(test)]
    pub fn empty() -> Self {
        Self {
            scene_names: BTreeMap::new(),
        }
    }

    /// The name a scene id resolves to, or `None` when it resolves to no scene.
    pub fn scene_name(&self, id: i32) -> Option<&str> {
        self.scene_names.get(&id).map(String::as_str)
    }

    #[cfg(test)]
    pub fn from_scene_names<'a>(pairs: impl IntoIterator<Item = (i32, &'a str)>) -> Self {
        Self {
            scene_names: pairs
                .into_iter()
                .map(|(id, name)| (id, name.to_string()))
                .collect(),
        }
    }
}

/// What a migration did to one file's text.
pub struct Rewrite {
    pub text: String,
    /// GM-facing notes about changes that deserve to be asked about — path-free,
    /// because a migration is handed text and not a location. The pass prefixes
    /// each with the file it came from.
    pub warnings: Vec<String>,
}

/// One registered unit of note-format change.
pub struct Migration {
    /// The format version a vault is on once this has run over all of it.
    pub to_version: u32,
    /// One plain sentence, in the GM's terms, for the consent prompt and the
    /// report. This is the whole registration cost of a future format change,
    /// and it is what lets the prompt be *composed* rather than written.
    pub sentence: &'static str,
    /// Given a file's text: `None` if untouched, otherwise the rewrite.
    pub apply: fn(&str, &MigrationContext) -> Option<Rewrite>,
}

/// The registry, in ascending `to_version` order (a test enforces it).
pub const MIGRATIONS: &[Migration] = &[
    Migration {
        to_version: 1,
        // Plain text, not markdown: this same string is read straight into a dialog
        // and written into the report, and neither renders backticks.
        sentence: "Timeline events will be written with their title as a heading instead of a \
                   \"Title:\" line, so a description can run to more than one paragraph. Until \
                   now a blank line inside a description split it into a second, untitled event \
                   the next time the note was saved.",
        apply: timeline_v1::apply,
    },
    Migration {
        to_version: 2,
        sentence: "Scene references will be written as a short block naming the scene instead \
                   of a line of HTML, so a note that plays a scene reads as one in Obsidian \
                   and the scene's name can be found by searching your notes.",
        apply: scene_v2::apply,
    },
];

/// The note format this build reads and writes: the highest version any
/// registered migration takes a vault to. Derived, never declared.
pub const fn target_version() -> u32 {
    let mut highest = 0;
    let mut i = 0;
    while i < MIGRATIONS.len() {
        if MIGRATIONS[i].to_version > highest {
            highest = MIGRATIONS[i].to_version;
        }
        i += 1;
    }
    highest
}

// ── The fold ─────────────────────────────────────────────────────────────────

/// Every pending migration threaded over one file's text, in version order.
struct Folded {
    /// `None` when no pending migration touched the text.
    text: Option<String>,
    warnings: Vec<String>,
    /// The versions whose migrations found work here — what the report names, and
    /// what makes the prompt's sentence list a union of what actually applies.
    versions: Vec<u32>,
}

/// The fold, over the shipped registry.
fn fold_migrations(original: &str, from: u32, ctx: &MigrationContext) -> Folded {
    fold_over(MIGRATIONS, original, from, ctx)
}

/// The fold itself, taking the registry it threads. The registry is a parameter
/// for one reason: the shipped array holds a single migration, so a test that
/// wanted to prove the multi-version behaviour would otherwise have to
/// re-implement this loop — and a second copy of the fold is exactly the thing
/// that eventually disagrees with the first.
fn fold_over(
    migrations: &[Migration],
    original: &str,
    from: u32,
    ctx: &MigrationContext,
) -> Folded {
    let mut current: Option<String> = None;
    let mut warnings = Vec::new();
    let mut versions = Vec::new();

    for migration in migrations.iter().filter(|m| m.to_version > from) {
        let input = current.as_deref().unwrap_or(original);
        if let Some(rewrite) = (migration.apply)(input, ctx) {
            current = Some(rewrite.text);
            warnings.extend(rewrite.warnings);
            versions.push(migration.to_version);
        }
    }

    Folded {
        text: current,
        warnings,
        versions,
    }
}

// ── The pass ─────────────────────────────────────────────────────────────────

/// One file the pass will rewrite, read exactly once.
struct Affected {
    /// Vault-relative, `/`-separated — what the report names and what the backup
    /// reproduces underneath its own folder.
    rel: String,
    full: PathBuf,
    /// The bytes the transform read. The backup is written from these.
    original: String,
    new_text: String,
    warnings: Vec<String>,
    versions: Vec<u32>,
}

/// What the GM is asked to consent to: assembled from the migrations that found
/// work, never written by hand.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct MigrationPlan {
    pub from: u32,
    pub to: u32,
    /// One sentence per pending migration **that found work**. A migration
    /// finding nothing contributes nothing.
    pub sentences: Vec<String>,
    /// A union, not a sum: a file two migrations touch is one file. `u32` because
    /// specta refuses to export `usize` (precision loss across the IPC boundary).
    pub file_count: u32,
    /// Warnings the scan produced, each prefixed with the file it came from.
    pub warnings: Vec<String>,
}

/// What happened, once the GM said yes.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct MigrationReport {
    pub from: u32,
    pub to: u32,
    /// Vault-relative paths of the files actually rewritten.
    pub migrated: Vec<String>,
    /// Files that could not be written, with the reason — the casualties the
    /// partial-failure path is required to name.
    pub failed: Vec<FailedFile>,
    pub warnings: Vec<String>,
    /// Absolute path of the folder holding the copies made before the rewrite.
    pub backup_dir: String,
    /// Absolute path of the markdown report inside it.
    pub report_path: String,
    /// Whether the vault's format stamp was advanced — false after any failure,
    /// which is what makes re-opening find the remainder.
    pub stamped: bool,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct FailedFile {
    pub path: String,
    pub reason: String,
}

/// The scan and the migration, in one function.
///
/// With `write` false nothing on disk changes and the answer is the plan. With
/// `write` true the same walk backs up, rewrites, reports and stamps. There is
/// no second implementation for the prompt to drift away from.
///
/// `Err` is reserved for the one all-or-nothing failure: a backup that did not
/// land. Nothing has been rewritten at that point, so aborting costs nothing.
pub fn run(
    ledger_path: &Path,
    ctx: &MigrationContext,
    write: bool,
) -> Result<(MigrationPlan, Option<MigrationReport>), String> {
    let from = crate::format_version::read_stamp(ledger_path)?;
    let to = target_version();

    // A vault *ahead* of this build is refused here as well as at the gate, and
    // this is not belt-and-braces: without it, the "nothing to do" branch below
    // would stamp the vault *down* to this build's version and hand back a
    // clearance to open it — turning a direct call on this exposed command into
    // the silent downgrade ADR-0017 §2 exists to make impossible.
    if from > to {
        return Err(crate::format_version::ahead_error(from, to));
    }

    let affected = scan(ledger_path, from, ctx);
    let plan = plan_from(&affected, from, to);

    if !write {
        return Ok((plan, None));
    }

    // Nothing to do: stamp forward and say so. Reached when the GM consented to a
    // plan and the vault changed underneath it — the plan is recomputed here, so
    // this is the honest outcome rather than a rewrite of a stale list.
    if affected.is_empty() {
        crate::format_version::write_stamp(ledger_path, to)?;
        return Ok((
            plan,
            Some(MigrationReport {
                from,
                to,
                migrated: Vec::new(),
                failed: Vec::new(),
                warnings: Vec::new(),
                backup_dir: String::new(),
                report_path: String::new(),
                stamped: true,
            }),
        ));
    }

    let backup_dir = back_up(ledger_path, &affected)?;

    // Per-note best-effort from here on: keep going, skip what cannot be written.
    // Rollback is not merely expensive but wrong — it discards correct work and
    // mass-writes over the GM's notes at the moment writes are known to fail.
    let mut migrated = Vec::new();
    let mut failed = Vec::new();
    for file in &affected {
        match std::fs::write(&file.full, &file.new_text) {
            Ok(()) => migrated.push(file.rel.clone()),
            Err(e) => {
                log::warn!("[format_migration] could not rewrite {}: {e}", file.rel);
                failed.push(FailedFile {
                    path: file.rel.clone(),
                    reason: e.to_string(),
                });
            }
        }
    }

    // Warnings from the files that were actually rewritten, not the whole scan's:
    // after a partial failure, a warning about a file still holding its old bytes
    // would tell the GM their prose had been changed when it had not.
    let warnings = affected
        .iter()
        .filter(|f| migrated.contains(&f.rel))
        .flat_map(located)
        .collect();

    let stamped = failed.is_empty();
    let mut report = MigrationReport {
        from,
        to,
        migrated,
        failed,
        warnings,
        backup_dir: backup_dir.to_string_lossy().to_string(),
        report_path: String::new(),
        stamped,
    };
    let report_path = write_report(&backup_dir, &report, &plan);
    report.report_path = report_path.to_string_lossy().to_string();

    // Only now that the new backup has landed is the previous one expendable.
    prune_old_backups(ledger_path, &backup_dir);

    if stamped {
        crate::format_version::write_stamp(ledger_path, to)?;
    } else {
        log::warn!(
            "[format_migration] {} file(s) could not be written; stamp left at {from}",
            report.failed.len()
        );
    }

    Ok((plan, Some(report)))
}

/// Does this vault hold content a pending migration would rewrite? The gate's
/// question, answered by the scan and nothing else.
pub fn has_work(ledger_path: &Path, from: u32, ctx: &MigrationContext) -> bool {
    !scan(ledger_path, from, ctx).is_empty()
}

/// The plan the prompt is built from.
pub fn plan(ledger_path: &Path, ctx: &MigrationContext) -> Result<Option<MigrationPlan>, String> {
    let (plan, _) = run(ledger_path, ctx, false)?;
    Ok((plan.file_count > 0).then_some(plan))
}

/// A file's warnings as the GM reads them: where it happened, then what happened.
/// A migration is handed text and not a location, so this is where the two meet.
fn located(file: &Affected) -> impl Iterator<Item = String> + '_ {
    file.warnings
        .iter()
        .map(|warning| format!("{}: {warning}", file.rel))
}

fn plan_from(affected: &[Affected], from: u32, to: u32) -> MigrationPlan {
    // A sentence appears when its migration found work somewhere, once.
    let sentences = MIGRATIONS
        .iter()
        .filter(|m| affected.iter().any(|f| f.versions.contains(&m.to_version)))
        .map(|m| m.sentence.to_string())
        .collect();

    let warnings = affected.iter().flat_map(located).collect();

    MigrationPlan {
        from,
        to,
        sentences,
        file_count: affected.len() as u32,
        warnings,
    }
}

/// Every file a pending migration would rewrite, each read exactly once.
///
/// Walks the GM's notes and, separately, the [[Template]]s under
/// `.grimoire/templates/` — invisible to the note walk, and an un-migrated one
/// would quietly produce broken notes forever.
fn scan(ledger_path: &Path, from: u32, ctx: &MigrationContext) -> Vec<Affected> {
    if from >= target_version() {
        return Vec::new();
    }

    let mut candidates: Vec<(String, PathBuf)> = Vec::new();
    collect_notes(ledger_path, "", &mut candidates);
    collect_templates(ledger_path, &mut candidates);

    let mut affected = Vec::new();
    for (rel, full) in candidates {
        // A file that cannot be read cannot be judged. Skipping it here means it
        // is not counted, not backed up and not rewritten — and because the stamp
        // only advances when the pass wrote everything it found, a vault whose
        // files are unreadable is not a vault that gets stamped as migrated on
        // the strength of what could be read.
        let original = match std::fs::read_to_string(&full) {
            Ok(text) => text,
            Err(e) => {
                log::warn!("[format_migration] could not read {rel}: {e}");
                continue;
            }
        };
        let folded = fold_migrations(&original, from, ctx);
        if let Some(new_text) = folded.text {
            affected.push(Affected {
                rel,
                full,
                original,
                new_text,
                warnings: folded.warnings,
                versions: folded.versions,
            });
        }
    }

    affected.sort_by(|a, b| a.rel.cmp(&b.rel));
    affected
}

/// The note walk: every `.md` file, skipping dotted directories the way
/// `import.rs` does — so `.grimoire` (including our own backups) is not a note.
fn collect_notes(dir: &Path, relative: &str, out: &mut Vec<(String, PathBuf)>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let child_rel = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };
        if path.is_dir() {
            collect_notes(&path, &child_rel, out);
        } else if name.ends_with(".md") {
            out.push((child_rel, path));
        }
    }
}

fn collect_templates(ledger_path: &Path, out: &mut Vec<(String, PathBuf)>) {
    let dir = crate::commands::templates::templates_dir(ledger_path);
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        if path.is_file() && name.ends_with(".md") {
            out.push((format!(".grimoire/templates/{name}"), path));
        }
    }
}

// ── The backup ───────────────────────────────────────────────────────────────

const BACKUP_PREFIX: &str = "format-backup-";

/// Copy the affected files — only those — into a timestamped folder inside
/// `.grimoire/`, as **plain files** preserving their vault-relative paths.
///
/// Plain files rather than an archive because the whole point is that recovery
/// does not depend on Grimoire: an archive puts a tool between the GM and their
/// campaign at the moment they do not trust the tool. Inside `.grimoire/` because
/// the note walk skips dotted directories — a folder of `.md` copies anywhere else
/// would appear in the file tree as real notes, with backlinks and search hits.
///
/// Any failure aborts the whole migration before a single note is rewritten.
fn back_up(ledger_path: &Path, affected: &[Affected]) -> Result<PathBuf, String> {
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
    let dir = ledger_path.join(".grimoire").join(format!("{BACKUP_PREFIX}{stamp}"));

    for file in affected {
        let dest = dir.join(&file.rel);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "ERR_FORMAT_BACKUP_FAILED: could not create {}: {e}",
                    parent.display()
                )
            })?;
        }
        // From the bytes the transform read, never a second read of the file.
        std::fs::write(&dest, &file.original).map_err(|e| {
            format!(
                "ERR_FORMAT_BACKUP_FAILED: could not copy {} to {}: {e}",
                file.rel,
                dest.display()
            )
        })?;
    }

    Ok(dir)
}

/// Keep exactly one backup: drop every other `format-backup-*` folder now that
/// the new one has landed. Best-effort — a folder that will not delete is clutter,
/// not a reason to fail a migration that succeeded.
fn prune_old_backups(ledger_path: &Path, keep: &Path) {
    let grimoire = ledger_path.join(".grimoire");
    let entries = match std::fs::read_dir(&grimoire) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path == keep || !name.starts_with(BACKUP_PREFIX) || !path.is_dir() {
            continue;
        }
        if let Err(e) = std::fs::remove_dir_all(&path) {
            log::warn!("[format_migration] could not prune {}: {e}", path.display());
        }
    }
}

// ── The report ───────────────────────────────────────────────────────────────

/// Write the markdown report into the backup folder.
///
/// "What I changed" and "the copies from before" are one story: the list without
/// the originals is a confession, the originals without the list are a puzzle. It
/// has to outlive the session, which is why a toast is not a report — the toast
/// only points here.
///
/// Best-effort, and it returns the path it tried: a report that failed to write
/// must not undo a migration that worked.
fn write_report(backup_dir: &Path, report: &MigrationReport, plan: &MigrationPlan) -> PathBuf {
    let path = backup_dir.join("migration-report.md");
    let mut out = String::new();

    out.push_str("# Grimoire note format update\n\n");
    out.push_str(&format!(
        "Your notes were updated from format {} to format {} on {}.\n\n",
        report.from,
        report.to,
        chrono::Utc::now().format("%Y-%m-%d %H:%M UTC")
    ));
    out.push_str(
        "The files in this folder, beside this report, are copies of every note as it was \
         before the update. They are ordinary markdown files — nothing here needs Grimoire \
         to read it.\n\n",
    );

    out.push_str("## What changed\n\n");
    for sentence in &plan.sentences {
        out.push_str(&format!("- {sentence}\n"));
    }

    out.push_str(&format!(
        "\n## Notes updated ({})\n\n",
        report.migrated.len()
    ));
    if report.migrated.is_empty() {
        out.push_str("_None._\n");
    }
    for path in &report.migrated {
        out.push_str(&format!("- `{path}`\n"));
    }

    if !report.warnings.is_empty() {
        out.push_str(&format!("\n## Warnings ({})\n\n", report.warnings.len()));
        for warning in &report.warnings {
            out.push_str(&format!("- {warning}\n"));
        }
    }

    if !report.failed.is_empty() {
        out.push_str(&format!(
            "\n## Notes that could not be updated ({})\n\n",
            report.failed.len()
        ));
        for failure in &report.failed {
            out.push_str(&format!("- `{}` — {}\n", failure.path, failure.reason));
        }
        out.push_str(
            "\nThese notes are still in the old format, and Grimoire has not recorded the \
             update as finished. Fix whatever stopped the write — a file open in another \
             program, or a read-only permission — and open this ledger again: only the notes \
             listed here will be updated the second time.\n",
        );
    }

    if let Err(e) = std::fs::write(&path, out) {
        log::warn!("[format_migration] could not write {}: {e}", path.display());
    }
    path
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::{tempdir, TempDir};

    const OLD: &str = "```timeline\nDate: Year 0\nTitle: Alpha\nProse.\n```";
    const NEW: &str = "```timeline\n# Alpha\nDate: Year 0\n\nProse.\n```";

    /// The two registered migrations meet here: this file is behind on *both*, so
    /// one pass over it proves the fold, the union count and the composed prompt
    /// against the shipped registry rather than a stand-in.
    const OLD_SCENE: &str = r#"<scene-block data-id="1" data-expanded="false"></scene-block>"#;
    const NEW_SCENE: &str = "```scene\n# Boss Battle\nId: 1\n```";

    /// The context every test below runs with: one scene, so Scene's transform has
    /// a name to write.
    fn ctx() -> MigrationContext {
        MigrationContext::from_scene_names([(1, "Boss Battle")])
    }

    /// `run` with the shipped context, which is what every call site does.
    fn run_with(ledger_path: &Path, write: bool) -> Result<(MigrationPlan, Option<MigrationReport>), String> {
        run(ledger_path, &ctx(), write)
    }

    fn plan_of(ledger_path: &Path) -> Result<Option<MigrationPlan>, String> {
        plan(ledger_path, &ctx())
    }

    fn vault() -> TempDir {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".grimoire").join("templates")).unwrap();
        dir
    }

    fn write(dir: &Path, rel: &str, text: &str) {
        let path = dir.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn read(dir: &Path, rel: &str) -> String {
        std::fs::read_to_string(dir.join(rel)).unwrap()
    }

    fn backup_dir(dir: &Path) -> PathBuf {
        std::fs::read_dir(dir.join(".grimoire"))
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .find(|p| {
                p.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with(BACKUP_PREFIX)
            })
            .expect("expected a backup folder")
    }

    // ── The registry ─────────────────────────────────────────────────────────

    #[test]
    fn the_app_target_version_is_derived_from_the_highest_entry() {
        let highest = MIGRATIONS.iter().map(|m| m.to_version).max().unwrap_or(0);
        assert_eq!(target_version(), highest);
        // And the app agrees with the registry, rather than declaring its own
        // number beside it — the whole reason the constant is derived.
        assert_eq!(crate::format_version::APP_FORMAT_VERSION, target_version());
    }

    #[test]
    fn the_registry_is_in_ascending_version_order_with_no_repeats() {
        // The fold threads functions in array order, so the array *is* the order.
        for pair in MIGRATIONS.windows(2) {
            assert!(
                pair[0].to_version < pair[1].to_version,
                "migrations must ascend: {} then {}",
                pair[0].to_version,
                pair[1].to_version
            );
        }
        assert!(MIGRATIONS.iter().all(|m| m.to_version > 0), "version 0 is the unmigrated state");
    }

    #[test]
    fn every_migration_carries_a_gm_facing_sentence() {
        for migration in MIGRATIONS {
            assert!(
                migration.sentence.len() > 20,
                "version {} needs a real sentence",
                migration.to_version
            );
        }
    }

    // ── The fold ─────────────────────────────────────────────────────────────

    #[test]
    fn the_fold_skips_migrations_the_vault_is_already_past() {
        let folded = fold_migrations(OLD, target_version(), &ctx());
        assert!(folded.text.is_none());
        assert!(folded.versions.is_empty());
    }

    #[test]
    fn the_fold_threads_pending_migrations_over_the_same_text() {
        let folded = fold_migrations(OLD, 0, &ctx());
        assert_eq!(folded.text.as_deref(), Some(NEW));
        assert_eq!(folded.versions, vec![1]);
    }

    #[test]
    fn a_vault_several_versions_behind_reads_once_and_writes_once() {
        // Three stand-in migrations over the real fold. What is asserted is its
        // shape: each one sees the previous one's *output* rather than the file,
        // so a note three versions behind is read once and written once — and the
        // one the vault is already past is not run at all.
        fn to_one(text: &str, _ctx: &MigrationContext) -> Option<Rewrite> {
            text.contains('a').then(|| Rewrite {
                text: text.replace('a', "ONE"),
                warnings: vec!["became one".into()],
            })
        }
        fn to_two(text: &str, _ctx: &MigrationContext) -> Option<Rewrite> {
            text.contains("one").then(|| Rewrite {
                text: text.replace("one", "two"),
                warnings: vec!["became two".into()],
            })
        }
        fn to_three(text: &str, _ctx: &MigrationContext) -> Option<Rewrite> {
            text.contains("two").then(|| Rewrite {
                text: text.replace("two", "three"),
                warnings: vec!["became three".into()],
            })
        }
        let registry = [
            Migration { to_version: 1, sentence: "one", apply: to_one },
            Migration { to_version: 2, sentence: "two", apply: to_two },
            Migration { to_version: 3, sentence: "three", apply: to_three },
        ];

        let folded = fold_over(&registry, "a one", 1, &ctx());

        // `to_one` was skipped (the vault is at 1), then 2 and 3 threaded in order.
        assert_eq!(folded.text.as_deref(), Some("a three"));
        assert_eq!(folded.versions, vec![2, 3]);
        assert_eq!(folded.warnings, vec!["became two", "became three"]);
    }

    #[test]
    fn the_fold_skips_a_migration_that_finds_nothing_without_breaking_the_chain() {
        fn no_op(_text: &str, _ctx: &MigrationContext) -> Option<Rewrite> {
            None
        }
        fn shout(text: &str, _ctx: &MigrationContext) -> Option<Rewrite> {
            Some(Rewrite { text: text.to_uppercase(), warnings: Vec::new() })
        }
        let registry = [
            Migration { to_version: 1, sentence: "nothing", apply: no_op },
            Migration { to_version: 2, sentence: "shout", apply: shout },
        ];

        let folded = fold_over(&registry, "quiet", 0, &ctx());

        assert_eq!(folded.text.as_deref(), Some("QUIET"));
        // Only the migration that found work is recorded, which is what keeps the
        // prompt's sentence list to the ones that apply.
        assert_eq!(folded.versions, vec![2]);
    }

    // ── Scan and rewrite are the same function ───────────────────────────────

    #[test]
    fn the_scan_and_the_rewrite_agree_because_they_are_one_function() {
        let dir = vault();
        write(dir.path(), "Chronicle.md", OLD);
        write(dir.path(), "Plain.md", "# Just prose\n");

        let (scanned, no_report) = run_with(dir.path(), false).unwrap();
        assert!(no_report.is_none(), "a scan must not report — it did nothing");
        // The scan changed nothing on disk.
        assert_eq!(read(dir.path(), "Chronicle.md"), OLD);

        let (planned, report) = run_with(dir.path(), true).unwrap();
        let report = report.unwrap();

        // The count the prompt showed is the count that was written, and the
        // names match — the property separate find-and-do code eventually breaks.
        assert_eq!(scanned.file_count, planned.file_count);
        assert_eq!(scanned.file_count, report.migrated.len() as u32);
        assert_eq!(report.migrated, vec!["Chronicle.md"]);
        assert_eq!(scanned.sentences, planned.sentences);
        assert_eq!(read(dir.path(), "Chronicle.md"), NEW);
        assert_eq!(read(dir.path(), "Plain.md"), "# Just prose\n");
    }

    #[test]
    fn only_affected_files_are_counted() {
        let dir = vault();
        write(dir.path(), "Old.md", OLD);
        write(dir.path(), "New.md", NEW);
        write(dir.path(), "Notes/Prose.md", "nothing to do\n");

        let (plan, _) = run_with(dir.path(), false).unwrap();
        assert_eq!(plan.file_count, 1);
    }

    #[test]
    fn the_count_is_a_union_not_a_sum() {
        // One file, two fences one migration touches, one note counted: the plan is
        // built from the set of affected *files*, never from the sum of per-migration
        // hits.
        let dir = vault();
        write(dir.path(), "Two fences.md", &format!("{OLD}\n\n{OLD}\n"));

        let (plan, _) = run_with(dir.path(), false).unwrap();
        assert_eq!(plan.file_count, 1);
        assert_eq!(plan.sentences.len(), 1);
    }

    #[test]
    fn a_note_behind_on_both_shipped_migrations_is_one_note_and_one_backup() {
        // Timeline's change and Scene's ride one prompt and one backup, which is what
        // both being pending at once has to mean: two sentences composed for the GM,
        // one file in the count, one folder of copies, one write.
        let dir = vault();
        write(dir.path(), "Chronicle.md", &format!("{OLD}\n\n{OLD_SCENE}\n"));

        let (plan, report) = run_with(dir.path(), true).unwrap();
        let report = report.unwrap();

        assert_eq!(plan.file_count, 1, "a file two migrations touch is one file");
        assert_eq!(plan.sentences.len(), 2, "{:?}", plan.sentences);
        assert!(plan.sentences[0].contains("Timeline"));
        assert!(plan.sentences[1].contains("Scene"));
        assert_eq!(report.migrated, vec!["Chronicle.md"]);
        assert_eq!(
            read(dir.path(), "Chronicle.md"),
            format!("{NEW}\n\n{NEW_SCENE}\n"),
            "one write carries both changes"
        );
        assert!(report.stamped);
        assert_eq!(
            crate::format_version::read_stamp(dir.path()).unwrap(),
            target_version()
        );
        // One backup folder, holding the file exactly as it was before either change.
        assert_eq!(
            std::fs::read_to_string(backup_dir(dir.path()).join("Chronicle.md")).unwrap(),
            format!("{OLD}\n\n{OLD_SCENE}\n")
        );
    }

    #[test]
    fn scene_names_reach_the_rewrite_from_the_context() {
        // The one thing a migration cannot read out of the file. A context that knows
        // the scene writes its name; one that does not writes the id alone, and the
        // fence still resolves — a missing name costs legibility, never the reference.
        let dir = vault();
        write(dir.path(), "Chronicle.md", OLD_SCENE);
        run(dir.path(), &MigrationContext::empty(), true).unwrap();
        assert_eq!(read(dir.path(), "Chronicle.md"), "```scene\nId: 1\n```");

        let named = vault();
        write(named.path(), "Chronicle.md", OLD_SCENE);
        run_with(named.path(), true).unwrap();
        assert_eq!(read(named.path(), "Chronicle.md"), NEW_SCENE);
    }

    #[test]
    fn a_vault_with_nothing_to_migrate_yields_no_plan() {
        let dir = vault();
        write(dir.path(), "New.md", NEW);
        assert!(plan_of(dir.path()).unwrap().is_none());
    }

    #[test]
    fn an_empty_vault_yields_no_plan() {
        let dir = vault();
        assert!(plan_of(dir.path()).unwrap().is_none());
        assert!(!has_work(dir.path(), 0, &ctx()));
    }

    #[test]
    fn the_plan_carries_the_sentences_and_the_prose_warning() {
        let dir = vault();
        write(dir.path(), "Chronicle.md", "```timeline\nTitle: Alpha\n# a prose heading\n```");

        let plan = plan_of(dir.path()).unwrap().expect("expected a plan");

        assert_eq!(plan.from, 0);
        assert_eq!(plan.to, target_version());
        assert_eq!(plan.sentences.len(), 1);
        assert!(plan.sentences[0].contains("Timeline"));
        assert_eq!(plan.warnings.len(), 1);
        // Named where it happened, because that is the file the GM will look at.
        assert!(plan.warnings[0].starts_with("Chronicle.md: "), "{:?}", plan.warnings);
        assert!(plan.warnings[0].contains('#'));
    }

    #[test]
    fn templates_are_migrated_alongside_notes() {
        let dir = vault();
        write(dir.path(), "Chronicle.md", OLD);
        write(dir.path(), ".grimoire/templates/Session.md", OLD);

        let (plan, report) = run_with(dir.path(), true).unwrap();
        assert_eq!(plan.file_count, 2);
        assert_eq!(
            report.unwrap().migrated,
            vec![".grimoire/templates/Session.md", "Chronicle.md"]
        );
        assert_eq!(read(dir.path(), ".grimoire/templates/Session.md"), NEW);
    }

    #[test]
    fn grimoire_s_own_directory_is_not_walked_as_notes() {
        let dir = vault();
        // A stray .md inside .grimoire that is not a template — a previous
        // backup, for instance. Migrating it would rewrite the copy that exists
        // precisely to be the un-migrated one.
        write(dir.path(), ".grimoire/format-backup-old/Chronicle.md", OLD);

        assert!(plan_of(dir.path()).unwrap().is_none());
    }

    #[test]
    fn the_bundled_sample_world_is_already_on_the_current_format() {
        // The sample ledger ships as files, so it can go stale like any vault —
        // and if it does, "Explore the sample world" opens with a migration
        // prompt, which is the one place a GM has consented to nothing yet.
        let sample = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sample-world");
        assert!(sample.is_dir(), "sample-world fixture not found at {sample:?}");

        let affected = scan(&sample, 0, &ctx());
        let names: Vec<&str> = affected.iter().map(|f| f.rel.as_str()).collect();
        assert!(names.is_empty(), "sample world needs migrating: {names:?}");
    }

    // ── The backup ───────────────────────────────────────────────────────────

    #[test]
    fn affected_files_only_are_copied_as_plain_files_preserving_their_paths() {
        let dir = vault();
        write(dir.path(), "Lore/Chronicle.md", OLD);
        write(dir.path(), "Untouched.md", "prose\n");
        write(dir.path(), ".grimoire/templates/Session.md", OLD);

        run_with(dir.path(), true).unwrap();
        let backup = backup_dir(dir.path());

        assert_eq!(
            std::fs::read_to_string(backup.join("Lore/Chronicle.md")).unwrap(),
            OLD,
            "the backup holds the bytes from before the rewrite"
        );
        assert!(backup.join(".grimoire/templates/Session.md").exists());
        assert!(!backup.join("Untouched.md").exists(), "only affected files are copied");
    }

    #[test]
    fn the_backup_lives_inside_the_dotted_grimoire_directory() {
        let dir = vault();
        write(dir.path(), "Chronicle.md", OLD);
        run_with(dir.path(), true).unwrap();

        // Or the copies show up in the GM's file tree as real notes.
        assert_eq!(backup_dir(dir.path()).parent().unwrap(), dir.path().join(".grimoire"));
    }

    #[test]
    fn exactly_one_backup_is_kept_and_the_previous_one_is_pruned() {
        let dir = vault();
        // A backup from a migration months ago.
        write(dir.path(), ".grimoire/format-backup-19990101T000000Z/Old.md", "ancient\n");
        write(dir.path(), "Chronicle.md", OLD);

        run_with(dir.path(), true).unwrap();

        let backups: Vec<_> = std::fs::read_dir(dir.path().join(".grimoire"))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with(BACKUP_PREFIX))
            .collect();
        assert_eq!(backups.len(), 1, "{backups:?}");
        assert!(!dir.path().join(".grimoire/format-backup-19990101T000000Z").exists());
        // Pruned *after* the new one landed, so the new copy is really there.
        assert!(backup_dir(dir.path()).join("Chronicle.md").exists());
    }

    #[test]
    fn a_backup_failure_aborts_before_any_note_is_rewritten() {
        let dir = tempdir().unwrap();
        write(dir.path(), "Chronicle.md", OLD);
        // `.grimoire` is a *file*, so no backup folder can be created under it.
        std::fs::write(dir.path().join(".grimoire"), "not a directory").unwrap();

        let err = run_with(dir.path(), true).expect_err("migration must abort");

        assert!(err.starts_with("ERR_FORMAT_BACKUP_FAILED:"), "{err}");
        // The one place all-or-nothing is right, and it costs nothing: at the
        // point the backup failed, nothing had happened yet.
        assert_eq!(read(dir.path(), "Chronicle.md"), OLD, "nothing may be rewritten");
    }

    // ── The report ───────────────────────────────────────────────────────────

    #[test]
    fn a_markdown_report_is_written_into_the_backup_folder() {
        let dir = vault();
        write(dir.path(), "Lore/Chronicle.md", "```timeline\nTitle: Alpha\n# a prose heading\n```");

        let report = run_with(dir.path(), true).unwrap().1.unwrap();
        let text = std::fs::read_to_string(&report.report_path).unwrap();

        assert_eq!(
            PathBuf::from(&report.report_path).parent().unwrap(),
            backup_dir(dir.path()),
            "the report belongs beside the copies it explains"
        );
        assert!(text.contains("Lore/Chronicle.md"), "names every file touched");
        assert!(text.contains("Timeline"), "says what changed");
        assert!(text.contains("Warnings (1)"), "carries the warnings");
    }

    #[test]
    fn the_report_names_the_failures_and_says_the_update_is_unfinished() {
        let dir = vault();
        write(dir.path(), "Chronicle.md", OLD);
        let mut report = MigrationReport {
            from: 0,
            to: 1,
            migrated: vec!["Chronicle.md".into()],
            failed: vec![FailedFile { path: "Locked.md".into(), reason: "access denied".into() }],
            warnings: Vec::new(),
            backup_dir: String::new(),
            report_path: String::new(),
            stamped: false,
        };
        let backup = dir.path().join(".grimoire").join("format-backup-test");
        std::fs::create_dir_all(&backup).unwrap();
        let plan = MigrationPlan {
            from: 0,
            to: 1,
            sentences: vec!["Timeline events change shape.".into()],
            file_count: 2,
            warnings: Vec::new(),
        };
        report.report_path = write_report(&backup, &report, &plan).to_string_lossy().to_string();

        let text = std::fs::read_to_string(&report.report_path).unwrap();
        assert!(text.contains("Locked.md"));
        assert!(text.contains("access denied"));
        assert!(text.contains("open this ledger again"));
    }

    // ── The stamp ────────────────────────────────────────────────────────────

    #[test]
    fn a_clean_sweep_advances_the_stamp() {
        let dir = vault();
        write(dir.path(), "Chronicle.md", OLD);

        let report = run_with(dir.path(), true).unwrap().1.unwrap();

        assert!(report.stamped);
        assert!(report.failed.is_empty());
        assert_eq!(
            crate::format_version::read_stamp(dir.path()).unwrap(),
            target_version()
        );
    }

    #[test]
    fn a_vault_where_the_work_vanished_is_stamped_without_a_backup() {
        // Consent given, then the plan recomputed at migrate time found nothing —
        // the GM migrated the vault elsewhere in between, say. Stamp and open,
        // rather than rewriting from a list that is no longer true.
        let dir = vault();
        write(dir.path(), "New.md", NEW);

        let report = run_with(dir.path(), true).unwrap().1.unwrap();

        assert!(report.stamped);
        assert!(report.migrated.is_empty());
        assert_eq!(report.backup_dir, "");
        assert_eq!(crate::format_version::read_stamp(dir.path()).unwrap(), target_version());
    }

    #[test]
    fn a_vault_ahead_of_this_build_is_refused_rather_than_stamped_backwards() {
        // The dangerous direction, and it arrives ordinarily: two machines, one
        // synced vault, one updated app. Migrating it is not merely pointless —
        // there is nothing old in it — it would stamp the vault *down* and open
        // it, after which this build's reader drops content it cannot parse.
        let dir = vault();
        let ahead = target_version() + 1;
        crate::format_version::write_stamp(dir.path(), ahead).unwrap();
        write(dir.path(), "Chronicle.md", OLD);

        for write_mode in [false, true] {
            let err = run_with(dir.path(), write_mode).expect_err("an ahead vault must be refused");
            assert!(err.starts_with("ERR_FORMAT_AHEAD:"), "{err}");
        }
        assert!(plan_of(dir.path()).is_err());
        assert_eq!(crate::format_version::read_stamp(dir.path()).unwrap(), ahead);
        assert_eq!(read(dir.path(), "Chronicle.md"), OLD);
    }

    #[test]
    fn re_running_after_a_clean_sweep_finds_nothing() {
        let dir = vault();
        write(dir.path(), "Chronicle.md", OLD);
        run_with(dir.path(), true).unwrap();

        assert!(plan_of(dir.path()).unwrap().is_none());
        assert!(!has_work(
            dir.path(),
            crate::format_version::read_stamp(dir.path()).unwrap(),
            &ctx()
        ));
    }

    /// Make a file un-writable on whichever platform the test is running on.
    fn set_readonly(path: &Path, readonly: bool) {
        let mut perms = std::fs::metadata(path).unwrap().permissions();
        perms.set_readonly(readonly);
        std::fs::set_permissions(path, perms).unwrap();
    }

    #[test]
    fn a_failure_on_one_note_skips_it_continues_and_withholds_the_stamp() {
        let dir = vault();
        write(dir.path(), "Alpha.md", OLD);
        // The casualty is one the scan raised a warning about, so the report can
        // be checked for claiming a change that never reached the disk.
        write(dir.path(), "Locked.md", "```timeline\nTitle: Alpha\n# a prose heading\n```");
        write(dir.path(), "Zeta.md", OLD);
        let locked = dir.path().join("Locked.md");
        set_readonly(&locked, true);

        let report = run_with(dir.path(), true).unwrap().1.unwrap();

        // Kept going either side of the casualty.
        assert_eq!(report.migrated, vec!["Alpha.md", "Zeta.md"]);
        assert_eq!(report.failed.len(), 1);
        assert_eq!(report.failed[0].path, "Locked.md");
        // And nothing is claimed about the file that was not written.
        assert!(
            !report.warnings.iter().any(|w| w.starts_with("Locked.md")),
            "{:?}",
            report.warnings
        );
        // The stamp asserts every file is on the new format; after a partial
        // failure that would be a lie, and with no reader for the old format the
        // lie is lethal.
        assert!(!report.stamped);
        assert_eq!(crate::format_version::read_stamp(dir.path()).unwrap(), 0);

        // Re-running is the resume mechanism, for free: the work is found by
        // scanning, so only the remainder is left to do.
        let plan = plan_of(dir.path()).unwrap().expect("the remainder is still pending");
        assert_eq!(plan.file_count, 1);

        set_readonly(&locked, false);
        let second = run_with(dir.path(), true).unwrap().1.unwrap();
        assert_eq!(second.migrated, vec!["Locked.md"]);
        assert!(second.stamped);
    }
}
