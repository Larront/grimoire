---
target: Splash Screen (src/routes/+page.svelte)
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\routes\\+page.svelte"
target_fingerprint: "sha256:1976239c8bca1afec6dd159b510145345051ba01a4de43ddf1495f6125d72d5a"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\routes\\+page.svelte"
timestamp: 2026-10-22T23-06-21Z
slug: src-routes-page-svelte
---
Method: dual-agent (A: design review in the live app · B: detector + live overlay)

# Critique: the Splash Screen

I covered every mode: returning (the three real worlds, plus faked lists for long names, many worlds and a moved folder), first-time, creating a world, Explore an example world, and launch itself. I also checked the smallest window, a 1920 window, light mode, reduced motion and keyboard-only use. None of your worlds were opened or touched.

**One incident.** While testing the keyboard, the reviewer pressed Enter on Open Existing Ledger by mistake, which opened the Windows folder picker. It was closed with Cancel. Nothing was opened or changed.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | The window is pure white for its first frames. While the list loads, the wordmark sits alone with no sign that anything is coming. |
| 2 | Match with the GM's world | 2 | "Explore an example world" sits next to "Create New Ledger" and "Recent Ledgers": two words for one thing on the first screen. |
| 3 | User control and freedom | 2 | Escape or Cancel in the create form drops focus to nowhere. Exploring the example again silently wipes your last visit. |
| 4 | Consistency and standards | 2 | Title Case here, sentence case elsewhere. Crimson used as text and decoration. The remove ✕ draws its own focus ring. |
| 5 | Error prevention | 3 | Moved folders can't be clicked, and the form checks before it creates. The silent reset of the example is the gap. |
| 6 | Recognition over recall | 3 | Rows show size and when each world was last opened. Long names are cut off with no tooltip. A moved folder shows the useless start of its path. |
| 7 | Flexibility and efficiency | 2 | Nothing has focus on launch, so Enter can't reopen your last world. With 10 recent worlds, the buttons fall off the bottom. |
| 8 | Aesthetic and minimalist design | 3 | Calm and restrained. But a 280px column in a 1280px window, and decoration the rules ban. |
| 9 | Error recovery | 2 | One generic red line ("Something went wrong") under everything, with no icon and no world named. A moved folder offers only ✕, never "Find it…". |
| 10 | Help and documentation | 3 | The example world is excellent onboarding. Only first-timers ever see a line saying what Grimoire is. |
| **Total** | | **24/40** | **Acceptable** |

## Design Specificity Verdict

**Review:** it's partly Grimoire and mostly a generic launcher. The Grimoire parts are the crimson Metamorphous wordmark (it matches the sidebar and the website), the warm iron, and world names in the display face. The layout is the VS Code or JetBrains welcome screen: a narrow centred column, a tagline, three stacked buttons with sub-lines, and a recent list.

PRODUCT.md promises the arrival will be "richer, more considered". It's actually one of the quietest screens in the app. Its only extra richness is a faint glow and a crimson rule under the wordmark, and both break the design rules. The website says "A spellbook of record for the world you're building", and the example world's Start Here note has real voice. The screen that leads into both has the least character of all three.

**Detector:**
- **Code scan:** 4 advisory findings, all real. The wordmark is 52px when nothing should exceed the 44px Title size, and world names are a hard-coded 15px that isn't on the type scale.
- **Live overlay, 5 views:**
  - Real contrast failures:
    - the timestamps (3.0:1 dark, 2.5:1 light)
    - crimson "Open Existing Ledger" (3.3:1 at 11px)
    - the button sub-lines (3.2:1 and 3.6:1)
    - the moved-folder path (2.6:1)
  - The light-mode glow was flagged as a spotlight effect.
  - Two "text occlusion" hits were the detector's own labels, so they're false positives.
- **Agreement:** both assessments found the contrast failures and the light-mode glow independently. The detector added the off-scale sizes. The review added what a detector can't see: the white flash, the layout breaking with real names, focus loss, and the silent reset.

## Overall Impression

**What works:** the step from the Splash into the example world. Open a world and you're in it.

**What doesn't:** the screen around that step. It flashes white, then shows a thin column of truncated names in a big empty window. The returning GM gets the plainest version of all.

**Biggest opportunity:** let your world be the first thing you see. Put your last world's name at full size with a focused Continue, so one keypress drops you back into your campaign. That puts the character in your content, which is the rule this design system runs on.

## What's Working

- **Hand-off to the example world.** It opens in about 0.4s, lands on a Start Here note written in a world voice, and doesn't add the example to your Recent list.
- **Moved folders handled honestly.** The row is dimmed and can't be clicked. It isn't silently dropped, and the remove button names the world.
- **Create form manners.** Focus goes into Name, problems show only after you try to go on (each under its own field), Enter creates and Escape cancels.

## Priority Issues

**[P1] A white flash is the first thing anyone sees**
- **What:** the window is pure white for its first frames, then turns dark. It's the very start of the first impression.
- **Why:** the window has no background colour (`tauri.conf.json`), and the page starts with no theme class or background (`app.html`). The page title is also still the scaffold's "Tauri + SvelteKit + Typescript App".
- **Fix:**
  - Give the window the iron background.
  - Have the page start dark until the theme loads; Parchment users switch over after.
  - Fix the page title.
- **Command:** `/impeccable harden`

**[P1] The layout doesn't hold up to real worlds**
- **What:** the fixed 280px column causes four problems.
  - It cuts your own names short ("No Room For A Wallflo…", "Lost Mine of Phandelv…"), with no tooltip.
  - It wraps a world's stats mid-phrase.
  - At the 10-world limit the whole page scrolls and the buttons fall off the bottom.
  - The wordmark jumps between modes because everything is centred vertically.
- **Fix:**
  - A wider column, about 440px.
  - The list scrolls inside a capped height.
  - The wordmark stays at a fixed height.
  - The buttons stay in view.
  - Full names show on hover.
- **Command:** `/impeccable layout`

**[P1] It doesn't earn the arrival moment, and its decoration breaks the rules**
- **What:**
  - It's a generic launcher.
  - The tagline and any sense of what Grimoire is appear only to first-timers.
  - The glow behind the wordmark is a hard-coded brown that turns into a dirty smudge in light mode. That's the "fog overlay" anti-reference.
  - The crimson gradient rule breaks the Signal Rule.
  - The words mix "ledger" and "world", use Title Case, and ask returning users "New to Grimoire?".
- **Fix:**
  - Remove the glow and the crimson rule.
  - Lead with your world.
  - Pick one noun.
  - Give the first-time screen the website's voice.
- **Command:** `/impeccable shape`, then `/impeccable typeset`

**[P2] Colour and contrast**
- **What:**
  - "Open Existing Ledger" is set in crimson text, though it isn't the primary action.
  - Timestamps are in the faint grey that's meant only for decoration (3.0:1).
  - Button sub-lines are at 70% opacity.
  - In first-time mode, "Create New Ledger" looks dimmer than the third option, so it reads as disabled.
  - The moved-folder path is at 2.6:1.
  - The remove ✕ is faint, a 22px target, and draws its own ring.
  - The wordmark is 52px.
- **Fix:** neutral secondary buttons, muted (AA) grey for timestamps and sub-lines, the global focus outline on the ✕ and a 24px target, and the wordmark on the type scale.
- **Command:** `/impeccable polish`

**[P2] Keyboard and screen reader**
- **What:**
  - Escape or Cancel from the create form drops focus to nowhere.
  - Nothing is focused on launch.
  - "Recent Ledgers" isn't a heading and the rows aren't a list.
  - Loading and form errors aren't announced.
  - The page title is the scaffold's.
- **Fix:**
  - Focus the top world on launch, so Enter continues.
  - Return focus to Create after cancelling.
  - Add heading and list structure.
  - Give the busy state a live region, and announce errors.
- **Command:** `/impeccable harden`

## Persona Red Flags

- **Jordan (first-timer):**
  - the white flash
  - "ledger" jargon next to "world"
  - "Create New Ledger" looks disabled
  - the placeholder "My Campaign" reads like a value already filled in

  The crimson "Explore an example world" as the first choice is right.
- **Alex (keyboard power user):**
  - Tab before Enter on every launch
  - can't remove a stale world unless its folder is missing
  - at 10 worlds the buttons scroll away
  - focus lost after Escape
- **Sam (screen reader):**
  - the scaffold page title
  - no headings or list
  - loading isn't announced

  Rows read well, and the form's errors are linked to their fields.
- **Riley (stress tester):**
  - a 77-character name becomes "An Exceedingly Long C…"
  - 14 worlds push the page off screen
  - at the minimum window, 5 rows fill it
  - the light-mode smudge
- **A GM opening the app ten minutes before a session:**
  - a white flash
  - no Enter-to-continue
  - if the campaign is on an unplugged drive, the row says "Folder not found" with only ✕, so there's no "Find it…" and no "Try again". That's a panic moment at the worst time.

## Minor Observations

- **Two Voices:** world names in the list are in Metamorphous, which the rule gives to Nunito for list items. Here the names arguably *are* the subject, so decide it explicitly.
- **Small text:** the main actions are 11px text on 28px buttons, when 13px is the button size.
- **"Creating..."** uses three dots where the rest of the app uses "…".
- **Timestamps:**
  - "14mo ago" could read "over a year ago".
  - Moved-folder rows lose their last-opened time.
- **Fade-in:** the explore link appears at full strength before everything else fades in, a glitch in the opening sequence.
- **Reduced motion:** with the OS asking for it, the fade still plays; the app reads that setting only once, at first run.
- **Error line:** a failed open probably reports twice (a toast and the red line). Inferred from code, not seen.
- **Big windows:** at 1920 wide the content uses about 15% of the window.

## Questions to Consider

- What if the returning Splash led with **your** last world? Its name at Title size, perhaps a quiet strip of its own map image (your content, not decoration), and "Continue · 205 notes · opened a week ago", focused so Enter resumes. Your other worlds would follow as a compact list.
- Should a GM ever read the word "ledger"? The website builds its brand on it ("Take up the ledger"); the app's newer copy says "world". The Splash is where to settle it.
- Is the crimson wordmark an accepted exception to the Signal Rule? It's crimson here, in the sidebar and on the website, but the rule doesn't list it.
