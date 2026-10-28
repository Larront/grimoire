---
target: settings dialog
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\SettingsDialog.svelte"
target_fingerprint: "sha256:aa35800c71d984fa5df7d463657b50a7043b9a993d8a09f4f394025ed7f0b6b0"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\SettingsDialog.svelte"
timestamp: 2026-10-19T22-16-35Z
slug: src-lib-components-settingsdialog-svelte
---
Method: dual-agent, run sequentially on the one app window (A: a3a8969aa7b1a85db · B: a45ba5dd00e8f28b3)

## Design Health Score — 24/40 (Acceptable)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Live preview is good; nothing says what was saved where; Spotify status cached once per session |
| 2 | Match system / real world | 3 | "campaign" / "world" / "ledger" drift; "wikilinks"; "Layout compactness" |
| 3 | User control and freedom | 2 | Modal confirmations with no undo; Manage tags drops out of Settings |
| 4 | Consistency and standards | 2 | Crimson toggles, native select, invisible ghost hover, crimson destructive buttons, three control heights |
| 5 | Error prevention | 3 | Confirmations exist; built-in names blocked; dangling default labelled |
| 6 | Recognition rather than recall | 2 | Accent swatches unnamed; no sign of which settings are per-world |
| 7 | Flexibility and efficiency | 2 | No Ctrl+,; no palette commands for accent/density/motion; 12 Tab stops on Appearance |
| 8 | Aesthetic and minimalist | 3 | Quiet; large voids; About is a wall of text |
| 9 | Error recovery | 2 | Spotify connect failure silent |
| 10 | Help and documentation | 2 | Descriptions on every row; density's effect unexplained |

## Design specificity
Calm, on-brand, but generic shadcn defaults where the house style hasn't reached.
Detector: CLI clean; live clean inside the dialog. Measured: `text-(--font-ui)`/`text-(--font-body)` compile to `color:`, not font-size (43 uses app-wide); off switch 1.3:1; triple scrim 0.91 alpha; ghost hover 1.0; select focus a 0.8px border; invisible tabpanel Tab stop in every section.

## Priority issues
1. [P1] Crimson toggles break the Signal Rule; off state 1.3:1. Same copy in TagManager.
2. [P1] Per-world vs app-wide settings unexplained (accent, density per ledger).
3. [P1] Confirmations stack three scrims and use modals for destructive actions, crimson buttons.
4. [P2] Keyboard/screen-reader gaps: invisible tabpanel stop, unnamed swatch group, focus ring = selected ring, pressed buttons instead of radios, 1px select focus.
5. [P2] Controls of different sizes/styles; native select; font tokens never applied.

## Personas
Alex: no Ctrl+,; no palette commands; 12 Tab stops; Manage tags loses Settings.
Sam: invisible stop; unnamed swatches; off switch invisible; select focus 1px; error without icon.
Jordan: accent doesn't follow to their world; density also changes text size; "campaign"/"wikilinks"; Spotify failure silent.

## Questions
Scope honesty for appearance; non-modal destructive actions; one page instead of five tabs?
