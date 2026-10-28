---
target: db recovery dialog
total_score: 22
max_score: 40
p0_count: 1
p1_count: 3
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\DbRecoveryDialog.svelte"
target_fingerprint: "sha256:4bb19058c41bdd9b7052e3fff891637f868459b6f23828e0126cc1b4dd66f67a"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\DbRecoveryDialog.svelte"
timestamp: 2026-10-22T02-37-32Z
slug: src-lib-components-dbrecoverydialog-svelte
---
Method: dual-agent, run sequentially on the one app window (A: design review · B: detector + browser evidence), on a throwaway copy of the Example World with its database overwritten (and a variant with a good snapshot, for the auto-restore toast).

## Design Health Score — 22/40 (Acceptable)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Rebuild ends in silence; the restore toast never leaves |
| 2 | Match with real world | 2 | "ledger", "database", `.grimoire`, raw ERR_DB_CORRUPT on the Splash |
| 3 | User control & freedom | 3 | Cancel safe; no way to the kept file; Escape live mid-rebuild; restore toast can't be closed |
| 4 | Consistency & standards | 2 | Differs from FormatMigration and the reworked repair siblings |
| 5 | Error prevention | 3 | Asks first; retry after partial failure buries the real damaged file |
| 6 | Recognition over recall | 2 | Never names the world |
| 7 | Flexibility & efficiency | 2 | No reveal, no file name |
| 8 | Aesthetic & minimalist | 3 | Calm, but three messages at once |
| 9 | Error recovery | 2 | "map details" understates the loss (whole maps go); generic failure toast |
| 10 | Help & documentation | 1 | "another tool" names nothing |

Detector: CLI 0; browser 0 inside the dialog or toast.

## Priority issues

- **[P0] Raw `ERR_DB_CORRUPT` under the dialog on the Splash, staying after Cancel** (`+page.svelte` errorMsg).
- **[P1] No world name; the Example World label sticks after switching** (`applyOpenResult` never resets `isSample`).
- **[P1] Rebuild ends in silence and understates the loss.**
- **[P1] Restore toast: permanent, no close, no id, outlives its world; its date means "when you last opened it".**
- **[P2] Rebuild unguarded (Escape/Cancel live); failure generic; retry moves a healthy fresh DB aside; duplicate toast on rebuild-then-format.**
- **[P3] Identical error toast beside the dialog (and unclickable under the modal); "another tool" unreachable.**

House drift: 384px vs 448; invisible footer band; 32px buttons; 3px/50% focus ring under 3:1.

## Questions

1. Should Grimoire try SQLite's own recovery before asking?
2. Snapshot at close, not only at open?
3. Should Rebuild bring back what it can (maps from their images, scenes by name)?
