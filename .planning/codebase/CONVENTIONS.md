---
title: Conventions
focus: quality
date: 2026-04-28
---

# Conventions

Coding patterns, naming conventions, and idioms used throughout the Grimoire codebase.

---

## Svelte 5 — Runes Only

All reactive state uses Svelte 5 runes. No Svelte 4 `writable`/`readable`/`derived` store primitives exist in the codebase.

```typescript
// stores/notes.svelte.ts
function createNotesStore() {
  let notes = $state<Note[]>([]);
  let isLoading = $state(false);

  const noteCount = $derived(notes.length);

  $effect(() => {
    if (vault.isOpen) loadNotes();
  });

  return {
    get notes() { return notes; },
    get isLoading() { return isLoading; },
    get noteCount() { return noteCount; },
  };
}
export const notes = createNotesStore();
```

**Rules:**
- `$state` for mutable values; `$derived` for computed values; `$effect` for side effects.
- Stores are factory functions exported as module-level singletons — not classes, not plain objects.
- Reactive getters (`get foo() { return foo; }`) expose private `$state` variables — do not return the state variable directly in the returned object.

---

## TypeScript

- Strict mode is on (`tsconfig.json`).
- Domain types live in `src/lib/types/vault.ts` — add new shared interfaces there, not in component files.
- `invoke<T>()` is always typed with its return type: `invoke<Note[]>("get_notes", { ... })`.
- Error handling in stores: `try/catch` with `error = String(e)` pattern; errors surfaced via store state, not thrown.

```typescript
try {
  const result = await invoke<Note>("create_note", { title });
  notes = [...notes, result];
} catch (e) {
  error = String(e);
}
```

---

## Tauri IPC

- All cross-boundary calls use `invoke()` from `@tauri-apps/api/core`.
- Fire-and-forget calls (e.g. `add_recent_vault`) use `.catch(console.error)` — never silently swallowed.
- Large assets (audio, images) are served via `convertFileSrc()` + the `asset://` protocol — never transferred as bytes through `invoke()`.

```typescript
// Correct: asset protocol for file serving
const absolutePath = await invoke<string>("get_audio_absolute_path", { relativePath });
const assetUrl = convertFileSrc(absolutePath);

// Avoid: base64 over IPC for large files (used in map images, should be migrated)
const dataUrl = await invoke<string>("get_map_image_data_url", { mapId });
```

---

## Component Patterns

**shadcn-svelte components** (`src/lib/components/ui/`) are generated — import from their `index.ts`, never edit the component files.

```typescript
import { Button } from "$lib/components/ui/button";
import { Dialog, DialogContent } from "$lib/components/ui/dialog";
```

**Feature components** import stores directly (singletons are safe to import anywhere):

```svelte
<script lang="ts">
  import { notes } from "$lib/stores/notes.svelte";
  import { vault } from "$lib/stores/vault.svelte";
</script>
```

**Props** use Svelte 5 `$props()` syntax:

```svelte
<script lang="ts">
  let { mapId, onPinClick }: { mapId: number; onPinClick: (pin: Pin) => void } = $props();
</script>
```

---

## Styling

- Tailwind CSS 4 with CSS-first config in `src/app.css` — no `tailwind.config.ts`.
- CSS custom properties (design tokens) are defined in `app.css` and referenced with `var(--name)`.
- `cn()` utility (re-exported from `$lib/utils`) merges Tailwind classes: `cn("base-class", conditional && "extra-class")`.
- Dark mode is the primary/canonical experience — design in dark first.
- Typography: `Metamorphous` for headings (arcane character), `Nunito Sans` for body.

---

## Rust Conventions

**Command handler shape** — every command acquires `VaultState` and guards against uninitialized vault:

```rust
#[tauri::command]
pub fn get_notes(state: tauri::State<AppVault>) -> Result<Vec<NoteRow>, String> {
    let vault = state.0.lock().map_err(|e| e.to_string())?;
    let vault = vault.as_ref().ok_or("No vault open")?;
    // ... diesel query
}
```

**Error handling** — commands return `Result<T, String>`. Errors are stringified with `.map_err(|e| e.to_string())`. No custom error types yet.

**Diesel queries** — use the DSL directly; no query builder abstractions:

```rust
use crate::db::schema::notes::dsl::*;
let results = notes
    .filter(archived.eq(0))
    .order(modified_at.desc())
    .load::<NoteRow>(&mut vault.conn)
    .map_err(|e| e.to_string())?;
```

**Boolean columns** — stored as `INTEGER` in SQLite; cast manually in queries (`.eq(0)` / `.eq(1)`). This is a known tech debt item.

---

## Import Ordering (TypeScript)

No enforced formatter rule, but the observed pattern is:
1. External packages (`@tauri-apps/api`, `leaflet`, etc.)
2. Internal stores (`$lib/stores/`)
3. Internal components (`$lib/components/`)
4. Internal types (`$lib/types/`)
5. Relative imports

---

## Error Handling Summary

| Layer | Pattern |
|-------|---------|
| Frontend store | `try/catch`, set `error = String(e)`, expose via getter |
| Fire-and-forget IPC | `.catch(console.error)` |
| Rust command | `Result<T, String>`, `.map_err(\|e\| e.to_string())` |
| Vault guard | `ok_or("No vault open")` early return |

---

## What to Avoid

- Do not use Svelte 4 stores (`writable`, `readable`, `derived`).
- Do not hand-edit `src/lib/components/ui/` or `src-tauri/src/db/schema.rs`.
- Do not transfer image/audio data as base64 through `invoke()` — use `convertFileSrc()`.
- Do not add comments that describe *what* code does — only add comments for non-obvious *why*.
