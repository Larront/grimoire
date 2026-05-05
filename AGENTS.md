# CLAUDE.md

Grimoire is a Tauri 2 desktop app for worldbuilding — Notes (Markdown), Scenes (ambient audio), and Maps (annotated images with pins), backed by a local SQLite vault. Package manager: **bun**.

## Commands

```bash
bun run dev          # Frontend only (Vite, no Tauri window)
bun run tauri dev    # Full desktop app
bun run check        # Type-check
bun run check:watch
bun run tauri build  # Production build
```

## Guides

- [Architecture](docs/agents/architecture.md) — IPC bridge, state, routing, Rust backend, database, libraries
- [Conventions](docs/agents/conventions.md) — Svelte 5 runes, shadcn-svelte, Tailwind
- [Git workflow](docs/agents/git-workflow.md) — branch strategy and rules
- [Issue tracker](docs/agents/issue-tracker.md)
- [Triage labels](docs/agents/triage-labels.md)
- [Domain docs](docs/agents/domain.md)
