# ADR-0017 — Ledger format versions and the consented vault migration

**Status:** Accepted
**Date:** 2026-07-30

## Context

Grimoire's database migrates itself. Twenty-three embedded migrations run on every ledger open
(`db/mod.rs:104`), one of them a pure data repair, and none of them ask. That is correct: the
database is a private store, rebuildable from the notes, and a GM has no stake in its shape.

Nothing equivalent exists for the notes, and the notes are the opposite kind of thing. They _are_
the ledger, they are the artifact ledger portability exists to protect, and a GM hand-edits them in
Obsidian and VS Code. Yet a block format change rewrites them — and the shipped-block migration
([#155](https://github.com/Larront/grimoire/issues/155)) has two: Scene's `<scene-block>` becomes a
` ```scene ` fence, and a Timeline event's `Title:` line becomes a `#` heading. Both were specced on
the strength of a mechanism that did not exist, and #155 deleted the legacy `<scene-block>` reader
on the strength of it too — so this mechanism is the **sole** guard against old-format content. There
is no shim underneath: unrecognised old content is dropped at parse and gone from the file on the
next autosave.

This ADR records the principle, the refusals, and the four rules that make the consent honest. The
mechanism's detail — file names, record fields, folder naming, copy — lives on
[#166](https://github.com/Larront/grimoire/issues/166) and in `CONTEXT.md`; it is implementation this
ADR should not freeze.

## Decision

### 1. The principle

> **Grimoire's own store migrates silently; the GM's documents are never rewritten without being
> asked.**

The database keeps migrating on every open with no prompt. A note format change prompts once, on
open, with what will change, and migrates in one knowing pass over the whole vault — never
note-by-note as each is opened, which would be a silent modification of a file because the GM
_looked_ at it.

The stamp itself is exempt, and this needs saying because the principle can be misread as forbidding
it: writing `.grimoire/format-version` is Grimoire's own bookkeeping, not a document. A vault with no
old content in it is stamped silently and its GM never learns this mechanism exists.

### 2. The comparison has three outcomes, and two of them are refusals

A vault stamps one integer — the format its **notes** are written in. Comparing it to the format the
app knows yields three cases, not two:

| Vault stamp | Outcome                                                   |
| ----------- | --------------------------------------------------------- |
| Equal       | Open normally                                             |
| **Behind**  | Prompt; migrate on consent, **refuse to open on decline** |
| **Ahead**   | **Refuse to open.** No dialog with a way through it       |

Both refusals are load-bearing and both are at risk of being "improved" later into a compatibility
mode. There is no compatibility mode, and the reason is §1's consequence rather than a preference:
with no reader for old content, opening an un-migrated vault does not expose the GM to a risk they
accepted — it destroys content they will not see leave. "Open at your own risk" is not available as
an option, because the risk is invisible.

**Declining opens nothing.** This is the posture the app already takes for a corrupt database with no
usable snapshot: rebuild, or do not come in. A read-only vault mode was rejected as a whole second
mode of the application whose every write path — autosave, note creation, tag and alias writes, scene
edits, pin drags, template creation — must honour it, where one missed path ships "at your own risk"
while the UI promises safety. And it buys nothing: the notes are markdown on disk, so a GM who wants
to read without updating already has Obsidian. Refusing to open costs them nothing they cannot get
elsewhere.

**A vault ahead of the app is the more dangerous direction**, and it arrives ordinarily — two
machines, one synced vault, one updated app. A vault that is behind fails safe, because the mechanism
is built to notice it. A vault that is ahead fails silently: the old app reads a fence it has never
heard of, gets nothing, and autosaves the loss. There is nothing to migrate forward and no downgrade
worth building (§5). The cost is accepted: updating Grimoire on one machine effectively updates the
vault, and the other machine is locked out until it updates too. That is the normal bargain for
synced app data, it is visible rather than silent, and the notes stay readable in Obsidian throughout.

The stamp is therefore **not a to-do list** — it is a statement of what format the files are in, and
either direction of mismatch is a refusal to guess.

### 3. The four rules that make the consent honest

**Back up first, from the same bytes.** The affected files — only those; the scan already names them —
are copied before anything is rewritten. The reasoning is the database snapshot's
(`db/mod.rs:121`) but stronger: a database can be rebuilt from the notes and the notes have nothing
to be rebuilt from. Two details are not incidental. The copies are **plain files, not an archive**,
because the whole point is that recovery does not depend on Grimoire — an archive puts a tool between
the GM and their campaign at the moment they do not trust the tool. And the backup is written **from
the bytes the transform read**, not by copying the file a second time; a second read opens a window
in which something else edits the file, after which the backup is a copy of something that never
existed in the vault. If the backup fails, nothing is rewritten and the migration aborts — the one
place all-or-nothing is right, and it does not contradict the next rule because nothing has happened
yet.

**Stamp only on a clean sweep.** A migration that fails on note 300 of 500 keeps going, skips what it
cannot write, and **does not advance the stamp**. Re-running is the resume mechanism, for free,
because the work is found by scanning rather than by counting: the 299 already-correct notes need
nothing, so the next open finds only what remains. A progress journal would be a second, less
reliable copy of a fact the files already record. Rollback is not merely expensive but wrong — it
discards correct work to buy a consistency the design does not need, and it performs a mass write
over the GM's notes at the exact moment writes are known to be failing.

Withholding the stamp is what keeps the mechanism honest. The stamp asserts that every file is on the
new format; stamping after a partial failure makes that a lie, and with no reader underneath, the lie
is lethal — the next time the GM opens one of those notes, its content is dropped and autosave writes
the loss to disk.

**Report what changed, to a file.** Not merely that it ran, and not only on screen. The report is
markdown written into the backup folder, naming every file touched, what changed in it, every
warning, and every failure. It has to outlive the session — a toast dismissed on Monday is not a
report — and it belongs beside the backup, because "what I changed" and "the copies from before"
are one story: the list without the originals is a confession, the originals without the list are a
puzzle.

**The scan is the migration with the write left off.** A migration is one function — given a file's
text, return nothing, or return the new text plus warnings — run without writing to build the prompt
and with writing to migrate. One implementation, so **the prompt cannot lie**. Separate find and do
code eventually disagree: the prompt says 23 notes and 24 are written, or one is silently missed, and
that class of bug is invisible until it is someone's campaign.

### 4. Consent that survives a vault three versions behind

The prompt is **composed**, not written: each [[Format Migration]] carries one GM-facing sentence, and
the dialog is assembled from the sentences of whichever migrations are pending, with a count and any
warnings the scan produced. Nobody edits the dialog again.

Generic copy — "some things are written differently" — is cheaper and rots in a specific way: it gives
the GM nothing to weigh, so the yes becomes reflexive, and a reflexive yes to a mass rewrite of
someone's campaign is what consent was for. It also cannot carry a warning, and warnings are
specific: #155's Timeline pass space-prefixes a description line beginning with `#`, which is the one
part of the whole migration that edits the GM's _prose_ rather than Grimoire's own syntax, and
therefore the part most deserving of being asked about.

The count is a **union**, not a sum — a note two migrations touch is one note — and a migration that
finds no work contributes no sentence. When every pending migration finds nothing, there is no prompt
at all.

### 5. Declined, with reasons

- **Downgrade paths.** The old app would have to contain an understanding of a format that did not
  exist when it shipped. The version needing the downgrade is always the one already installed.
- **A GM-facing dry-run.** The prompt _is_ the dry run's output. A button would be a second way to
  ask a question already answered on screen.
- **Read-only vault mode**, and **per-note write guards** for the notes a partial failure left behind.
  Both are modes, both must be honoured by every write path, and the second protects against a case
  the report already surfaces while preventing the GM who fixes a file permission by hand from simply
  re-opening.
- **A migration authoring API or framework.** A migration is an entry in a const array and one
  function pointer. Two migrations are not evidence for a service layer.
- **A Settings UI for backups.** The report names the folder once; after that it is a folder of
  markdown files the GM owns, and their file manager is better at it than anything built here.

## Consequences

- **This mechanism must exist before any note format change ships.** #155's sequencing already says
  so; the ADR makes the dependency structural rather than scheduled.
- **A partial failure opens the vault; a decline does not.** The asymmetry is deliberate — consent was
  given, and the affected notes are _named_ — and the alternative is a permanent lockout from an
  entire campaign over one file with a permission nobody can change.
- **Every future format change owes one plain-English sentence.** That is the whole registration cost,
  and it is the price of the prompt staying honest at any distance behind.
- **The stamp's absence means version 0, and no attempt is made to tell an old vault from a new one.**
  The distinction dissolves: a brand-new vault has no notes and a foreign Obsidian folder has no old
  blocks, so both find no work and are stamped in silence.
- **Templates migrate too.** They are `.md` files under `.grimoire/templates/`, invisible to the note
  walk, and an un-migrated template would quietly produce broken notes forever.
- **Backups live inside `.grimoire/`.** Note-walking skips dotted directories (`import.rs:129`); a
  folder of `.md` copies anywhere else appears in the GM's file tree as real notes, with backlinks and
  search hits.
- **One backup is kept.** A vault several versions behind catches up in one pass with one backup, so
  the loss is only across separate migration events months apart.
