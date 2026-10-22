---
target: adopt dialog
total_score: 18
max_score: 40
p0_count: 1
p1_count: 2
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\AdoptDialog.svelte"
target_fingerprint: "sha256:dc4919b08e716c1568e04b052442595f4d7103dc08ed9aa59a932acc87d8a256"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\AdoptDialog.svelte"
timestamp: 2026-10-21T22-35-42Z
slug: src-lib-components-adoptdialog-svelte
---
Method: dual-agent, run sequentially on the one app window (A: design review · B: detector + browser evidence)

## Design Health Score — 18/40 (Poor)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | No preview of the folder it will make; no reason for the disabled button; no success moment |
| 2 | Match with real world | 2 | "ledger name", "storage location", "Adopting...", "edit freely" |
| 3 | User control & freedom | 2 | Closable mid-copy; click outside drops the typed name |
| 4 | Consistency & standards | 2 | Title Case; 11px labels and buttons; three focus styles; invisible footer band; duplicate of the Splash form |
| 5 | Error prevention | 0 | An existing folder of the same name is deleted (remove_dir_all) and replaced |
| 6 | Recognition over recall | 3 | Two fields, two buttons |
| 7 | Flexibility & efficiency | 1 | Sidebar-only entry; no default location; no palette command |
| 8 | Aesthetic & minimalist | 3 | Quiet; decisive button at 11px |
| 9 | Error recovery | 1 | Stale validation; raw OS errors inline plus a generic toast |
| 10 | Help & documentation | 2 | One clerical description line |

Detector: CLI 0. Browser: placeholder 2.3:1 dark / 2.4:1 light; error 4.2:1 at 11px dark.

## Priority issues

- **[P0] Adopt over an existing folder deletes it.** `adopt_sample_ledger` → `copy_dir_tree` removes the destination first (sample.rs:15-18, 449-450). Fix: refuse an existing destination; keep the wipe for the sandbox reset only.
- **[P1] Long chosen path overflows the card** — inner wrapper lacks min-w-0; buttons pushed off-screen.
- **[P1] Errors stale, raw, doubled, unlinked** — validate as typed; silent api + friendly copy; aria-describedby/invalid; CircleX; no layout jump.
- **[P2] Doesn't say what happens or why it can't continue** — new subfolder, edits come along, example stays; disabled confirm unexplained.
- **[P2] House drift** — sentence-case title, Field labels, default buttons, one focus treatment, no grey footer band; share the fields with the Splash create mode.

## Minor

Mounted inside LedgerSelector (unmounts below 1024px, stacks over the sidebar sheet); closable while copying; copy runs before pending saves flush; synchronous Rust copy may freeze the window; "Explore example world" from inside the sample resets without asking.

## Questions

1. Default location so a first-timer never meets the OS picker at the emotional peak?
2. The GM's name in Metamorphous as they type it?
3. Should Explore example world ask before resetting a sandbox the GM has edited?
