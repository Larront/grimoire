# Audit: the three shipped note blocks (Image, Scene, Timeline)

Findings for [#145](https://github.com/Larront/grimoire/issues/145), on the map
[Note Blocks — Infobox, Statblock, Encounter, and the pattern they share](https://github.com/Larront/grimoire/issues/144).

Source-read at commit `18ce275` (branch `next`). Every claim below cites the file and line it came from.
No decisions are made here — this is the ground truth the pattern ticket ([#154](https://github.com/Larront/grimoire/issues/154))
and the migration ticket ([#155](https://github.com/Larront/grimoire/issues/155)) build on.

---

## 1. The de-facto anatomy

Three blocks, three different answers to almost every question. Side by side:

| | **Image** | **Scene** | **Timeline** |
|---|---|---|---|
| Extension file | `src/lib/editor/image-block.ts` (214 ln) | `scene-block.svelte.ts` (129 ln) | `timeline-block.ts` (258 ln) |
| Base | `Image.extend()` from `@tiptap/extension-image` | `Node.create()` | `Node.create()` |
| Node name | `image` (inherited) | `sceneBlock` | `timelineBlock` |
| `group` / `atom` | `block`, **not** atom | `block`, `atom: true` | `block`, `atom: true` |
| Attrs | `src`, `alt` (inherited) + `align`, `width` | `sceneId: number\|null`, `expanded: bool` | `events: TimelineEvent[]` |
| `parseHTML` | inherited (`<img>`) | `[{ tag: "scene-block" }]` | `[{ tag: "timeline-block" }]` |
| `renderHTML` | inherited + `data-align`/`data-width` | `<scene-block data-id data-expanded>` | `<timeline-block data-events="<uri-encoded JSON>">` |
| `renderMarkdown` | `![alt](src){align=… width=…}` | **raw HTML string**, verbatim | ` ```timeline ` fence |
| Load preprocessor | `preprocessImageAttrs` | **none** | `preprocessTimelineBlocks` |
| Node view | imperative `mount()` of `ImageBlockView` | imperative `mount()` of `SceneBlockView` | imperative `mount()` of `TimelineBlockView` |
| Selection handling | `selectNode`/`deselectNode` → `setSelected()` | none | none |
| Insertion | slash command → Tauri file dialog → `insertImageFromFile`; also paste + drop | slash command → `insertContent` with null attrs | slash command → `insertContent` with one blank event |
| Tests | `image-block.test.ts`, `image-lightbox.test.ts`, `image-replace.test.ts` | **none** | `timeline-block.test.ts` |

### Node view protocol — identical in all three

Every block uses the same hand-rolled bridge between ProseMirror and Svelte 5, because TipTap has no
official Svelte 5 node-view renderer in use here. The shape is:

1. `addNodeView()` returns a plain object (`image-block.ts:93`, `scene-block.svelte.ts:59`, `timeline-block.ts:212`).
2. Create a bare `div`, set `contenteditable="false"` on it (`image-block.ts:96`, `scene-block.svelte.ts:63`, `timeline-block.ts:215`).
3. `mount(SomeView, { target: dom, props })` from `svelte`, cast the returned handle to a hand-written
   `…ViewExports` interface (`image-block.ts:9`, `scene-block.svelte.ts:6`, `timeline-block.ts:13`).
4. `update(node)` → bail if `node.type` differs, else push new attrs through the component's exported
   `setAttrs(...)` (all three, e.g. `timeline-block.ts:247`).
5. `stopEvent(e)` → `dom.contains(e.target)`, with per-block escape hatches (below).
6. `destroy()` → `unmount(raw)`.

The component side mirrors it exactly: props are copied into `$state` locals prefixed `_`, each with a
`// svelte-ignore state_referenced_locally`, and `export function setAttrs(...)` reassigns them
(`ImageBlockView.svelte:33-60`, `SceneBlockView.svelte:40-49`, `TimelineBlockView.svelte:248-251`).
That copy-into-`_state` idiom exists because the node view re-pushes attrs on undo/redo rather than
re-rendering; it is the single most repeated piece of code across the three blocks.

### Writing back to the document

All three write attrs back with the same `editor.commands.command(({ tr }) => tr.setNodeMarkup(pos, …))`
shape over `getPos()`, but each spells it differently:

- Image merges into current attrs, re-reading the node first: `tr.doc.nodeAt(pos)` then
  `{ ...currentNode.attrs, ...partial }` (`image-block.ts:99-108`). Guards `pos === undefined`.
- Scene replaces the whole attr set with a literal `{ sceneId, expanded }` (`scene-block.svelte.ts:65-78`).
  Any future attr added to the node would be silently dropped by this call.
- Timeline uses `.chain().command(...).run()` and passes `null` (not `undefined`) as the second
  `setNodeMarkup` argument (`timeline-block.ts:219-229`).

Undo: none of the three does anything special. Because every mutation goes through a ProseMirror
transaction, undo/redo comes free from the history plugin in `StarterKit`, and the `update()` →
`setAttrs()` path is what makes the Svelte view follow an undo. This works, and is the one part of the
protocol all three genuinely share.

### `stopEvent` divergence — all three differ, all for real reasons

- **Timeline**: plain `dom.contains(event.target)` (`timeline-block.ts:244`).
- **Image**: lets `mousedown` through so ProseMirror can node-select the image (needed for the
  `selectNode` toolbar), and returns `true` unconditionally while a resize drag is live, signalled by a
  `data-resizing` attribute the *view* sets on the *extension's* dom root (`image-block.ts:126-131`,
  `ImageBlockView.svelte:145-147`). That attribute is a cross-layer back-channel — the view reaches up
  through `closest("[data-image-block]")` to talk to the node view.
- **Scene**: tracks `isDraggingSlider` with a dom-level `mousedown` listener plus a window `mouseup`,
  because a range-input drag whose pointer strays outside `dom` would otherwise be killed by
  ProseMirror's document-level handler (`scene-block.svelte.ts:90-114`, with a comment saying exactly this).

These are the same bug — *a pointer drag that leaves the node view* — solved twice, independently, in
two different places (extension closure vs. DOM attribute). That is duplication with a shared cause,
not essential divergence.

### Slash-command registration

One flat `SLASH_COMMANDS` array in `slash-command.ts:39-170`, grouped `Text` / `List` / `Insert`, each
entry `{ group, label, keywords, icon, command }` where `icon` is a Lucide *name string* resolved to a
component in `SlashCommandMenu.svelte`. The file's own comment says "Add future custom node commands
here — no other file needs to change" (`slash-command.ts:37`) — and that holds: registration is already
centralised and cheap. Filtering is a case-insensitive substring match over label + keywords
(`filterCommands`, `slash-command.ts:178`).

The one wrinkle: Image's command is `async` and opens a Tauri dialog *after* `deleteRange(range)`
(`slash-command.ts:153-168`), so the command contract is `void | boolean | Promise<void>`
(`slash-command.ts:15-18`). Any block needing a picker before insertion follows that shape.

---

## 2. Where the three diverge — and whether it's essential

### The serialization split is real and principled, but the boundary is drawn in the wrong place

Three storage strategies:

1. **Timeline — content in markdown.** ` ```timeline ` fence, labelled lines, blank-line-separated
   records (`serializeTimelineEvents`, `timeline-block.ts:141`; parsed by `parseTimelineBody:112`).
   ADR-0007 argues this explicitly: "A Timeline Event's data *is* the note content (unlike a Scene,
   which a block references by SQLite id)… an opaque `<timeline>` HTML blob (the Scene-block approach)
   would degrade to unreadable soup in any other tool."

2. **Scene — reference by SQLite id in Grimoire-only HTML.**
   `<scene-block data-id="7" data-expanded="false"></scene-block>` written verbatim into the markdown
   (`scene-block.svelte.ts:51-57`). The *content* (the scene, its slots, volumes, loop flags) lives in
   SQLite and is fetched by the view (`SceneBlockView.svelte:82-97`).

3. **Image — reference by path in portable markdown.** `![alt](src){align=… width=…}`
   (`serializeImageNode`, `image-block.ts:45`). The bytes live in `ledger/images/` (ADR-0001); the note
   holds a ledger-relative path.

**Was the Scene/Timeline split considered? Yes — ADR-0007 §Why states the reference-vs-content
distinction as the deciding reason, and lists "Opaque HTML block" as a rejected option for Timeline.**
So the *axis* (reference vs. content) is a deliberate, documented design decision, not drift.

**Which side is Image on? The reference side — and it is the counter-example that shows Scene's
serialization is drift even if its data model isn't.** Image is a reference (to a file), exactly like
Scene is a reference (to a scene row). But Image encodes its reference in *portable, standard markdown*
that Obsidian and VS Code render natively, with the Grimoire-only part (align/width) confined to a
trailing `{…}` attr block that degrades to visible-but-harmless text. Scene encodes an equally simple
reference — one integer and one boolean — as an HTML tag no other tool understands.

Nothing about "this is a reference" forces opaque HTML. The honest reading:

- **Essential divergence:** reference-vs-content is real, and the three blocks genuinely sit on both
  sides of it. Any pattern must carry both.
- **Non-essential divergence:** *how* a reference is written to disk. Scene predates ADR-0007 and was
  never revisited against it. A ` ```scene ` fence (`Scene: 7` / `Expanded: false`) or a
  `![[scene:7]]`-style embed would satisfy the same requirement portably. This is squarely the
  migration ticket's business.

A second, quieter consequence of Scene's choice: **`expanded` is UI state persisted into the document.**
Collapsing the mixer in a note edits the note's markdown on disk, dirties the buffer, triggers autosave,
and — for a note open in two panes or synced by another tool — is an externally visible content change.
Timeline keeps the analogous state (`expandedSet`, `editingIndex`) purely in the component
(`TimelineBlockView.svelte:60-63`), and Image keeps `_selected` / `_lightboxOpen` in the view
(`ImageBlockView.svelte:43-44`). Scene is the outlier, and this matters directly to the Statblock work:
"HP you decrement" is durable play-state that *should* persist, while "which section is collapsed" is not
— the pattern needs a stated rule for which side of that line a given piece of state falls on.

### Preprocessing is an unmanaged pipeline

`Editor.svelte:106` reads:

```js
const preprocessed = preprocessWikiLinks(preprocessImageAttrs(preprocessTimelineBlocks(initialContent)));
```

Three hand-composed string transforms, order-significant, called in exactly one place, with no registry.
Each new block that needs load-time preprocessing adds another nesting level here. `Editor.svelte` also
lists the extensions themselves (`:110-126`) and imports each block's helpers by name (`:8-23`).

Also note the asymmetry: markdown→editor goes through a **regex string preprocessor into HTML, then
TipTap's HTML parser**, while editor→markdown goes through TipTap's `renderMarkdown` field. Parse and
serialize live in different layers and are only kept in agreement by convention. Timeline is the only
block whose round-trip is covered by tests (`src/test/timeline-block.test.ts`).

### Reactivity idiom

Timeline and Scene use Svelte 5 runes freely and idiomatically (`$state`, `$derived`, `$effect`,
`SvelteMap`/`SvelteSet` in `SceneBlockView.svelte:169-173`). Image's view is more imperative. The
`scene-block.svelte.ts` file carries the `.svelte.ts` extension (so runes would compile) but uses no
runes — the extension is vestigial. Cosmetic, but it means "which file extension does a block
extension use" currently has no consistent answer.

---

## 3. Duplication inventory — what the pattern would absorb

Honest count of what is copy-pasted, most-to-least worth absorbing:

1. **The mount/unmount/setAttrs node-view bridge** (~35 lines × 3). The `…ViewExports` interface, the
   `mount` + cast, `update()` guard + `setAttrs` forward, `destroy()` + `unmount`. Nearly identical in
   all three; the only real variation is the props passed and the `setAttrs` signature — which is
   *positional* in all three (`setAttrs(align, width, src, alt)`), so it re-breaks every time an attr is
   added. An object-shaped `setAttrs(attrs)` would remove the churn.
2. **The `_`-prefixed `$state` mirror + `svelte-ignore state_referenced_locally`** (~5-10 lines × 3).
   Pure ceremony forced by item 1.
3. **The `getPos()` → `setNodeMarkup` write-back** (~10 lines × 3), with three different spellings and
   two different merge semantics (Scene's clobbers, Image's merges). One correct implementation would
   also fix Scene's latent attr-dropping bug.
4. **Wikilink handling inside block fields — duplicated wholesale between Timeline and `Editor.svelte`.**
   This is the largest and most dangerous duplication:
   - `renderTimelineText` (`timeline-block.ts:68-100`) hand-rolls `[[…]]` → `<span data-wiki-link>` for
     `{@html}`, reimplementing `preprocessWikiLinks` (`wiki-link.ts:60`) with its own escaping.
   - Broken-link resolution is written twice: `Editor.svelte:227-255` (`refreshBrokenLinks`, walking the
     doc, dispatching through `wikiBrokenLinkKey`) and `TimelineBlockView.svelte:15-48` (its own
     `linkResolution` map with its own default-to-known-while-pending policy). Both encode the same
     "path match, else alias resolve" rule; both must stay in sync with `Editor.svelte:293-314`'s click
     handler, which encodes it a third time.
   - The `[[` autocomplete is written twice: once as a TipTap `Suggestion` plugin (`wiki-link.ts`) and
     once by hand inside a plain `<input>` (`TimelineBlockView.svelte:183-246`, plus its own dropdown
     markup at `:463-491`).

   **Any new block with free-text fields — Infobox values, Statblock ability text, Encounter notes —
   inherits this whole problem.** Wikilinks in block fields are the single strongest argument for a
   shared pattern, and are worth more than the node-view boilerplate.
5. **Hover-revealed row controls** (up/down nudge, delete, insertion points) —
   `TimelineBlockView.svelte:258-358`. Not yet duplicated, but Statblock field lists and Encounter
   rosters need exactly this. It's the first thing that *will* be copy-pasted if nothing absorbs it.
6. **The pointer-drag-escapes-the-node-view fix** (§1) — solved twice, two ways.

Explicitly *not* duplication: slash-command registration is already a single array; block-specific
styling is genuinely per-block.

---

## 4. What the existing three would need to change

Detail for [#155](https://github.com/Larront/grimoire/issues/155) to spec against.

**Timeline** — cheapest. Already fenced-markdown, already atom, already has a preprocessor and
round-trip tests. Would move to a shared node-view factory and a shared parse/serialize registration.
Its wikilink rendering and `[[` autocomplete would be *deleted* and replaced with the shared field
primitive; that is the substantive part, and the risk is behavioural regression in the
default-to-known-while-pending policy (`TimelineBlockView.svelte:9-17`) which is deliberately different
from `Editor.svelte`'s. Both behaviours are currently correct for their surface; the shared version must
keep the distinction or explain why it doesn't need to.

**Image** — awkward. It extends a third-party extension rather than `Node.create()`, so it inherits
`src`/`alt`/`parseHTML` from `@tiptap/extension-image`. Its markdown form is standard-markdown-plus-attrs,
not a fence, and it must stay that way (portability: `![alt](src)` renders in every tool). It is also the
only non-atom block and the only one using `selectNode`/`deselectNode`. Realistically Image conforms
partially — shared node-view bridge and write-back, own serialization — or is declared out of pattern.
Forcing it into a fence would be a portability regression, i.e. the pattern damaging the principle it
exists to serve.

**Scene** — the one that actually changes. Three separable pieces, and the migration ticket should size
them separately:
1. Serialization: opaque HTML → portable form. Needs a migration path for existing notes (a load-time
   reader for the legacy `<scene-block …>` tag, kept indefinitely — external tools and old files will
   keep producing it) and an update to the sample-ledger fixture, which hand-authors
   `<scene-block data-id="N">` tags and asserts on them (`src-tauri/src/commands/sample.rs:518-543`).
2. `expanded` moves out of the document into view state, if the pattern's state rule says so.
3. Node-view bridge, write-back merge semantics, and the slider-drag fix all fold into shared code.
   Scene has **no tests**, so this is the riskiest of the three to touch — characterisation tests should
   precede the migration.

---

## 5. Constraints the pattern cannot break

Load-bearing behaviours a naive abstraction would damage. Each is a hard constraint on
[#154](https://github.com/Larront/grimoire/issues/154).

1. **`extract_wikilinks` scans the whole body, code fences included.**
   `src-tauri/src/commands/links.rs:27-53` strips frontmatter and then scans raw text for `[[…]]`, with
   no markdown parsing and no fence awareness. This is why ADR-0007 says timeline wikilinks are "indexed
   for free" — Link Index, Backlinks, Graph, and rename-rewrite all reach into the fence.
   **Consequence:** any block that stores wikilinks *as literal `[[…]]` text in the note body* gets full
   link-graph participation with zero backend work. Any block that stores them encoded (URI-encoded JSON
   in an attribute, base64, an id reference) becomes **invisible to the link graph** — links vanish from
   backlinks and are silently missed by rename-rewrite. Note that `renderHTML` for Timeline *does*
   URI-encode its events (`timeline-block.ts:201`) — that's fine, because that HTML never reaches disk;
   only `renderMarkdown` does. A pattern that unified `renderHTML` and `renderMarkdown` would break this
   silently and catastrophically.
   Corollary: `!` before `[[` marks an embed and is skipped (`links.rs:33`), so an embed-style block
   syntax (`![[scene:7]]`) would *not* pollute the link index — potentially useful.

2. **Rename-rewrite edits raw note bytes.** Phase B of `note_mutation`'s `rename` rewrites `[[old path]]`
   in other notes via `commit_many` (CONTEXT.md §Write-and-Reconcile Envelope). It is a text rewrite over
   the file. A block whose serialized form embeds a wikilink inside a *quoted or encoded* field will
   either be missed or be corrupted by that rewrite. Fenced plain text is safe; JSON-in-an-attribute
   is not.

3. **All note writes go through the Write Chokepoint, and the editor is the only writer.**
   `Editor.svelte` autosaves `editor.getMarkdown()` on a 500 ms debounce (`:129-135`, `:157-165`).
   Everything a block mutates therefore becomes a full-note rewrite, hash-registered for echo
   suppression (CONTEXT.md §Write Chokepoint). Two things follow: (a) a block must not write note bytes
   by any other route, or the watcher will see it as an external edit and raise a Conflict Banner;
   (b) **high-frequency mutation is a real cost** — a statblock HP field decremented during combat means
   a full note serialize + disk write + index reconcile per change. The Statblock play-state ticket
   ([#150](https://github.com/Larront/grimoire/issues/150)) needs to know this: SceneBlockView already
   dodges it by writing slot volumes to SQLite via `api.updateSceneSlot` (`SceneBlockView.svelte:201-215`)
   rather than through the document.

4. **Autosave can be paused, and blocks must respect it.** `pauseAutosave()` / `discardPendingEdit()`
   (`Editor.svelte:199-222`) exist so a Conflict Banner decision isn't clobbered. A block that persists
   through its own channel (as Scene does for slot state) bypasses that guarantee entirely — writes land
   while the banner is up. Currently acceptable because scene slots aren't note content; a Statblock
   writing play-state out-of-band would *not* be.

5. **Image paths are ledger-relative and resolved through the backend.** `src` is relative to
   `ledger/images/` (ADR-0001), resolved at render time by `api.getImageAbsolutePath` + `convertFileSrc`
   (`ImageBlockView.svelte:66-76`). A pattern must not assume block attrs are directly renderable —
   some need an async backend round-trip before display, with a loading state and a not-found state
   (`:250-267`).

6. **The search index sees the raw body, verbatim.** `src-tauri/src/search.rs:54` strips frontmatter and
   indexes the rest as one text field. So: timeline event text is searchable prose (good, free); Scene's
   `<scene-block data-id="7">` is indexed as literal noise (bad, existing). Whatever a new block writes
   to disk lands in full-text search as written. Relevant to the "are statblock fields searchable"
   fog item — plain-text-in-a-fence gets substring search for free even before any `hp:>50` structured
   query exists.

7. **Raw markdown is shown to the user in places that don't render blocks.** `WikiLinkPreview` slices
   the first 280 chars of the raw body and renders it as plain text (`:12-14`, `Editor.svelte:334`).
   A note beginning with a block shows its raw serialized form in the hover preview. A fence reads as
   plausible content; `<scene-block data-id="7"></scene-block>` reads as a bug. Serialized form is a
   user-visible surface, not just a storage detail.

8. **`getMarkdown()` round-trips the entire document on every save.** Any block whose
   parse(serialize(x)) ≠ x will corrupt itself on the next autosave — no user action needed. ADR-0007
   §Consequences documents Timeline's known asymmetries here (a description cannot contain a blank line;
   a hand-authored `Date:` after `Title:` reads as description). The pattern must make round-trip
   fidelity a stated, tested requirement per block, not a per-block accident.

9. **Blocks with mutable state must survive undo.** The `update()` → `setAttrs()` path is what makes an
   undone attr change reach the Svelte view. A shared bridge must preserve it; a view that holds state
   the node view can't push into is silently un-undoable.

---

## 6. Open questions this audit raises (for the map, not to answer here)

- **Is Scene's HTML serialization a bug to fix, or a documented exception?** ADR-0007 justifies the
  reference-vs-content axis but not the HTML encoding. Directly in scope for [#155](https://github.com/Larront/grimoire/issues/155),
  and materially affects [#149](https://github.com/Larront/grimoire/issues/149) (where a Statblock
  definition lives) — if a statblock is a reusable entity, Scene is its precedent, and that precedent is
  currently the map's worst-serialized block.
- **What is the rule for UI state vs. document state?** Scene persists `expanded`; Timeline and Image
  don't. Statblocks need both durable play-state (HP) and ephemeral UI state (collapsed sections), so
  the pattern must state the rule rather than leave it per-block. Feeds [#150](https://github.com/Larront/grimoire/issues/150)
  and [#154](https://github.com/Larront/grimoire/issues/154).
- **Does Image conform, partially conform, or sit outside the pattern?** It's the only non-atom,
  only third-party-extended, only standard-markdown block. Deciding this bounds [#155](https://github.com/Larront/grimoire/issues/155).
- **Is a shared wikilink-bearing text field a pattern requirement or a separate primitive?** Every
  proposed block has free-text fields, and the current answer is ~150 lines of duplicated resolution +
  autocomplete + rendering per block. Arguably the highest-value thing the pattern could carry, and
  arguably its own ticket rather than a clause in [#154](https://github.com/Larront/grimoire/issues/154).
- **Scene has no tests.** Migrating it is the riskiest single change the map proposes. Whether
  characterisation tests precede the migration is a real scoping call for [#155](https://github.com/Larront/grimoire/issues/155).
