---
target: wikilink suggestion
total_score: 13
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\editor\\WikiLinkSuggestion.svelte"
target_fingerprint: "sha256:0c9ffd8244d1c499472f93c1f827b912846d6055b7078970b2d30230f1d14a21"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\editor\\WikiLinkSuggestion.svelte"
timestamp: 2026-10-16T02-26-08Z
slug: mponents-editor-wikilinksuggestion-svelte-d150d2de
---
Method: dual-agent, run sequentially on the one app window (A: af43ae0e269f00fd1 · B: a75ca8e3b43ec2b9a)

## Design Health Score — 13/40 (Poor)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 1 | Bare [[ says "No notes found"; 10-result cap with no signal; menu detaches on scroll |
| 2 | Match system / real world | 2 | Every row carries a Folder/Name.md path |
| 3 | User control and freedom | 1 | A space closes the menu; typed |alias and #heading thrown away; stub click writes a file unasked |
| 4 | Consistency and standards | 1 | Differs from the slash menu on Tab, hover, width, scroll, paging, ARIA; three surfaces disagree |
| 5 | Error prevention | 1 | Tab then Enter inserts a different note; Quick Note dialog click saves the half-typed line |
| 6 | Recognition rather than recall | 2 | No recents, aliases not shown, no folder matching |
| 7 | Flexibility and efficiency | 1 | No create row, no alias/heading, no paging, no recents |
| 8 | Aesthetic and minimalist | 2 | 52px two-line rows, 4.5 visible, platform scrollbar, sub-AA path line |
| 9 | Error recovery | 1 | No match is a dead end; field double-Escape wipes the edit |
| 10 | Help and documentation | 1 | Nothing explains ]] , spaces, or | |

## Design specificity
Looks like Grimoire (surface, shadow, crimson selection); behaves like generic full-text search: BM25 over bodies, no spaces, empty at [[, drops Obsidian's |display and #heading, never offers coining a new name.
Detector: CLI clean. Live: low-contrast on the path line (3.0 dark / 2.5 light, 2.8/2.4 on lit rows) and on "No notes found" (3.0 / 2.5). Measured: two rows lit at once; options tabbable with no ids; no aria-activedescendant; classic scrollbar; 261x240 with 4 rows visible.

## Priority issues
1. [P0] The prose menu can't search a real name, and opens empty: allowSpaces false, prefix must be a space, empty/1-char query returns nothing.
2. [P0] Ranking finds body text, not the note meant: BM25 body+title, alias prefix-only and appended, no tie-break, cap 10, excerpt read per result.
3. [P1] What the GM typed or pointed at is replaced or lost: |display and #heading dropped; Tab moves focus into the list so Enter inserts another note; hover lights a second row; Quick Note dialog click commits the raw line.
4. [P1] No match is a dead end, and a stub click creates a file without asking.
5. [P2] Behind the slash menu on parity: no ARIA wiring, no scroll follow, no paging, 52px rows, platform scrollbar; field menus anchor to the field, not the caret.

## Personas
Alex: no spaces, alias lost, 10-cap, Tab jumps into the list.
Sam: nothing announced; tabbable unnamed options; Enter on focused row overrides highlighted; field double-Escape wipes edit.
GM mid-session: "No notes found" at [[; no create; stub click drops them into a new empty file; Quick Note click files a broken note.

## Questions
Should a bare [[ be the most useful moment? Is the link menu a search box in disguise? Should coining a name be a first-class row?
