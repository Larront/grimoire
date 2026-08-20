# Conventions

- **Svelte 5 runes only** — use `$state`, `$derived`, `$effect`. No legacy Svelte 4 stores.
- **shadcn-svelte components** are generated into `src/lib/components/ui/` — do not hand-edit these files; prefer them over raw HTML for consistent styling.
- **Tailwind CSS 4** — no `tailwind.config.ts` class list needed; uses CSS-first config in `app.css`.
- **Tests that measure a box go in `*.browser.test.ts`** — `bun run test` runs two Vitest
  projects: `unit` in jsdom, and `browser` in a real headless Chromium (`bunx playwright
install chromium` once, locally). jsdom performs **no layout**: every element is 0×0 at
  0,0, so an assertion about a position, a width, or one thing fitting beside another
  passes no matter what the stylesheet says — which is how a statblock tiling bug once
  shipped green. Everything else stays in jsdom, which is far faster.
