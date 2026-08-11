# CLAUDE.md

Grimoire is a Tauri 2 desktop app for worldbuilding — Notes (Markdown), Scenes (ambient audio), and Maps (annotated images with pins), backed by a local SQLite ledger. Package manager: **bun**.

## Two products in one repo

This is a bun workspace holding **two separate products**. Know which one you
are editing:

| Path      | Product                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------- |
| `src/`    | The desktop app — SvelteKit + Tauri. Root `PRODUCT.md` / `DESIGN.md` describe this one.        |
| `site/`   | The product website — Astro, deployed to GitHub Pages. Has its own `PRODUCT.md` / `DESIGN.md`. |
| `shared/` | What both consume. Today: `tokens.css`.                                                        |

The two `PRODUCT.md` files are **not** duplicates to be reconciled — they
describe different things, and the website's is intentionally the longer of
the two.

`shared/tokens.css` is the single source of truth for colour, type and radius,
and the app's vocabulary is canonical: the site conforms to it. Change a token
there and both products move together, which is the point. Anything only one
product needs stays in that product's stylesheet — see the header comment in
the file before adding to it.

## Commands

```bash
bun run dev          # Frontend only (Vite, no Tauri window)
bun run tauri dev    # Full desktop app
bun run check        # Type-check
bun run check:watch
bun run tauri build  # Production build

bun run site:dev     # Website dev server
bun run site:build   # Website production build (into site/dist)
bun run site:check   # Website type-check
```

## Guides

- [Architecture](docs/agents/architecture.md) — IPC bridge, state, routing, Rust backend, database, libraries
- [Conventions](docs/agents/conventions.md) — Svelte 5 runes, shadcn-svelte, Tailwind
- [Git workflow](docs/agents/git-workflow.md) — branch strategy and rules
- [Issue tracker](docs/agents/issue-tracker.md)
- [Triage labels](docs/agents/triage-labels.md)
- [Domain docs](docs/agents/domain.md)
