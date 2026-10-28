---
target: the Grimoire website
total_score: 20
max_score: 32
na_heuristics: 7,10
p0_count: 1
p1_count: 2
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\.claude\\worktrees\\website-consistency-review-f9d9b4\\site\\src\\pages\\index.astro"
target_fingerprint: "sha256:db6045ff481a7388638de92ee2d6690f5455c15497b400b40e697e76ef138511"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\.claude\\worktrees\\website-consistency-review-f9d9b4\\site\\src\\pages\\index.astro"
timestamp: 2026-10-28T19-39-26Z
slug: site-src-pages-index-astro
---
Method: dual-agent (A: design review · B: detector + browser overlay)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Version/date real; no file sizes |
| 2 | Match System / Real World | 3 | GM language strong; packaging jargon in downloads |
| 3 | User Control and Freedom | 3 | Static page; anchors and Back work |
| 4 | Consistency and Standards | 2 | Breaks ~10 app rules; mixed H3 voices; glued words |
| 5 | Error Prevention | 2 | 6 equal links; .deb glibc unstated; Spotify Premium unstated |
| 6 | Recognition Rather Than Recall | 2 | Install steps away from each OS's button |
| 7 | Flexibility and Efficiency | n/a | Single-page Persuade surface |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained; stale screenshots, mono overuse |
| 9 | Error Recovery | 2 | macOS step obsolete since Sequoia; Windows step garbled |
| 10 | Help and Documentation | n/a | Landing page |
| **Total** | | **20/32** | **Acceptable (62%)** |

## Design Specificity Verdict

Voice authored for Grimoire; structure is the standard dark dev-tool landing template. The together-claim is told in prose, not shown. Detector: CLI clean; browser 11 element + 3 page findings — contrast on faint labels (3.0–3.2:1) and crimson numbered eyebrows (3.6:1), CTA glow, 14 em-dashes, straggler in Maps paragraph, 103ch line in unsigned note. Wordmark contrast is a false positive (logotype; Signal Rule exception).

## Priority Issues

- [P0] False/overstated claims: nested maps, journeys (index.astro:180-188), "every byte a plain file" (:144), first-launch "pick any folder" (:290). Fix copy to real capabilities. /impeccable clarify
- [P1] Install moment: Astro whitespace collapse renders "onWindows, chooseMore info" and "—read"; macOS step obsolete since Sequoia; no Linux line; "read it on GitHub" not a link. /impeccable clarify
- [P1] Screenshots are the old grey app (sampled #1f1f1f/#181818) in warm chrome; audio shots cropped 16:9→4:3 slice wordmark; OG image stale; hero lazy-loaded. Owner recapture + /impeccable optimize
- [P2] Drift from app DESIGN.md: crimson small labels, Ember Faint meaningful labels, uppercase mono labels and mono prose, link underline 1.24:1 at rest, nav backdrop-blur, hover movement + glow, 90ms stagger and expo curve, primary/80 hover, en-US date, stale site/DESIGN.md, mixed H3 voices, ledger capitalisation. /impeccable polish
- [P2] Download decision: 6 equal links, no OS detection, half-empty frame, silent OS drop in releases.ts. /impeccable layout

## Persona Red Flags

- Jordan: msi vs exe; chip choice; Ledger undefined until 04; glued words; no first-launch preview.
- Riley: nested maps absent; .deb on Debian 12 fails glibc; Spotify Premium.
- Casey: no image in first fold; eyebrow wraps to lone "/"; 20px footer targets; 1.85 MB images, no srcset.
- Skeptical GM from Discord: grey OG unfurl; "every byte a plain file" false; no prerelease signal.

## Minor Observations

Hero img lazy (LCP); alt "sample world"; "pin a scene to any highlighted passage" overclaims; OS minimums unenforced; platform notes duplicated in releases.ts; straggler; 103ch line.

## Questions to Consider

- Why is the site less designed than the Splash that borrowed its voice?
- Could one short loop replace all three feature sections?
- Does the CTA glow earn its exception?
