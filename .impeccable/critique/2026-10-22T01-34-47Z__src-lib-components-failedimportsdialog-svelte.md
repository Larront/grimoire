---
target: failed imports dialog
total_score: 10
max_score: 40
p0_count: 1
p1_count: 2
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\FailedImportsDialog.svelte"
target_fingerprint: "sha256:6dd8220a19183f21cd6d5ea79f1ce7fb080846ef146fbd2f857a09782b1af506"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\FailedImportsDialog.svelte"
timestamp: 2026-10-22T01-34-47Z
slug: src-lib-components-failedimportsdialog-svelte
---
Method: dual-agent, run sequentially on the one app window (A: design review · B: detector + browser evidence). Driven through the app's own store (`failedImportsModal`) with realistic OS errors, since it only appears when an open can't read files.

## Design Health Score — 10/40 (Poor)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 1 | Doesn't say what failing means (won't open, not searchable, pins unlinked) or whether it retries |
| 2 | Match with real world | 1 | "Import" isn't the GM's word; raw OS strings |
| 3 | User control & freedom | 1 | Show details dismisses the toast; nothing reopens the list |
| 4 | Consistency & standards | 1 | Unlike the reworked Pins to re-link in every respect; bg-muted invisible; 512px |
| 5 | Error prevention | 1 | Creating a note of the same name can overwrite the unreadable file |
| 6 | Recognition over recall | 2 | Full paths, undifferentiated |
| 7 | Flexibility & efficiency | 0 | No action per row |
| 8 | Aesthetic & minimalist | 2 | Quiet; break-all splits words; red action reads destructive |
| 9 | Error recovery | 0 | No next step |
| 10 | Help & documentation | 1 | Reasons unexplained |

Detector: CLI 0; browser 0 inside the dialog or toast.

## Priority issues

- **[P0] An unreadable file loses its record.** `reconcile_notes_with_disk` treats a failed read as absent (`import.rs:77-79`): record deleted, pins unlinked, backlinks gone; it returns as a new note. **And** `resolve_note_filename` uses `exists()`, false on error, so a same-named new note can be written over it (`notes.rs:58`).
- **[P1] The list can't be reopened, and nothing can be done from it.**
- **[P1] Raw OS errors as copy** (CONTEXT.md Error Code rule).
- **[P2] House drift** — invisible rows, Nunito paths, break-all, 512px, title leading-none, unstyled scrollbar.
- **[P2] Keyboard** — only Close is reachable; 35 of 40 rows unreachable; focus to body on close.

## Not reported at all

A folder that can't be listed (`import.rs:162`) and a file whose contents can't be read (not UTF-8) get no message.

## Questions

1. Should this be an error at all, or a neutral report?
2. Mark unreadable notes in the file tree?
3. One repair report with Pins to re-link?
