---
target: slash command menu
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 5
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\editor\\SlashCommandMenu.svelte"
target_fingerprint: "sha256:a6b955bbeb8930b8ebc4a5bf982576a5fe853da82122ee814f9f8ebc02609558"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\editor\\SlashCommandMenu.svelte"
timestamp: 2026-10-15T01-01-46Z
slug: src-lib-components-editor-slashcommandmenu-svelte
---
Method: dual-agent, run sequentially on the one app window (A: aa24a0f9a6f04eede · B: a2d9ebd264a0b8a65)

## Design Health Score — 19/40 (Poor)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 1 | Selected row has no background (bg-muted == bg-popover); /statblock <name> gives no hint whether a preset matched |
| 2 | Match system / real world | 3 | GM vocabulary; but two "Quote" rows with the same icon |
| 3 | User control and freedom | 2 | Escape/undo work; a preset statblock is left invisibly selected and the next key replaces it |
| 4 | Consistency and standards | 2 | Selection, headers, hover, empty state all differ from the palette |
| 5 | Error prevention | 1 | No ranking: /st → Bullet List, /no → Bullet List, /im → Timeline |
| 6 | Recognition rather than recall | 2 | Preset names and argument syntax must be remembered |
| 7 | Flexibility and efficiency | 2 | Filter, Tab, argument work; no Home/End/PgUp/PgDn, recents, preset completion |
| 8 | Aesthetic and minimalist | 3 | Quiet and on-system; 24-row wall, uppercase faint headers, native scrollbar arrows |
| 9 | Error recovery | 2 | Missed preset name silently gives a blank block; zero results closes silently |
| 10 | Help and documentation | 1 | No descriptions; argument syntax documented only in Settings |

## Design specificity
On-system surface (Iron Raised, shadow-float, Nunito 13px, no crimson) on a generic Notion-style structure. First screen is Paragraph, H1-3, Quote, Code Block, lists; the GM's blocks (Scene, Infobox, Statblock, Timeline) are rows 10-13; 10 callouts are 42% of the list; presets have no UI.
Detector: CLI clean (0). Live: low-contrast on group headers, 3.0:1 dark / 2.5:1 light (11px, muted-foreground/60). Detector missed the invisible selection (ratio 1.00) and missing aria-activedescendant.

## Priority issues
1. [P1] Selected row invisible; hover lights a second row. Root cause shared: --muted == --popover, so bg-muted highlights vanish on every floating surface (wikilink suggestion, block handle menu, hover on floating toolbars). Fix: bg-surface-selected / bg-surface-hover as the palette uses; hover moves the selection.
2. [P1] Results unranked. Fix: label prefix > word prefix > keyword exact > keyword prefix > substring.
3. [P1] Statblock presets invisible; /statblock Goblin silently blank; /statblock 5E SRD gives a creature named "5E SRD". Fix: preset rows under Statblock once the query names it; the row says what Enter will do.
4. [P1] Preset-stamped statblock left as an invisible node selection; next keystroke replaces it. Fix: caret after it / focus a field; visible selected-node outline.
5. [P1] Screen reader silent: no aria-activedescendant/controls/expanded, options without ids, buttons are submit + tabbable, groups aria-hidden. Fix as ScenePicker does.

P2: GM blocks buried / 10 callouts always expanded; header contrast and style differ from palette; no-results vanishes; menu stranded on scroll; /bullet in a list leaves an empty item; native scrollbar arrows.

## Persona red flags
Alex: /st Enter → bullet list; no Home/End; /statblock lar → blank "lar".
Sam: selection only a text-colour change; nothing announced; headers sub-AA.
GM mid-session: wrong block on Enter; preset misses invisible; stamped creature typed away; menu stranded when scrolling.

## Minor
Spellcheck squiggle under /statblock; row height ignores --row-h; no open motion; possible stale range on cold preset load; image cancel is silent.

## Questions
Should Paragraph/H1-3/Code own the first screen when markdown shortcuts make them? Do preset rows settle the picker debate? Should Enter ever do something the row doesn't say?
