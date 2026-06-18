# Contributing to Grimoire

Thanks for your interest in improving Grimoire! It's a desktop app built with
**Tauri 2** (Rust backend) and **SvelteKit + Svelte 5** (frontend). This guide
covers how to get set up, the conventions we follow, and how changes make their
way into a release.

## Ways to contribute

- **Report bugs / request features** — open an issue. Include repro steps,
  your OS, and the app version for bugs.
- **Submit code** — fork the repo, make your change on a branch, and open a
  pull request (see [Branching & workflow](#branching--workflow) below).

## Development setup

### Prerequisites

1. **Node.js** (LTS) and **[Bun](https://bun.sh)** — the package manager and task runner.
2. **Rust** via [rustup](https://rustup.rs).
3. **Tauri system dependencies** for your OS — follow the official
   [Tauri prerequisites](https://tauri.app/start/prerequisites/). On Debian/Ubuntu:

   ```bash
   sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev \
     librsvg2-dev patchelf build-essential curl wget file libssl-dev
   ```

### Install & run

```bash
bun install

bun run tauri dev   # full desktop app (Tauri + Vite)
bun run dev         # frontend only (browser, no Tauri APIs)
bun run check       # svelte-check type checking
bun run test        # vitest unit/integration tests
bun run tauri build # production bundle for your platform
```

> **Note:** `bun run dev` runs the frontend in a plain browser where Tauri APIs
> are absent — features that call the Rust backend only work under `bun run tauri dev`.

## Project layout

| Path | Contents |
| :--- | :--- |
| `src/` | SvelteKit frontend (Svelte 5 runes) |
| `src/lib/components/ui/` | Generated shadcn-svelte primitives — **do not hand-edit** |
| `src/lib/bindings.gen.ts` | Auto-generated TS command bindings — **do not hand-edit** (see ADR-0009) |
| `src-tauri/src/` | Rust backend |
| `src-tauri/src/commands/` | Tauri command handlers (the frontend ↔ backend seam) |
| `docs/adr/` | Architecture Decision Records — read these before large changes |
| `docs/agents/` | Deeper reference: `architecture.md`, `domain.md`, `git-workflow.md`, `conventions.md` |
| `CONTEXT.md` | High-level project context and domain language |

## Coding conventions

These mirror [`docs/agents/conventions.md`](docs/agents/conventions.md):

- **Svelte 5 runes only** — `$state`, `$derived`, `$effect`. No legacy Svelte 4 stores.
- **Prefer shadcn-svelte components** in `src/lib/components/ui/` over raw HTML for
  consistent styling. Don't hand-edit the generated files.
- **Tailwind CSS 4** — CSS-first config in `src/app.css`; no `tailwind.config.ts` class list.
- **Rust commands return `Result`** with string errors surfaced to the frontend
  (see [ADR-0010](docs/adr/0010-command-error-posture.md)). Avoid `unwrap()`/`panic!`
  in command paths.
- **Formatting** — run Prettier (`bunx prettier --write .`) before committing.
- **Both `bun run check` and `bun run test` must pass** — CI enforces them.

## Branching & workflow

Grimoire uses a `main` / `next` / `feature/*` model (full detail in
[`docs/agents/git-workflow.md`](docs/agents/git-workflow.md)):

| Branch | Purpose | Stability |
| :--- | :--- | :--- |
| `main` | Production-ready; matches the current stable release | **Protected** |
| `next` | Integration branch for the upcoming release | Beta / testing |
| `feature/*` | Short-lived branches for a specific task or fix | Experimental |

**Always branch from `next`, never from `main`:**

```bash
git checkout next
git pull origin next
git checkout -b feature/your-change
```

Reference issues in commit messages with closing keywords, e.g.
`git commit -m "Add map pin tooltips (fixes #123)"`.

### Opening a pull request

- **External contributors:** fork the repo, push your `feature/*` branch to your
  fork, and open a PR **targeting `next`**.
- Keep PRs focused; describe what changed and why, and link any related issues.
- CI runs `bun run check` and `bun run test` on every PR — make sure they're green.
- A maintainer reviews and merges. `next` accumulates features for the next release.

## Release process (maintainers)

`main` is protected: **no direct pushes, no force-pushes, and all changes go
through a PR** with passing CI. Promoting a release therefore goes via PR, not a
local merge-and-push:

1. Ensure `next` is stable and CI is green.
2. **Bump the version in all three manifests together** (they must match or the
   updater won't recognise a release as newer):
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
3. Open a PR from `next` → `main`, confirm CI passes, and merge it.
4. Tag the release on `main` and push the tag:

   ```bash
   git checkout main && git pull
   git tag -a v0.1.0 -m "Release 0.1.0: summary"
   git push origin v0.1.0
   ```

5. The `release` workflow fans out across macOS / Windows / Linux runners, builds
   installers + signed updater artifacts, emits `latest.json`, and creates a
   **draft** GitHub Release.
6. Review the draft and **publish** it. The updater endpoint only resolves to
   *published* (non-draft) releases, so existing installs see the update only
   after you publish.

> Updater signing keys live in the repository's `release` environment secrets and
> are injected at build time. They are not OS code-signing keys — see the README
> for the (current) unsigned-build caveats on macOS.

## License

By contributing, you agree that your contributions will be licensed under the
project's [GNU General Public License v3.0](LICENSE).
