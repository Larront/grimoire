---
target: format migration dialog
total_score: 20
max_score: 40
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\FormatMigrationDialog.svelte"
target_fingerprint: "sha256:61211364ea69de187dd039ef38a500159f19f81876cc344aeba7e8372ddb6bb5"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\FormatMigrationDialog.svelte"
timestamp: 2026-10-22T19-26-32Z
slug: src-lib-components-formatmigrationdialog-svelte
---
Method: dual-agent, run sequentially on the one app window (A: design review · B: detector + browser evidence), on a throwaway copy of the Example World stamped at note format 0 (one old Timeline with a `#` description line, one old `<scene-block>` line; and a 25-note variant with 17 warnings).

## Design Health Score — 20/40 (Acceptable)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Neither prompt nor success toast names the world; nothing says which notes changed |
| 2 | Match with real world | 2 | "ledger"; syntax talk ("a line of HTML", "indented by one space"); `.md` paths |
| 3 | User control & freedom | 2 | Toasts unclickable under the prompt; "won't be opened" untrue over an open world |
| 4 | Consistency & standards | 2 | Behind the reworked DbRecoveryDialog in nine ways; red failure toast for a nothing-lost state |
| 5 | Error prevention | 3 | Consent, backup first, busy guard; a retry prunes the earlier backup |
| 6 | Recognition over recall | 2 | The notes are never listed; report hidden in a dot-folder |
| 7 | Flexibility & efficiency | 2 | No way to see affected notes or the report before agreeing |
| 8 | Aesthetic & minimalist | 2 | Two ~40-word sentences; 17 repeated 30-word warnings in a 128px box |
| 9 | Error recovery | 1 | Partial failure names no note; retry inside the world fails generically |
| 10 | Help & documentation | 2 | The report is good, but reachable for 8s through a hidden folder |

Detector: CLI 0; browser 0 inside the dialog or toast.

## Priority issues

- **[P1] No world named; "ledger".** Over another world it reads as that one being rewritten.
- **[P1] The notes are never shown; the sentences explain syntax, not the GM's notes.**
- **[P1] Partial failure:** red, unnamed, retry inside the open world fails ("Something went wrong"), the toast outlives its world, the report says the notes were updated.
- **[P2] Success ending says nothing usable:** 8s, no world, no notes, no mention of the prose change the prompt warned about.
- **[P2] Frame:** copy flashes empty on close; no Escape guard; `aria-describedby` covers only the first paragraph; focus lost on close; 384px; invisible tints; native scrollbar.

## Flag for the owner

A retry after a partial failure backs up only the remaining notes and prunes the backup of the ones rewritten minutes earlier (`prune_old_backups`).

## Questions

1. List the notes before agreeing?
2. Should the "why" move to the report?
3. Should the success toast remember the GM's prose change?
