---
title: Directory Structure
focus: arch
date: 2026-04-28
---

# Directory Structure

## Top-Level Layout

```
grimoire/
├── src/                          # SvelteKit frontend
├── src-tauri/                    # Rust/Tauri backend
├── graphify-out/                 # Knowledge graph output (generated)
├── .planning/                    # GSD planning docs
├── package.json                  # Node deps (bun)
├── vite.config.ts                # Vite config (port 1420)
├── svelte.config.js              # SvelteKit config (adapter-static)
└── tsconfig.json
```

## Frontend (`src/`)

```
src/
├── app.html                      # HTML shell (SPA entry)
├── app.css                       # Tailwind CSS 4 config (CSS-first, no tailwind.config.ts)
├── lib/
│   ├── components/
│   │   ├── AppShell.svelte       # Root layout: sidebar + main content
│   │   ├── AppSearch.svelte      # Global command palette / search
│   │   ├── button.svelte         # One-off button (not in ui/)
│   │   ├── editor/               # TipTap editor components
│   │   │   ├── Editor.svelte     # Main TipTap wrapper
│   │   │   ├── ImageBlockView.svelte
│   │   │   ├── SceneBlockView.svelte
│   │   │   ├── SlashCommandMenu.svelte
│   │   │   ├── WikiLinkPreview.svelte
│   │   │   └── WikiLinkSuggestion.svelte
│   │   ├── map/                  # Map feature components
│   │   │   ├── MapCanvas.svelte  # Leaflet map + pins + annotations
│   │   │   ├── PinDetailPanel.svelte
│   │   │   ├── AnnotationDetailPanel.svelte
│   │   │   └── pinAppearance.ts  # Pin icon/color helpers
│   │   ├── sidebar/              # App sidebar
│   │   │   ├── AppSidebar.svelte
│   │   │   ├── FileTree.svelte   # Recursive note tree with context menu
│   │   │   ├── MiniPlayer.svelte
│   │   │   ├── MiniPlayerTrack.svelte
│   │   │   └── MiniPlayerVisualizer.svelte
│   │   └── ui/                   # shadcn-svelte generated — DO NOT hand-edit
│   │       ├── alert-dialog/
│   │       ├── button/
│   │       ├── collapsible/
│   │       ├── command/
│   │       ├── context-menu/
│   │       ├── dialog/
│   │       ├── input/
│   │       ├── input-group/
│   │       ├── rename/           # Custom component for inline rename UX
│   │       ├── separator/
│   │       ├── sheet/
│   │       ├── sidebar/
│   │       ├── skeleton/
│   │       ├── spinner/
│   │       ├── tabs/
│   │       ├── textarea/
│   │       └── tooltip/
│   ├── editor/                   # TipTap extension modules (not components)
│   │   ├── image-block.ts        # Image node extension
│   │   ├── scene-block.svelte.ts # Scene embed node (Svelte 5 NodeView)
│   │   ├── slash-command.ts      # "/" command extension
│   │   └── wiki-link.ts          # [[wikilink]] extension
│   ├── hooks/
│   │   └── is-mobile.svelte.ts   # Mobile breakpoint reactive hook
│   ├── stores/                   # All application state (rune singletons)
│   │   ├── vault.svelte.ts       # Open vault path, open/close lifecycle
│   │   ├── notes.svelte.ts       # Note list + content cache
│   │   ├── scenes.svelte.ts      # Scenes + slot cache
│   │   ├── maps.svelte.ts        # Maps list
│   │   ├── audio-engine.svelte.ts# Audio playback state machine
│   │   └── breadcrumbs.svelte.ts # Navigation breadcrumb state
│   ├── types/
│   │   ├── vault.ts              # Shared domain types (Note, Scene, SceneSlot, Map, Pin, etc.)
│   │   └── spotify.d.ts          # Spotify Web Playback SDK types
│   ├── utils.ts                  # General utilities (cn(), etc.)
│   └── utils/
│       └── spotify-auth.ts       # Spotify OAuth PKCE helpers
└── routes/
    ├── +layout.svelte            # Root layout (mounts AppShell or splash)
    ├── +layout.ts                # SPA prerender config
    ├── +page.svelte              # Home: vault splash or dashboard
    ├── map/[id]/+page.svelte     # Map viewer
    ├── note/[id]/+page.svelte    # Note editor
    ├── scene/+page.svelte        # All scenes grid
    ├── scene/[id]/+page.svelte   # Scene detail (audio slots)
    └── settings/+page.svelte     # App settings
```

## Backend (`src-tauri/`)

```
src-tauri/
├── Cargo.toml                    # Rust deps: tauri 2, diesel 2.2, reqwest, etc.
├── tauri.conf.json               # Tauri config (bundle, permissions, dev URL)
├── build.rs                      # Tauri build script
├── migrations/                   # Diesel migrations (run at vault open)
│   ├── 2026-03-16-021255-0000_create_notes/
│   ├── 2026-03-17-043635-0000_create_maps/
│   ├── 2026-03-17-043635-0001_create_pin_categories/
│   ├── 2026-03-17-043635-0002_create_pins/
│   ├── 2026-03-18-000000-0000_create_scenes/
│   ├── 2026-03-18-000000-0001_create_scene_slots/
│   ├── 2026-03-18-000000-0002_create_spotify_auth/
│   ├── 2026-03-20-000000-0000_add_shuffle_to_scene_slots/
│   ├── 2026-03-22-210050-0000_add_favorited_to_scenes/
│   ├── 2026-03-27-000000-0000_add_shape_to_pin_categories/
│   ├── 2026-03-27-000000-0001_add_appearance_to_pins/
│   ├── 2026-04-17-000000-0000_make_map_image_nullable/
│   ├── 2026-04-17-000001-0000_repair_pin_fk_references/
│   └── 2026-04-22-000000-0000_create_map_annotations/
└── src/
    ├── main.rs                   # Binary entry point → lib::run()
    ├── lib.rs                    # Tauri builder: plugins + all invoke_handler registrations
    ├── vault.rs                  # VaultState + AppVault types
    ├── commands/
    │   ├── mod.rs                # Re-exports all command modules
    │   ├── vault.rs              # open_vault, get_vault_path
    │   ├── recent_vaults.rs      # get/add/remove recent vaults (JSON sidecar)
    │   ├── notes.rs              # create/read/update/delete notes + search
    │   ├── tree.rs               # get_file_tree, create/delete/rename folder
    │   ├── maps.rs               # Maps, pins, pin categories, annotations, image data URL
    │   ├── scenes.rs             # Scenes, scene slots, reorder, toggle favorite
    │   ├── media.rs              # copy_audio_file, copy_image_file, save_image_bytes, get paths
    │   └── spotify.rs            # OAuth flow, token exchange/refresh/revoke
    └── db/
        ├── mod.rs                # establish_connection() helper
        ├── models.rs             # Diesel insertable/queryable structs
        └── schema.rs             # Auto-generated by Diesel CLI — DO NOT hand-edit
```

## Vault Data Layout (Runtime)

```
<vault-root>/
├── *.md                          # Note files (created by notes.rs)
├── <subfolder>/
│   └── *.md
└── .grimoire/
    ├── grimoire.db               # SQLite database
    └── media/
        ├── audio/                # Copied audio files (local slots)
        └── images/               # Copied map images
```

## Key File Locations

| What | Where |
|------|-------|
| Add a new Tauri command | `src-tauri/src/commands/<domain>.rs` + register in `lib.rs` |
| Add a new DB table | New migration in `src-tauri/migrations/` |
| Add a new store | `src/lib/stores/<name>.svelte.ts` |
| Add a new route | `src/routes/<path>/+page.svelte` |
| Add a shadcn component | Run `bunx shadcn-svelte add <component>` — outputs to `src/lib/components/ui/` |
| Shared domain types | `src/lib/types/vault.ts` |
| CSS custom properties / theming | `src/app.css` |

## Naming Conventions

| Pattern | Convention |
|---------|-----------|
| Svelte components | `PascalCase.svelte` |
| Rune stores | `camelCase.svelte.ts` (module singleton) |
| TipTap extensions | `kebab-case.ts` or `kebab-case.svelte.ts` |
| Rust command functions | `snake_case` (maps to `invoke("snake_case")`) |
| Rust files | `snake_case.rs` |
| shadcn components | `kebab-case.svelte` (generated) |
| Route params | `[id]` (numeric string, parsed on page) |
