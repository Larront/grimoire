# Technology Stack

**Analysis Date:** 2026-04-28

## Languages

**Primary:**
- TypeScript 5.6 - All frontend code in `src/`
- Rust (edition 2021, rustc 1.92.0) - All backend code in `src-tauri/src/`

**Secondary:**
- JavaScript - Config files (`vite.config.js`, `svelte.config.js`)
- CSS - Tailwind 4 via `src/app.css` (CSS-first config, no `tailwind.config.ts`)

## Runtime

**Environment:**
- Bun 1.3.11 - Frontend runtime and package manager
- Node.js 25.2.1 - Available but Bun is primary
- Tauri 2 - Desktop app shell; wraps Vite frontend in a native window

**Package Manager:**
- Bun 1.3.11
- Lockfile: `bun.lock` (present, committed)

## Frameworks

**Core:**
- SvelteKit 2.9 with Svelte 5 - Frontend framework, SPA mode (no SSR)
- Tauri 2 - Desktop app container; Rust backend + native window

**Adapter:**
- `@sveltejs/adapter-static` 3.0.6 - Generates static build for Tauri; `fallback: 'index.html'` for SPA routing

**UI Component Systems:**
- shadcn-svelte 1.2.7 - Pre-built components generated into `src/lib/components/ui/`
- bits-ui 2.17.1 - Headless primitives underlying shadcn-svelte
- paneforge 1.0.2 - Resizable panel layouts

**Build/Dev:**
- Vite 6.0.3 - Frontend build tool; dev server fixed at port 1420
- `@tailwindcss/vite` 4.2.2 - Tailwind CSS 4 via Vite plugin (no PostCSS config needed)

## Key Dependencies

**Frontend — Critical:**
- `@tauri-apps/api` ^2 - IPC bridge; `invoke()` for all Rust command calls
- `@tauri-apps/plugin-fs` ~2 (with `watch` feature) - File system access + directory watching
- `@tauri-apps/plugin-dialog` ~2 - Native file/folder picker dialogs
- `@tauri-apps/plugin-opener` ^2 - Open URLs and files in system default apps
- `@tiptap/core` ^3.22.3 + `@tiptap/starter-kit` + `@tiptap/markdown` + `@tiptap/extension-image` + `@tiptap/suggestion` - Rich text Markdown editor
- `leaflet` 1.9.4 - Interactive map canvas for annotated maps feature
- `svelte-sonner` 1.1.0 - Toast notifications
- `mode-watcher` 1.1.0 - Dark/light mode management

**Frontend — Dev:**
- `@lucide/svelte` ^1.8.0 - Icon set
- `runed` ^0.37.1 - Svelte 5 rune utilities
- `svelte-toolbelt` ^0.10.6 - Additional Svelte utilities
- `@fontsource-variable/nunito-sans` and `@fontsource-variable/playfair-display` - Self-hosted variable fonts
- `tailwind-variants` ^3.2.2 - Variant-based Tailwind class composition
- `tw-animate-css` ^1.4.0 - CSS animation utilities
- `@tailwindcss/typography` ^0.5.19 - Prose styling for Markdown content
- `@internationalized/date` ^3.12.0 - Date handling (bits-ui dependency)

**Rust — Critical:**
- `tauri` 2 (feature: `protocol-asset`) - App framework; asset protocol enables serving local files via `convertFileSrc`
- `diesel` 2.2.0 (features: `sqlite`, `returning_clauses_for_sqlite_3_35`) - SQLite ORM
- `diesel_migrations` 2.2.0 - Embedded migration runner
- `libsqlite3-sys` 0.28 (feature: `bundled`) - Bundles SQLite; no system SQLite dependency required
- `serde` 1 + `serde_json` 1 - Serialization for Tauri command payloads
- `reqwest` 0.12 (feature: `json`) - HTTP client for Spotify API calls
- `chrono` 0.4 (feature: `serde`) - DateTime handling for token expiry
- `sha2` 0.10 - SHA-256 for Spotify PKCE code challenge
- `rand` 0.8 - PKCE verifier and state generation
- `base64` 0.22 - Base64url encoding for PKCE
- `image` 0.25 (features: `png`, `jpeg`, `webp`) - Image metadata extraction (dimensions)
- `dotenvy` 0.15 - `.env` loading for `SPOTIFY_CLIENT_ID`

**Rust — Dev:**
- `tempfile` 3 - Temporary files in tests

## Configuration

**Environment:**
- `src-tauri/.env` file present — contains `SPOTIFY_CLIENT_ID` (required at build/run time)
- Read via `dotenvy::dotenv()` in Spotify commands
- No frontend `.env` files — frontend configuration goes through Tauri IPC

**Build:**
- `vite.config.js` - Vite configuration; port 1420 fixed, HMR on 1421 for remote Tauri
- `svelte.config.js` - SvelteKit with `adapter-static`, `vitePreprocess`
- `tsconfig.json` - TypeScript strict mode, `moduleResolution: bundler`
- `src-tauri/tauri.conf.json` - App identity (`com.lamonta.grimoire`), window size, CSP null, asset protocol scope `**`
- `src-tauri/build.rs` - Tauri build script
- `src-tauri/diesel.toml` - Diesel CLI config; schema at `src/db/schema.rs`, migrations at `migrations/`

## Platform Requirements

**Development:**
- Bun 1.3.11+
- Rust toolchain (rustc 1.92.0 tested)
- `SPOTIFY_CLIENT_ID` in `src-tauri/.env`
- Tauri CLI 2 (`@tauri-apps/cli` in devDependencies)

**Production:**
- Bundled as native desktop app (Windows, macOS, Linux via `bundle.targets: "all"`)
- SQLite is bundled (no system dependency)
- Initial window: 800×600

---

*Stack analysis: 2026-04-28*
