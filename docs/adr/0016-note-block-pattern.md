# ADR-0016 — The Note Block pattern

**Status:** Accepted
**Date:** 2026-07-29

## Context

A **Note Block** is a Grimoire-authored TipTap node placed inside a note. Six exist or are
specced: Image, Scene and Timeline shipped; Infobox, Statblock and Callout are specced by the
Note Blocks map ([#144](https://github.com/Larront/grimoire/issues/144)). Stock markdown nodes —
tables, task lists, plain blockquotes — are editor features this pattern says nothing about.

The three shipped blocks were built one at a time with nothing stating a shared contract, and the
audit ([#145](https://github.com/Larront/grimoire/issues/145)) found three different answers to
almost every question: three serialization strategies, three spellings of the same write-back,
two independent fixes for one pointer-drag bug, and ~150 duplicated lines of wikilink handling.
Doubling the inventory without a written contract would double that.

This ADR is the contract. It is deliberately **thin** — most of what governs a block was settled
by the map's individual tickets and is cited rather than restated. What is new here is the
serialization rule, the floor for fenced content, the declaration checklist, the two pieces of
shared machinery, the test for when a block earns a mode, and the list of things the pattern
refuses to own.

## Decision

### 1. Where a block's content lives

> **A block's content lives in the note, written as plain markdown — unless it is a reference,
> and a reference may only address something that already has a ledger path.**

ADR-0007 drew the axis as *content vs reference*. That axis is real but decides nothing on its
own, because Image is a reference too and Image is portable: `![alt](path)` against Scene's
`<scene-block data-id="7">`. Same side of the axis, opposite outcomes. The rule above adds the
clause that does the work — **a reference needs a path** — and with it the axis stops needing to
be argued per block.

| Block | Placement |
|---|---|
| Timeline, Infobox, Statblock, Callout | Content, in the note |
| Image | Reference to a file in `ledger/images/` — has a path, legal |
| Scene | Reference to a SQLite row — **no path, illegal, the documented exception** |

The path clause is what gives the rule teeth. Without it "references are allowed" is a loophole
any future block walks through, and Scene's raw id becomes precedent rather than debt. With it,
opaque HTML needs no separate prohibition — there is nothing left for it to encode.

The reference side has emptied out over the course of the map, which is corroboration rather than
coincidence: [#149](https://github.com/Larront/grimoire/issues/149) declined to make a Statblock
an entity, [#151](https://github.com/Larront/grimoire/issues/151) declined an Encounter, and
[#147](https://github.com/Larront/grimoire/issues/147) found note-embed places no new demand.
Of the four newly specced blocks, none is a reference. #149 reached this rule independently from
the other side.

The one case the rule forbids — addressing a map, which is pure SQLite with no ledger path — is
already out of scope, and #147 established that a naive map wikilink does not fail quietly but
**misfires**, rendering as a Stub Note whose click creates a file. That case needs a Link Index
effort, not a block.

### 2. The floor for fenced content

A fenced block defines its own format. The pattern mandates only a floor:

1. **Plain text, line-oriented.** No JSON, no YAML, no HTML, no encoded or escaped values.
2. **Wikilinks written literally** as `[[Target]]` — never quoted, wrapped or encoded.
3. **Round-trip fidelity, proved by a test.** `parse(serialize(x)) == x`, byte for byte.

These are not house style; each one prevents a silent failure:

- `extract_wikilinks` (`links.rs:27-53`) is a **fence-blind raw scan**, so a literal `[[…]]`
  inside a fence joins the Link Index, Backlinks, Graph and rename-rewrite for free — and an
  encoded one is invisible to all four (audit constraint 1).
- Rename-rewrite edits raw note bytes (audit constraint 2), so a wikilink inside a quoted or
  encoded field is either missed or corrupted.
- `getMarkdown()` round-trips the whole document on every autosave (audit constraint 8), so a
  block whose parse and serialize disagree **corrupts itself with no user action**.
- Serialized form is user-visible: `WikiLinkPreview` shows raw body text (audit constraint 7).

A single mandated grammar was rejected. Statblock is the second fenced block specced and already
needs more than rows — `## Section`s of named prose entries — so a uniform grammar would be
broken by its second user. The floor already forces the family resemblance that matters: every
fenced block reads as `Label: value`, one per line.

### 3. What a block declares — a checklist, not a registry

Every block provides, and nothing collects them:

- **A node spec** — `Node.create()` or an extension of one, `atom` or container (§5).
- **A markdown claim.** The block declares itself to the markdown reader and claims `code` tokens
  whose language is its own name, declining gracefully so a GM's ` ```python ` stays a code block
  (inherited from [#158](https://github.com/Larront/grimoire/issues/158)).
- **A slash-command entry** in the existing `SLASH_COMMANDS` array (`slash-command.ts:39`).
  Blocks needing a picker before insertion use the established `async` command shape (`:15-18`).
- **A node view** built on the shared connector (§4).
- **A round-trip test** (§2 rule 3).
- **One directory.** Everything block-specific lives in it.

A registry that collected these was rejected. Two of the three current scatter points disappear on
their own — #158 retires the preprocessor chain and its imports — leaving two one-line edits per
block, one of which is already centralised and whose "no other file needs to change" comment the
audit confirms holds. A collector for that would hide something no more complex than asking for
it, adding a layer to every future debugging session for nothing.

It would also aim at the wrong cost, which is the risk worth naming: the expensive part of a new
block is §4, not registration, and a registry would tidy the cheap part while *looking* like the
pattern had done its job.

The drift the pattern exists to fix is not evidence against this. All three shipped blocks are
registered correctly. They diverged in what each invented internally — which no collector can
see, and which the checklist's round-trip test does catch.

### 4. Shared machinery

Two pieces, and they are the pattern's only executable content. Everything else here is a rule.

**The node-view connector.** One implementation replacing three (~50 lines each). This is what
makes the fourth and tenth block cheap; the rest of this ADR does not remove work.

- **Two modes**, mirroring §5: *sealed* (`contenteditable="false"`, all state in attrs) and
  *container* (a `contentDOM` whose children ProseMirror owns).
- **Attributes passed as one object**, not positionally. Today's positional `setAttrs(align,
  width, src, alt)` re-breaks every consumer when an attribute is added.
- **One named hole for event handling.** Image must let `mousedown` through for node selection;
  Scene must hold a slider drag that leaves the node view. That divergence is essential and the
  connector must not paper over it.
- Preserves the `update()` → `setAttrs()` path, without which an undone change never reaches the
  Svelte view (audit constraint 9).

It also fixes a latent bug by construction: Scene's write-back replaces the whole attribute set
rather than merging, silently dropping any attribute beyond the two it names.

**The row list.** One implementation replacing Timeline's ~100 lines
(`TimelineBlockView.svelte:258-358`), the audit's named next-copy-paste. It owns order and the
hover-revealed controls — move up, move down, delete, insert between — and **knows nothing about
what a row contains**. Each block draws its own row.

Two distinct primitives are involved and are named apart because their memberships differ:

| | Members |
|---|---|
| **Labelled Row** — the `Label: value` data shape, one parser, one serializer | Infobox rows, Statblock header rows (byte-identical per #150) |
| **Row list** — order and controls, content-agnostic | Timeline events, Infobox rows, Statblock header rows, Statblock entries |

Timeline needs the second and not the first, which is the tell that one primitive would half-fit
four places.

Both are built now rather than extracted at the second consumer. "Share it when something else
needs it" is precisely the habit that produced three connectors, and Infobox — a block that is
nothing but rows — is next in build order. Unlike the connector, the row list has a working
reference implementation to extract from rather than invent.

### 5. Two shapes

- **Sealed** — no ProseMirror children; all content in attributes. Image, Scene, Timeline,
  Infobox, Statblock.
- **Container** — real ProseMirror children. Callout.

The provisional third shape (*typed container*, children constrained to one node type) is
**dropped, not deferred** — #151 dissolved the Encounter block that was its only motivation.

ADR-0007 deferred nested content because Timeline would have needed holes built from nothing.
Callout does not: blockquote is already a nested node in StarterKit, so the schema jump is
attributes on an existing node. The unpaid cost was the node-view side, and #158 paid it — Callout
ships a real node view whose body ProseMirror owns, so the container mode is written against a
real implementation rather than an anticipated one.

### 6. Editing posture — a test, not a mode

> **A block is directly editable by default. It gets a mode only when it holds values that change
> during play sitting next to values that define the thing.**

Statblock passes: `43/59` puts the current value and the maximum a few pixels apart, and the slip
edits the creature's definition mid-fight ([#153](https://github.com/Larront/grimoire/issues/153)).
Nothing else specced passes. Infobox has no play values at all; Callout is prose, where a pencil
before typing would be absurd; Image and Scene are click-and-drag surfaces.

A single imposed posture was rejected because it would make three of four blocks worse. The test
is stated so the next block author must answer it out loud, rather than reaching for a mode by
habit — a mode is the most expensive thing a block can add, doubling its states and needing a way
into and out of each.

Two things *are* universal, generalised here from the tickets that decided them:

- **Posture never serializes.** Mode, collapse and selection are view state; document state is what
  the GM carries to another device and reads correctly in Obsidian
  ([#150](https://github.com/Larront/grimoire/issues/150)). Scene's `expanded` is the outlier
  (closed — see *Amendments*).
- **Every mutation is one undo.** A block that changes the document from its view starts its own
  undo group, because `prosemirror-history` groups adjacent steps inside 500 ms and would otherwise
  fold a play-state change into an unrelated prose edit (#153).

### 7. Play-state

Settled by #150 and restated as a contract for any future block: **play-state is the serialized
value.** `HP: 3/12` is the whole truth; a hit is an ordinary note edit through the ordinary
autosave, Write Chokepoint and reconcile. No SQLite row, no block id, no ephemeral store.

Playability is **authored, not inferred** — declared by value syntax (`N/M`, `[ ]`/`[x]` runs) —
which is forced by there being no schema in a fence to consult.

A block must not write note bytes by any route but the editor (audit constraints 3 and 4). Scene's
out-of-band SQLite writes are tolerable only because scene slots are not note content; the same
route for note content would land writes while a Conflict Banner is up. (Amended — the rule now
reads *by any route but the editor or the note-rename rewrite path*; see *Amendments*.)

### 8. What the pattern does not own

Named as seams, because a pattern that owns everything becomes a framework nobody can extend.

- **The format inside a fence.** §2 sets a floor and stops.
- **How a block looks.** There is no shared shell component. Blocks use the design system like
  every other surface. A shell fitting Callout (a coloured quote), Timeline (a vertical rail),
  Infobox (narrow and floated) and Statblock (full width with prose) is a bordered box worth
  nothing, and grows a flag per difference until it is harder to read than four separate blocks.
  The tempting case — Infobox versus a Statblock header, identical in the file per #150 — is
  refused on #148's grounds: one component with a switch is exactly how the shipped three drifted,
  and doing it in CSS is the same mistake. What they share is the row format and the row list;
  appearance follows from those, separately.
- **What a block means.** **Presentation may name a domain concept; the model may not** (#158). An
  `encounter` Callout type with an icon is fine; a roster, an Encounter node, or a query that knows
  which fights a note holds is not.
- **Anything outside the note.** Nothing indexes a block's insides. Labelled-row values are
  full-text searchable because the Search Index reads the raw body verbatim, and that is permanent:
  no structured index, no query syntax, no fifth Derived Index member
  ([#160](https://github.com/Larront/grimoire/issues/160)). The line is persistence, not
  comprehension — any surface may parse rows from the document in front of it; nothing may record
  a row's label or value outside that note.
- **Text and links inside a block.** One sentence, and it belongs to
  [#156](https://github.com/Larront/grimoire/issues/156)'s primitives rather than here: *a block's
  free-text values are Linked Text Fields; a block never renders or resolves a wikilink itself.*

### 9. Membership

**Image is a full member.** The audit's suggestion that it "conforms partially or sits outside" is
superseded by §1: the rule asks for portable plain markdown, not a fence, and `![alt](path)` is the
most portable thing in the ledger — the only block that renders as real content in Obsidian. It was
the evidence that Scene's opaque HTML was avoidable, it can use the connector and the checklist, and
it already carries more test coverage than the other two combined.

Being the member that shares the least code is a fact about images, not a failure to conform: the
pattern is a contract about how a block behaves in a GM's file, not a code-sharing club.

**Scene is the exception**, and the only one. Its migration is
[#155](https://github.com/Larront/grimoire/issues/155)'s business.

## Considered options

- **Content-vs-reference as the whole rule** (ADR-0007's framing) — rejected: it places blocks on an
  axis but does not constrain the encoding, which is where Scene went wrong while Image did not.
- **A block registry** collecting node spec, markdown handlers, slash entry and node view — rejected:
  §3. Shallow, and aimed at the cheap cost.
- **One mandated fence grammar** for all blocks — rejected: §2. Broken by its second user.
- **One editing posture** imposed on all blocks — rejected: §6. Makes three of four worse.
- **A shared visual shell** — rejected: §8. The framework-nobody-can-extend failure, arriving on
  schedule.
- **Extracting the row list at the second consumer** rather than now — rejected: §4. The deferral
  that produced three connectors.
- **A pattern clause that a block's serialized form is its search surface** — rejected in #160 as a
  clause and kept as a boundary note on the block specs; #156 made this pattern thinner and that
  direction holds. Recorded here because #155 may still find it the sharpest argument against
  Scene's HTML that does not depend on the migration proceeding.

## Consequences

- **Scene is out of pattern until migrated**, on the serialization rule and on `expanded` being view
  state persisted into the document. It has no tests, making it the riskiest change the map proposes;
  characterisation tests before migration are #155's call. (Both closed — see *Amendments*.)
- **Two pieces of machinery must exist before Infobox is built**, or the pattern ships as prose and
  the fourth block copy-pastes the third.
- **The connector's event-handling hole is a deliberate hole.** A later attempt to close it "for
  consistency" would re-break image selection and the scene slider.
- **The checklist depends on people running it.** The mitigation is the round-trip test: the item
  that catches the drift that actually corrupts a GM's file.
- **Three fenced blocks means three little dialects** for a GM hand-editing in Obsidian. Bounded by
  the floor — all read as `Label: value`, one per line — and a GM only meets a dialect in the block
  they are editing.
- **Image should probably be marked `atom`** during migration; it has no children and is sealed in
  everything but the flag. Whether the flag can simply be set, or whether `selectNode`/`deselectNode`
  depends on it being unset, is a code question for #155 rather than a guess here.
- No block may acquire a SQLite entity without redrawing §1.

## Amendments

### 2026-08-03 — Scene's migration shipped ([#185](https://github.com/Larront/grimoire/issues/185))

The decision above is unchanged; three statements in it described a *pending* state that has now
resolved, and one rule is widened. The reasoning is left as written — it is the record of what was
argued — so this section says what is no longer true rather than editing the argument.

**Scene is in pattern on §6, and on §1 as far as §1 can reach.** `expanded` is gone from the
document; mixer collapse is view state, and collapsing writes no bytes. `<scene-block data-id="7">`
— cited in §1 as the evidence that opaque HTML was avoidable, and still the honest description of
what Scene wrote when this ADR was accepted — is now a ` ```scene ` fence carrying the id and the
scene's name. §1's table row stands unchanged and on purpose: a scene is still a SQLite row with no
ledger path, so it is still **the documented exception**. The fence makes the reference *legible,
not legal*, and recording this ticket as bringing Scene into conformance would be wrong.

**§7's write rule is widened, narrowly.** A scene rename has to rewrite the name cached in every
note referencing it — a copy with an owner elsewhere is either synced or lying — so note bytes are
now written by one more route: `note_mutation::commit_backlink_rewrites`, the batched
write-and-reconcile a *note* rename's backlink rewrites already used. That path predates this ADR
and §7 never named it, which is the sense in which this is a clarification as much as a widening:
the rule's target is a **block writing through a channel of its own**, and adding a caller to the
one sanctioned non-editor writer is not that. What the rule keeps forbidding is what the audit
found: writes that bypass the [[Write Chokepoint]], and per-mutation writes from a node view.

**The Conflict Banner cost named in §7 is real and unpaid.** Neither this path nor the note rename
it borrows checks for a banner, so a bulk rewrite can land under an open note holding unsaved
changes — whose next autosave writes the old name back. This is the edge the planned
repair-backlinks tool exists for, and it is now reachable by one more gesture. A future writer
reading §7 should know the guarantee is echo-suppression, not exclusion.

**Image was left alone.** The `atom` flag question above was answered by not needing an answer: a
childless node is already an atom, so setting the flag would change no behaviour, and Image's
on-disk form is unchanged.

### 2026-08-18 — The last three pieces of drift, closed

Three tickets, none of them changing a decision above: each is the ADR's own text finally
being true of the code. Recorded because two of them read, from the outside, like the ADR
being contradicted.

**One table now declares each block's word and icon**
([#220](https://github.com/Larront/grimoire/issues/220)). The slash menu, the gutter
handle's "Turn into" section and the handle's accessible label named the same blocks
separately, with a comment in the second *asserting* they agreed and nothing keeping it.
`BLOCK_VOCABULARY` (`block-vocabulary.ts`) is that comment as data, and `BLOCK_WORDS` is
derived from it.

This is **not** the registry §3 rejects, and the distinction is the reason it is worth
recording. §3's argument is about node specs, markdown claims, slash entries and node
views — a collector for those would tidy the *cheap* part of a new block while hiding the
expensive one. Fourteen display strings are not that: nothing about a block's behaviour
goes through this table, and the failure it prevents — a GM meeting one block under two
names — is not a failure a checklist can catch. The icon names are typed against the icon
map, so a typo is now a build error rather than a menu item drawn with no glyph.

It does cross §3's *"One directory. Everything block-specific lives in it"*, and knowingly:
a word and an icon are not block-specific in the sense that clause protects. That clause
keeps a block's **implementation** in one place so a new one can be read and deleted whole;
these strings belong to the *menus*, which are editor chrome no block owns, and neither
menu could read them from fourteen directories without a collector of exactly the kind §3
refuses. A block's directory still holds everything that makes it work.

**No block draws its own delete control**
([#219](https://github.com/Larront/grimoire/issues/219)). The gutter handle's menu deletes
anything, and Infobox and Timeline dropped their trash cans when it landed; Statblock and
Image kept theirs, which is §8's drift at the level of a single control. Both are gone, and
the statblock's control row is one button shorter in both modes.

**Timeline's values are Linked Text Fields** ([#214](https://github.com/Larront/grimoire/issues/214)).
§8's sentence — *a block's free-text values are Linked Text Fields; a block never renders
or resolves a wikilink itself* — was true of Infobox, Statblock and Callout and false of
Timeline, which built `data-wiki-link` spans as an HTML string for `{@html}` and asked the
Link Resolver itself. `renderTimelineText` and its escaper are deleted, so the sentence now
holds without exception.

It cost Timeline its **mode**, which §6 says it should never have had: a row swapped its
three values for three inputs because pre-rendered markup cannot be typed into, and a field
is its own way in. A timeline holds no play values, so there was nothing for a mode to
protect. `RowList`'s `onRowFocusOut` went with it — that mode was its only caller, and a
field commits its own edit on blur.
