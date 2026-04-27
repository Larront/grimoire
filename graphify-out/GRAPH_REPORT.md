# Graph Report - .  (2026-04-24)

## Corpus Check
- Corpus is ~42,137 words - fits in a single context window. You may not need a graph.

## Summary
- 845 nodes · 1116 edges · 97 communities detected
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 108 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Map & Annotation Backend|Map & Annotation Backend]]
- [[_COMMUNITY_App Shell & Audio Frontend|App Shell & Audio Frontend]]
- [[_COMMUNITY_Media File Utilities|Media File Utilities]]
- [[_COMMUNITY_Dialog & Button UI|Dialog & Button UI]]
- [[_COMMUNITY_Command Palette Components|Command Palette Components]]
- [[_COMMUNITY_Sidebar State Machine|Sidebar State Machine]]
- [[_COMMUNITY_Vault & File Tree|Vault & File Tree]]
- [[_COMMUNITY_Audio Engine & Spotify|Audio Engine & Spotify]]
- [[_COMMUNITY_Sidebar Components|Sidebar Components]]
- [[_COMMUNITY_Inline Rename System|Inline Rename System]]
- [[_COMMUNITY_Map Commands (Rust)|Map Commands (Rust)]]
- [[_COMMUNITY_Database Models|Database Models]]
- [[_COMMUNITY_Svelte Rune Utilities|Svelte Rune Utilities]]
- [[_COMMUNITY_Context Menu|Context Menu]]
- [[_COMMUNITY_Note Commands (Rust)|Note Commands (Rust)]]
- [[_COMMUNITY_Editor Extensions|Editor Extensions]]
- [[_COMMUNITY_Alert Dialog Parts|Alert Dialog Parts]]
- [[_COMMUNITY_Alert Dialog|Alert Dialog]]
- [[_COMMUNITY_Command UI|Command UI]]
- [[_COMMUNITY_Dialog UI|Dialog UI]]
- [[_COMMUNITY_Button & Loading States|Button & Loading States]]
- [[_COMMUNITY_Sheet Drawer|Sheet Drawer]]
- [[_COMMUNITY_Sheet Parts|Sheet Parts]]
- [[_COMMUNITY_Image Block|Image Block]]
- [[_COMMUNITY_Rename UI Parts|Rename UI Parts]]
- [[_COMMUNITY_Recent Vaults|Recent Vaults]]
- [[_COMMUNITY_Vault Lifecycle|Vault Lifecycle]]
- [[_COMMUNITY_Input Group|Input Group]]
- [[_COMMUNITY_Tooltip|Tooltip]]
- [[_COMMUNITY_Pin Appearance|Pin Appearance]]
- [[_COMMUNITY_Tooltip Parts|Tooltip Parts]]
- [[_COMMUNITY_Loading States|Loading States]]
- [[_COMMUNITY_Tabs Components|Tabs Components]]
- [[_COMMUNITY_Tabs Parts|Tabs Parts]]
- [[_COMMUNITY_Collapsible|Collapsible]]
- [[_COMMUNITY_Collapsible Parts|Collapsible Parts]]
- [[_COMMUNITY_Spotify Auth|Spotify Auth]]
- [[_COMMUNITY_Build Config|Build Config]]
- [[_COMMUNITY_Scene Block View|Scene Block View]]
- [[_COMMUNITY_Mobile Detection|Mobile Detection]]
- [[_COMMUNITY_Separator|Separator]]
- [[_COMMUNITY_Vault Portability|Vault Portability]]
- [[_COMMUNITY_Project Identity|Project Identity]]
- [[_COMMUNITY_App Branding|App Branding]]
- [[_COMMUNITY_Slash Command Menu|Slash Command Menu]]
- [[_COMMUNITY_Mini Player Track|Mini Player Track]]
- [[_COMMUNITY_Button Component|Button Component]]
- [[_COMMUNITY_Input Component|Input Component]]
- [[_COMMUNITY_Separator Component|Separator Component]]
- [[_COMMUNITY_Skeleton Component|Skeleton Component]]
- [[_COMMUNITY_Textarea Component|Textarea Component]]
- [[_COMMUNITY_Slash Command Logic|Slash Command Logic]]
- [[_COMMUNITY_Wiki Link Extension|Wiki Link Extension]]
- [[_COMMUNITY_Maps Store|Maps Store]]
- [[_COMMUNITY_Notes Store|Notes Store]]
- [[_COMMUNITY_Scenes Store|Scenes Store]]
- [[_COMMUNITY_Vault Store|Vault Store]]
- [[_COMMUNITY_Tauri Build Script|Tauri Build Script]]
- [[_COMMUNITY_Wiki Link IPC|Wiki Link IPC]]
- [[_COMMUNITY_Svelte Config|Svelte Config]]
- [[_COMMUNITY_Vite Config|Vite Config]]
- [[_COMMUNITY_App Search|App Search]]
- [[_COMMUNITY_App Shell|App Shell]]
- [[_COMMUNITY_Custom Button|Custom Button]]
- [[_COMMUNITY_Editor Component|Editor Component]]
- [[_COMMUNITY_Image Block View|Image Block View]]
- [[_COMMUNITY_Wiki Link Preview|Wiki Link Preview]]
- [[_COMMUNITY_Wiki Link Suggestion|Wiki Link Suggestion]]
- [[_COMMUNITY_Annotation Detail Panel|Annotation Detail Panel]]
- [[_COMMUNITY_Map Canvas|Map Canvas]]
- [[_COMMUNITY_Pin Detail Panel|Pin Detail Panel]]
- [[_COMMUNITY_App Sidebar|App Sidebar]]
- [[_COMMUNITY_File Tree|File Tree]]
- [[_COMMUNITY_Rename Types|Rename Types]]
- [[_COMMUNITY_Sidebar Index|Sidebar Index]]
- [[_COMMUNITY_Spinner|Spinner]]
- [[_COMMUNITY_Scene Block|Scene Block]]
- [[_COMMUNITY_Breadcrumbs Store|Breadcrumbs Store]]
- [[_COMMUNITY_Spotify Types|Spotify Types]]
- [[_COMMUNITY_Vault Types|Vault Types]]
- [[_COMMUNITY_Root Layout|Root Layout]]
- [[_COMMUNITY_Layout Config|Layout Config]]
- [[_COMMUNITY_Home Page|Home Page]]
- [[_COMMUNITY_Map Page|Map Page]]
- [[_COMMUNITY_Note Page|Note Page]]
- [[_COMMUNITY_Scene List Page|Scene List Page]]
- [[_COMMUNITY_Scene Detail Page|Scene Detail Page]]
- [[_COMMUNITY_Settings Page|Settings Page]]
- [[_COMMUNITY_Commands Module|Commands Module]]
- [[_COMMUNITY_DB Schema|DB Schema]]
- [[_COMMUNITY_Rename Types (UI)|Rename Types (UI)]]
- [[_COMMUNITY_Mobile Hook|Mobile Hook]]
- [[_COMMUNITY_Tauri Build|Tauri Build]]
- [[_COMMUNITY_Spotify Token|Spotify Token]]
- [[_COMMUNITY_Svelte Logo|Svelte Logo]]
- [[_COMMUNITY_Tauri Logo|Tauri Logo]]
- [[_COMMUNITY_Vite Logo|Vite Logo]]

## God Nodes (most connected - your core abstractions)
1. `Tauri App Entry Point (run)` - 60 edges
2. `Sidebar Index (Public API)` - 20 edges
3. `Map` - 19 edges
4. `lib/utils (cn, type helpers)` - 16 edges
5. `cn Utility (lib/utils)` - 16 edges
6. `vault.ts (shared types)` - 15 edges
7. `Map Detail Route` - 13 edges
8. `notes.svelte.ts store` - 12 edges
9. `scenes.svelte.ts store` - 12 edges
10. `audio-engine.svelte.ts store` - 12 edges

## Surprising Connections (you probably didn't know these)
- `DB Model: SpotifyAuth (no Serialize)` --conceptually_related_to--> `Spotify Premium Required for Integration`  [INFERRED]
  src-tauri/src/db/models.rs → README.md
- `search_notes()` --calls--> `Map`  [INFERRED]
  src-tauri\src\commands\notes.rs → src-tauri\src\db\models.rs
- `get_vault_path()` --calls--> `Map`  [INFERRED]
  src-tauri\src\commands\vault.rs → src-tauri\src\db\models.rs
- `Tauri Command: update_note` --conceptually_related_to--> `Markdown Notes (raw .md files, not proprietary)`  [INFERRED]
  src-tauri/src/commands/notes.rs → README.md
- `RecentVault Struct` --conceptually_related_to--> `Local-First Vault Concept`  [INFERRED]
  src-tauri/src/commands/recent_vaults.rs → README.md

## Hyperedges (group relationships)
- **Audio Playback Control Surface (MiniPlayer + SceneBlockView + AudioEngine)** — sidebar_miniplayer, editor_sceneblockview, store_audioengine [INFERRED 0.88]
- **Map Annotation System (MapCanvas + AnnotationDetailPanel + types)** — map_mapcanvas, map_annotationdetailpanel, types_vault [INFERRED 0.90]
- **Editor Extension Pipeline (Editor + TipTap extensions + overlay menus)** — editor_editor, editor_slashcommandmenu, editor_wikilinksuggestion [EXTRACTED 1.00]
- **AlertDialog shadcn-svelte wrapper pattern over bits-ui** — alertdialog_root, alertdialog_content, alertdialog_cancel, alertdialog_trigger, alertdialog_overlay, alertdialog_portal [EXTRACTED 1.00]
- **Collapsible shadcn-svelte wrapper pattern over bits-ui** — collapsible_root, collapsible_trigger, collapsible_content [EXTRACTED 1.00]
- **CommandDialog composes Dialog + Command primitives** — command_dialog, dialog_component, command_svelte [EXTRACTED 1.00]
- **shadcn-svelte wraps bits-ui Command primitives with Tailwind styling** — command_svelte, bits_ui_command_primitive, lib_utils_cn [EXTRACTED 1.00]
- **shadcn-svelte wraps bits-ui ContextMenu primitives with Tailwind styling** — context_menu_item_svelte, bits_ui_context_menu_primitive, lib_utils_cn [EXTRACTED 1.00]
- **CheckIcon used as selection indicator in both Command Item and ContextMenu checkbox/radio items** — command_item_svelte, context_menu_checkbox_item_svelte, context_menu_radio_item_svelte [INFERRED 0.85]
- **Dialog Compound Component Pattern (bits-ui primitives + shadcn wrappers)** — dialog_root, dialog_content, dialog_portal, dialog_overlay, dialog_trigger, dialog_close, dialog_title, dialog_description, dialog_header, dialog_footer [EXTRACTED 1.00]
- **InputGroup Compound Component Pattern** — inputgroup_root, inputgroup_addon, inputgroup_button, inputgroup_input, inputgroup_text, inputgroup_textarea [EXTRACTED 1.00]
- **shadcn-svelte wraps bits-ui primitives pattern (ContextMenu, Dialog, Input)** — contextmenu_root, dialog_root, input_component [INFERRED 0.90]
- **Rename Compound Component Pattern** — rename_renameprovidersvelte, rename_renamesvelte, rename_renamecancelsvelte, rename_renamesavesvelte [EXTRACTED 1.00]
- **Rename State Machine (Provider/Input/Edit/Cancel/Save)** — rename_renameproviderstate, rename_renameinputstate, rename_contextapi [EXTRACTED 1.00]
- **Sheet as bits-ui Dialog Wrapper** — sheet_sheetsvelte, sheet_sheetcontentsvelte, ext_bitsui_dialog [EXTRACTED 1.00]
- **Sidebar Context/Provider State Pattern** — context_set_sidebar, context_use_sidebar, provider_sidebar_provider [EXTRACTED 1.00]
- **Sidebar Menu Item Composition Pattern** — menuitem_sidebar_menu_item, menubutton_sidebar_menu_button, menuaction_sidebar_menu_action [INFERRED 0.85]
- **Sidebar Group Composition Pattern** — group_sidebar_group, grouplabel_sidebar_group_label, groupcontent_sidebar_group_content [INFERRED 0.85]
- **Sidebar Toggle Control Pattern** — sidebarrail_sidebarrail, sidebartrigger_sidebartrigger, sidebar_context [INFERRED 0.88]
- **Tabs Component Composition (Root/List/Trigger/Content)** — tabs_tabs, tabs_list, tabs_trigger, tabs_content [EXTRACTED 1.00]
- **Loading State UI Components (Skeleton + Spinner)** — skeleton_skeleton, spinner_spinner, pattern_loadingstate [INFERRED 0.88]
- **Vault isOpen triggers notes, scenes, maps, and audioEngine stores to reload or clear** — store_vault, store_notes, store_scenes, store_maps [EXTRACTED 1.00]
- **AudioEngine orchestrates LocalPlayer and SpotifyPlayer with crossfade state machine** — store_audioengine, class_localplayer, class_spotifyplayer [EXTRACTED 1.00]
- **Scene detail route consumes scenesStore, audioEngine, and breadcrumbs for full playback UI** — route_scene_id, store_scenes, store_audioengine [EXTRACTED 1.00]
- **VaultState Mutex Guard Pattern (lock â†’ get connection â†’ operate)** — vaultrs_appvault, vaultrs_vaultstate, db_mod_establish_connection [EXTRACTED 1.00]
- **Spotify PKCE OAuth Flow (start_auth â†’ exchange_code â†’ persist_auth â†’ get_access_token)** — cmd_spotify_start_auth_flow, cmd_spotify_exchange_code, cmd_spotify_get_access_token [EXTRACTED 1.00]
- **Map Domain Entities (Map, Pin, MapAnnotation, PinCategory)** — db_models_map, db_models_pin, db_models_map_annotation [EXTRACTED 1.00]

## Communities

### Community 0 - "Map & Annotation Backend"
Cohesion: 0.03
Nodes (97): Tauri Command: assign_map_image, Tauri Command: create_annotation, Tauri Command: create_map, Tauri Command: create_map_empty, Tauri Command: create_pin, Tauri Command: create_pin_category, Tauri Command: delete_annotation, Tauri Command: delete_map (+89 more)

### Community 1 - "App Shell & Audio Frontend"
Cohesion: 0.04
Nodes (69): LocalPlayer (Web Audio), SpotifyPlayer (SDK Wrapper), Rust media commands (copy_image_file, save_image_bytes), Editor.svelte (TipTap wrapper), image-block.ts (TipTap extension), scene-block.svelte.ts (TipTap extension), slash-command.ts (TipTap extension), wiki-link.ts (TipTap extension) (+61 more)

### Community 2 - "Media File Utilities"
Cohesion: 0.06
Nodes (38): copy_image_file(), get_image_absolute_path(), resolve_image_filename(), save_image_bytes(), test_multiple_conflicts(), test_no_conflict(), test_one_conflict(), validate_image_extension() (+30 more)

### Community 3 - "Dialog & Button UI"
Cohesion: 0.09
Nodes (41): bits-ui ContextMenu Primitive, bits-ui Dialog Primitive, Button Component, Button Index (barrel), buttonVariants (tailwind-variants), ContextMenu Index (Public API), ContextMenu Root, ContextMenu Trigger (+33 more)

### Community 4 - "Command Palette Components"
Cohesion: 0.09
Nodes (37): bits-ui Command Primitive, bits-ui Command Primitive, bits-ui ContextMenu Primitive, bits-ui Dialog Primitive, Command Dialog, Command Empty, Command Group, Command UI Barrel Export (+29 more)

### Community 5 - "Sidebar State Machine"
Cohesion: 0.06
Nodes (4): setSidebar(), SidebarState, useSidebar(), for()

### Community 6 - "Vault & File Tree"
Cohesion: 0.14
Nodes (33): build_file_tree(), create_folder(), create_folder_creates_directory(), create_folder_inner(), create_folder_is_idempotent(), delete_folder(), delete_folder_inner(), delete_folder_only_removes_notes_with_matching_prefix() (+25 more)

### Community 7 - "Audio Engine & Spotify"
Cohesion: 0.09
Nodes (6): loadSpotifySdk(), LocalPlayer, SpotifyPlayer, handleMasterVolumeInput(), handleStop(), toggleMasterMute()

### Community 8 - "Sidebar Components"
Cohesion: 0.11
Nodes (28): Sidebar Constants, Sidebar Content Component, IsMobile Hook, setSidebar Context Function, SidebarState Class, useSidebar Context Hook, Sidebar Footer Component, Sidebar Group Component (+20 more)

### Community 9 - "Inline Rename System"
Cohesion: 0.1
Nodes (5): RenameCancelState, RenameEditState, RenameInputState, RenameProviderState, RenameSaveState

### Community 10 - "Map Commands (Rust)"
Cohesion: 0.1
Nodes (7): assign_map_image(), create_map(), get_map_image_data_url(), multiple_conflicts_increments_correctly(), no_conflict_returns_original_name(), one_conflict_appends_counter(), resolve_map_filename()

### Community 11 - "Database Models"
Cohesion: 0.1
Nodes (20): AssignImageChangeset, MapAnnotation, NewMap, NewMapAnnotation, NewNote, NewPin, NewPinCategory, NewScene (+12 more)

### Community 12 - "Svelte Rune Utilities"
Cohesion: 0.17
Nodes (19): runed Context API, svelte-toolbelt box utility, InputGroup Component, Rename Context (runed Context), Rename UI Module Index, RenameCancelState Class, Rename Cancel Button, RenameEditState Class (+11 more)

### Community 13 - "Context Menu"
Cohesion: 0.12
Nodes (0): 

### Community 14 - "Note Commands (Rust)"
Cohesion: 0.17
Nodes (8): create_note(), NotePathResult, NoteSearchResult, resolve_note_filename(), search_notes(), test_multiple_conflicts(), test_no_conflict(), test_one_conflict()

### Community 15 - "Editor Extensions"
Cohesion: 0.13
Nodes (15): SceneBlockView Svelte Component, SceneBlock TipTap Node Extension, SlashCommand TipTap Extension, IPC: assign_map_image, IPC: create_annotation, IPC: create_pin, IPC: delete_annotation, IPC: get_annotations (+7 more)

### Community 16 - "Alert Dialog Parts"
Cohesion: 0.15
Nodes (0): 

### Community 17 - "Alert Dialog"
Cohesion: 0.32
Nodes (13): AlertDialog Cancel, AlertDialog Content, AlertDialog Description, AlertDialog Footer, AlertDialog Header, AlertDialog Index (barrel), AlertDialog Media, AlertDialog Overlay (+5 more)

### Community 18 - "Command UI"
Cohesion: 0.17
Nodes (0): 

### Community 19 - "Dialog UI"
Cohesion: 0.17
Nodes (0): 

### Community 20 - "Button & Loading States"
Cohesion: 0.18
Nodes (9): button.svelte (loading wrapper), alert-dialog-action.svelte (shadcn), ui/button (shadcn primitive), ui/spinner component, cn(), parseFrontmatter(), parseFrontmatter(), parseTagsBlock() (+1 more)

### Community 21 - "Sheet Drawer"
Cohesion: 0.32
Nodes (12): bits-ui Dialog Primitive, Sheet UI Module Index, Sheet Close Component, Sheet Content Component, Sheet Description Component, Sheet Footer Component, Sheet Header Component, Sheet Overlay Component (+4 more)

### Community 22 - "Sheet Parts"
Cohesion: 0.22
Nodes (0): 

### Community 23 - "Image Block"
Cohesion: 0.24
Nodes (5): insertImageFromFile(), insertImageFromHandle(), mimeToExt(), run(), main()

### Community 24 - "Rename UI Parts"
Cohesion: 0.22
Nodes (0): 

### Community 25 - "Recent Vaults"
Cohesion: 0.44
Nodes (8): add_recent_vault(), get_recent_vaults(), read_recent_vaults_file(), recent_vaults_path(), RecentVault, RecentVaultsFile, remove_recent_vault(), write_recent_vaults_file()

### Community 26 - "Vault Lifecycle"
Cohesion: 0.29
Nodes (5): establish_connection(), get_vault_path(), open_vault(), OpenVaultResult, seed_default_categories()

### Community 27 - "Input Group"
Cohesion: 0.29
Nodes (0): 

### Community 28 - "Tooltip"
Cohesion: 0.57
Nodes (7): bits-ui Tooltip Primitive, Tooltip Content, Tooltip Index, Tooltip Portal, Tooltip Provider, Tooltip Root, Tooltip Trigger

### Community 29 - "Pin Appearance"
Cohesion: 0.47
Nodes (3): buildDivIcon(), outline(), safeColor()

### Community 30 - "Tooltip Parts"
Cohesion: 0.33
Nodes (0): 

### Community 31 - "Loading States"
Cohesion: 0.33
Nodes (6): Lucide Loader2 Icon, Loading State UI Pattern (Skeleton + Spinner), Skeleton Index, Skeleton Component, Spinner Index, Spinner Component

### Community 32 - "Tabs Components"
Cohesion: 0.53
Nodes (6): bits-ui Tabs Primitive, Tabs Content, Tabs Index, Tabs List, Tabs Root, Tabs Trigger

### Community 33 - "Tabs Parts"
Cohesion: 0.4
Nodes (0): 

### Community 34 - "Collapsible"
Cohesion: 0.6
Nodes (5): bits-ui Collapsible Primitive, Collapsible Content, Collapsible Index (barrel), Collapsible Root, Collapsible Trigger

### Community 35 - "Collapsible Parts"
Cohesion: 0.5
Nodes (0): 

### Community 36 - "Spotify Auth"
Cohesion: 0.5
Nodes (0): 

### Community 37 - "Build Config"
Cohesion: 0.5
Nodes (2): SvelteKit adapter-static (SPA mode), Tailwind CSS Vite plugin

### Community 38 - "Scene Block View"
Cohesion: 0.67
Nodes (0): 

### Community 39 - "Mobile Detection"
Cohesion: 0.67
Nodes (1): IsMobile

### Community 40 - "Separator"
Cohesion: 0.67
Nodes (3): bits-ui Separator Primitive, Separator UI Module Index, Separator Component

### Community 41 - "Vault Portability"
Cohesion: 0.67
Nodes (3): RecentVault Struct, Local-First Vault Concept, Portable Campaign (relative paths)

### Community 42 - "Project Identity"
Cohesion: 0.67
Nodes (3): SvelteKit HTML Shell (app.html), Arcane Clarity UI Design Principle, Grimoire Project (README)

### Community 43 - "App Branding"
Cohesion: 0.67
Nodes (3): Application Branding Asset, Svelte Framework Logo, Grimoire App Favicon

### Community 44 - "Slash Command Menu"
Cohesion: 1.0
Nodes (0): 

### Community 45 - "Mini Player Track"
Cohesion: 1.0
Nodes (0): 

### Community 46 - "Button Component"
Cohesion: 1.0
Nodes (0): 

### Community 47 - "Input Component"
Cohesion: 1.0
Nodes (0): 

### Community 48 - "Separator Component"
Cohesion: 1.0
Nodes (0): 

### Community 49 - "Skeleton Component"
Cohesion: 1.0
Nodes (0): 

### Community 50 - "Textarea Component"
Cohesion: 1.0
Nodes (0): 

### Community 51 - "Slash Command Logic"
Cohesion: 1.0
Nodes (0): 

### Community 52 - "Wiki Link Extension"
Cohesion: 1.0
Nodes (0): 

### Community 53 - "Maps Store"
Cohesion: 1.0
Nodes (0): 

### Community 54 - "Notes Store"
Cohesion: 1.0
Nodes (0): 

### Community 55 - "Scenes Store"
Cohesion: 1.0
Nodes (0): 

### Community 56 - "Vault Store"
Cohesion: 1.0
Nodes (0): 

### Community 57 - "Tauri Build Script"
Cohesion: 1.0
Nodes (0): 

### Community 58 - "Wiki Link IPC"
Cohesion: 1.0
Nodes (2): WikiLink TipTap Node Extension, IPC: search_notes

### Community 59 - "Svelte Config"
Cohesion: 1.0
Nodes (0): 

### Community 60 - "Vite Config"
Cohesion: 1.0
Nodes (0): 

### Community 61 - "App Search"
Cohesion: 1.0
Nodes (0): 

### Community 62 - "App Shell"
Cohesion: 1.0
Nodes (0): 

### Community 63 - "Custom Button"
Cohesion: 1.0
Nodes (0): 

### Community 64 - "Editor Component"
Cohesion: 1.0
Nodes (0): 

### Community 65 - "Image Block View"
Cohesion: 1.0
Nodes (0): 

### Community 66 - "Wiki Link Preview"
Cohesion: 1.0
Nodes (0): 

### Community 67 - "Wiki Link Suggestion"
Cohesion: 1.0
Nodes (0): 

### Community 68 - "Annotation Detail Panel"
Cohesion: 1.0
Nodes (0): 

### Community 69 - "Map Canvas"
Cohesion: 1.0
Nodes (0): 

### Community 70 - "Pin Detail Panel"
Cohesion: 1.0
Nodes (0): 

### Community 71 - "App Sidebar"
Cohesion: 1.0
Nodes (0): 

### Community 72 - "File Tree"
Cohesion: 1.0
Nodes (0): 

### Community 73 - "Rename Types"
Cohesion: 1.0
Nodes (0): 

### Community 74 - "Sidebar Index"
Cohesion: 1.0
Nodes (0): 

### Community 75 - "Spinner"
Cohesion: 1.0
Nodes (0): 

### Community 76 - "Scene Block"
Cohesion: 1.0
Nodes (0): 

### Community 77 - "Breadcrumbs Store"
Cohesion: 1.0
Nodes (0): 

### Community 78 - "Spotify Types"
Cohesion: 1.0
Nodes (0): 

### Community 79 - "Vault Types"
Cohesion: 1.0
Nodes (0): 

### Community 80 - "Root Layout"
Cohesion: 1.0
Nodes (0): 

### Community 81 - "Layout Config"
Cohesion: 1.0
Nodes (0): 

### Community 82 - "Home Page"
Cohesion: 1.0
Nodes (0): 

### Community 83 - "Map Page"
Cohesion: 1.0
Nodes (0): 

### Community 84 - "Note Page"
Cohesion: 1.0
Nodes (0): 

### Community 85 - "Scene List Page"
Cohesion: 1.0
Nodes (0): 

### Community 86 - "Scene Detail Page"
Cohesion: 1.0
Nodes (0): 

### Community 87 - "Settings Page"
Cohesion: 1.0
Nodes (0): 

### Community 88 - "Commands Module"
Cohesion: 1.0
Nodes (0): 

### Community 89 - "DB Schema"
Cohesion: 1.0
Nodes (0): 

### Community 90 - "Rename Types (UI)"
Cohesion: 1.0
Nodes (1): Rename Types

### Community 91 - "Mobile Hook"
Cohesion: 1.0
Nodes (1): IsMobile Media Query Hook

### Community 92 - "Tauri Build"
Cohesion: 1.0
Nodes (1): Tauri Build Script

### Community 93 - "Spotify Token"
Cohesion: 1.0
Nodes (1): Spotify TokenResponse Struct (internal)

### Community 94 - "Svelte Logo"
Cohesion: 1.0
Nodes (1): Svelte Logo SVG Asset

### Community 95 - "Tauri Logo"
Cohesion: 1.0
Nodes (1): Tauri Logo SVG Asset

### Community 96 - "Vite Logo"
Cohesion: 1.0
Nodes (1): Vite Logo SVG Asset

## Ambiguous Edges - Review These
- `SlashCommand TipTap Extension` → `IPC: update_pin`  [AMBIGUOUS]
  src/lib/editor/slash-command.ts · relation: conceptually_related_to

## Knowledge Gaps
- **164 isolated node(s):** `NoteSearchResult`, `NotePathResult`, `RecentVault`, `RecentVaultsFile`, `TokenResponse` (+159 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Slash Command Menu`** (2 nodes): `i()`, `SlashCommandMenu.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Mini Player Track`** (2 nodes): `if()`, `MiniPlayerTrack.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Button Component`** (2 nodes): `button.svelte`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Input Component`** (2 nodes): `index.ts`, `input.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Separator Component`** (2 nodes): `index.ts`, `separator.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Skeleton Component`** (2 nodes): `index.ts`, `skeleton.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Textarea Component`** (2 nodes): `index.ts`, `textarea.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Slash Command Logic`** (2 nodes): `filterCommands()`, `slash-command.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Wiki Link Extension`** (2 nodes): `wiki-link.ts`, `preprocessWikiLinks()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Maps Store`** (2 nodes): `createMapsStore()`, `maps.svelte.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Notes Store`** (2 nodes): `createNotesStore()`, `notes.svelte.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Scenes Store`** (2 nodes): `createScenesStore()`, `scenes.svelte.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Vault Store`** (2 nodes): `vault.svelte.ts`, `createVaultStore()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Tauri Build Script`** (2 nodes): `main()`, `build.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Wiki Link IPC`** (2 nodes): `WikiLink TipTap Node Extension`, `IPC: search_notes`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Svelte Config`** (1 nodes): `svelte.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Vite Config`** (1 nodes): `vite.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `App Search`** (1 nodes): `AppSearch.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `App Shell`** (1 nodes): `AppShell.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Custom Button`** (1 nodes): `button.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Editor Component`** (1 nodes): `Editor.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Image Block View`** (1 nodes): `ImageBlockView.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Wiki Link Preview`** (1 nodes): `WikiLinkPreview.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Wiki Link Suggestion`** (1 nodes): `WikiLinkSuggestion.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Annotation Detail Panel`** (1 nodes): `AnnotationDetailPanel.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Map Canvas`** (1 nodes): `MapCanvas.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Pin Detail Panel`** (1 nodes): `PinDetailPanel.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `App Sidebar`** (1 nodes): `AppSidebar.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `File Tree`** (1 nodes): `FileTree.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Rename Types`** (1 nodes): `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Sidebar Index`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Spinner`** (1 nodes): `spinner.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Scene Block`** (1 nodes): `scene-block.svelte.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Breadcrumbs Store`** (1 nodes): `breadcrumbs.svelte.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Spotify Types`** (1 nodes): `spotify.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Vault Types`** (1 nodes): `vault.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Root Layout`** (1 nodes): `+layout.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Layout Config`** (1 nodes): `+layout.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Home Page`** (1 nodes): `+page.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Map Page`** (1 nodes): `+page.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Note Page`** (1 nodes): `+page.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Scene List Page`** (1 nodes): `+page.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Scene Detail Page`** (1 nodes): `+page.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Settings Page`** (1 nodes): `+page.svelte`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Commands Module`** (1 nodes): `mod.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `DB Schema`** (1 nodes): `schema.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Rename Types (UI)`** (1 nodes): `Rename Types`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Mobile Hook`** (1 nodes): `IsMobile Media Query Hook`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Tauri Build`** (1 nodes): `Tauri Build Script`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Spotify Token`** (1 nodes): `Spotify TokenResponse Struct (internal)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Svelte Logo`** (1 nodes): `Svelte Logo SVG Asset`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Tauri Logo`** (1 nodes): `Tauri Logo SVG Asset`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Vite Logo`** (1 nodes): `Vite Logo SVG Asset`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `SlashCommand TipTap Extension` and `IPC: update_pin`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Map` connect `Media File Utilities` to `Vault & File Tree`, `Database Models`, `Note Commands (Rust)`, `Button & Loading States`, `Vault Lifecycle`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Why does `Editor.svelte (TipTap wrapper)` connect `App Shell & Audio Frontend` to `Button & Loading States`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Are the 18 inferred relationships involving `Map` (e.g. with `parseTagsBlock()` and `validate_image_extension()`) actually correct?**
  _`Map` has 18 INFERRED edges - model-reasoned connections that need verification._
- **What connects `NoteSearchResult`, `NotePathResult`, `RecentVault` to the rest of the system?**
  _164 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Map & Annotation Backend` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._
- **Should `App Shell & Audio Frontend` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._