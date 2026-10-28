---
target: SampleBanner (and the example world signals)
total_score: 17
max_score: 36
na_heuristics: 9
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\SampleBanner.svelte"
target_fingerprint: "sha256:9de63489fee209e3a37ed0ae1e1a048477941ff50007c1bf334c0bdc70beaaa8"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\SampleBanner.svelte"
timestamp: 2026-10-26T19-28-31Z
slug: src-lib-components-samplebanner-svelte
---
Method: dual-agent (A: design review in the live app · B: detector + live overlay)

# Critique: the SampleBanner (and how the example world identifies itself)

The reviewer worked in a fresh copy of the example world. It turned the banner on (your setting has it dismissed), checked a first visit and a "Continue" visit, split panes, light mode, keyboard and screen-reader use, and the Adopt dialog. It then set your banner setting back to dismissed and confirmed it.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Says "example" but never that your changes are kept for next time. Once dismissed, the only marker is in the sidebar, which is hidden below 1024px. |
| 2 | Match with the GM's world | 2 | "your real ledgers": the code's word, and "real" makes the example sound fake. "Poke around freely" implies a scratch copy, but it's kept. |
| 3 | User control and freedom | 1 | No way back to your own worlds except the palette's "Switch ledger…", which opens a folder picker. Dismissing is permanent, with no way to undo it. |
| 4 | Consistency and standards | 1 | Three names for one place: "Example World", "The Ashfen Vale", "an example world". Crimson against the rule, and a crimson hover on its ✕. |
| 5 | Error prevention | 2 | Nothing warns that "Start it over" wipes what you wrote. The Adopt dialog still promises it can be explored "fresh any time". |
| 6 | Recognition over recall | 2 | Doesn't point to "Make this world mine". |
| 7 | Flexibility and efficiency | 3 | One click and it's gone. |
| 8 | Aesthetic and minimalist design | 2 | A 39px strip saying what the sidebar already says, and it pushes only the left pane down. |
| 9 | Error recovery | n/a | It has no error states. |
| 10 | Help and documentation | 2 | Start Here does the real explaining; the banner adds nothing. |
| **Total** | | **17/36** | **Poor** (47%) |

## Design Specificity Verdict

**Review:** generic. It's a stock tinted info bar with an icon, one small sentence and a ✕, and nothing about it belongs to Grimoire. It breaks two settled rules:
- **Signal Rule:** DESIGN.md names "you are in the sample" as something that stays neutral, but the banner is crimson in four places (tint, border, icon, hover). In light mode it reads as a pink alert.
- **Vocabulary:** it says "ledgers" to the GM.

Since the example now continues and can be kept, its sentence is also out of date.

**Detector:** clean. 0 findings in the code scan and in three live views (dark, light, keyboard focus). It measured the text at 6.2:1 dark and 4.8:1 light, and the icon at 3.3:1. The only hits were outside the banner: the known key-hint false positive, and em dashes in the example's own Start Here text.

**Agreement:** the detector can't see what's wrong here. Every finding is about meaning, placement and vocabulary, which only the review caught.

## Overall Impression

**What works:** it's quiet and readable, and dismissing it is remembered.

**What doesn't:**
- It says the wrong thing about the example, using the wrong word, in the wrong colour.
- It pushes the left pane 39px below the right.
- The example world has no way back to your own worlds.

**Biggest opportunity:** decide where "you're in the example" lives. Say it once there, and include the two things the GM actually needs: keep this world, or go back to yours.

## What's Working

- **Readable and quiet:** the text is 12px muted grey, with AA contrast in both themes.
- **Correct button:** the ✕ has a proper label and uses the app's own focus ring.
- **Remembered:** dismissing it carries across visits, so returning explorers aren't nagged.

## Priority Issues

**[P1] No way back to your own worlds from inside the example**
- **What:** inside the example, the sidebar's world switcher is replaced by the example marker (`LedgerSelector.svelte:43`), and nothing in the app closes a world. The only route out is the palette's "Switch ledger…", which opens a folder picker.
- **Why it matters:** a first-timer who explores is stuck there.
- **Fix:** a "Back to your worlds" action that returns to the Splash, where your worlds and "start it over" already are.
- **Command:** `/impeccable onboard`

**[P1] It says the wrong thing**
- **What:** "Poke around freely; nothing here affects your real ledgers." The example is now kept as you leave it and can be made yours, so it isn't scratch space. The Adopt dialog also still says the example stays "to explore fresh any time".
- **Fix:** say what's true, once, in the right place, and offer **Make this world mine**.
- **Command:** `/impeccable clarify`

**[P1] Split panes misalign**
- **What:** the banner sits inside the left pane only, so the left tab bar is 39px (49px at the smallest window) lower than the right.
- **Fix:** run it across the full width, or remove it (see questions).
- **Command:** `/impeccable layout`

**[P2] Crimson where the rule says neutral**
- **What:** the tint, border, icon and hover are all crimson.
- **Fix:** neutral surface and border, a muted icon, and the shared hover.
- **Command:** `/impeccable quieter`

**[P2] Dismissing loses focus and is for ever**
- **What:** Enter on the ✕ drops focus to nowhere. Nothing in the app can bring the banner back.
- **Fix:** move focus to the tab bar after dismissing, and make dismissal last one exploration, cleared by "Start it over", if the banner stays at all.
- **Command:** `/impeccable harden`

## Persona Red Flags

- **Jordan (first-timer):**
  - two welcomes compete (the banner and Start Here)
  - "real ledgers" introduces a word never seen again
  - below 1024px the sidebar marker and "Make it mine" are hidden in a sheet
- **Alex (power user):** dismisses it at once, then has no visible way back to their worlds.
- **Sam (screen reader):**
  - no role, and nothing is announced when the example opens
  - the first Tab stop in the workspace is the ✕ of something not yet heard
  - focus is lost after dismissing
- **Riley (stress tester):**
  - wraps to two lines at the minimum window, worsening the split misalignment
  - pink alert in light mode
  - a 39px jump when dismissed
- **A GM who explored, wrote notes, and wants to keep them:** the banner says nothing here matters and the Adopt dialog says the example is "fresh any time". Both suggest their notes are disposable, when in fact they're kept and can be made theirs.

## Minor Observations

- **The ✕ button:** 22×22px (borderline target), with no `type="button"`.
- **Out of date in CONTEXT.md:**
  - It calls the banner one-time, but it shows on every visit until dismissed.
  - It says Explore resets the example, which no longer matches "Continue".
- **"Search ledger…"** in the sidebar is the same vocabulary leak, next door.
- **Opening a note can save it.** The editor re-saves some notes as they open: the example's Start Here gained a trailing blank line. With modified times now following saves, that showed as "edited 2 minutes ago". I've already stopped whitespace-only saves from counting as edits (committed on `feature/sample-banner-review`). The re-save itself is a leftover.

## Questions to Consider

- If the sidebar's example marker said "kept as you leave it", with "Make this world mine" and "Back to your worlds", would the banner earn its 39px at all?
- Should the example's own home page (the one every empty pane shows) be where the example explains itself, rather than a strip over a note?
- Should dismissing mean "for this exploration" rather than "forever"?
