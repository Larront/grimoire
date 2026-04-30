# Conventions

- **Svelte 5 runes only** — use `$state`, `$derived`, `$effect`. No legacy Svelte 4 stores.
- **shadcn-svelte components** are generated into `src/lib/components/ui/` — do not hand-edit these files; prefer them over raw HTML for consistent styling.
- **Tailwind CSS 4** — no `tailwind.config.ts` class list needed; uses CSS-first config in `app.css`.
