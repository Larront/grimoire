<script lang="ts">
  // The Timeline's view — dated events on a vertical rail.
  //
  // Every text surface here is a **Linked Text Field** (#214), which is ADR-0016 §8's one
  // sentence about text inside a block: *a block's free-text values are Linked Text
  // Fields; a block never renders or resolves a wikilink itself.* Timeline was the block
  // that still did both — it built `data-wiki-link` spans as an HTML string through
  // `renderTimelineText` and handed them to `{@html}`, and it asked the Link Resolver
  // itself which of them were stubs. Both are gone: the field splits a value into
  // segments Svelte draws, so a date reading `<b>` shows the characters the GM typed, and
  // resolving a link is the field's business at every one of its four call sites.
  //
  // Losing the `{@html}` also lost the block's **mode**, and that is a correction rather
  // than a side effect. A row used to swap its three values for three inputs, because a
  // string of pre-rendered markup cannot be typed into; a field is its own way in, so the
  // mode had nothing left to do — and ADR-0016 §6 gives a block a mode only when it holds
  // values that change during play beside values that define the thing. A timeline holds
  // no play values at all.
  //
  // What is left is the timeline's own business: the rail, the collapsible description,
  // and which edits become a document write. Order and the hover-revealed controls are
  // the Row List's, and the `[[` autocomplete inside a value is the field's.
  import { createBlankEvent, type TimelineEvent } from "$lib/editor/timeline-block";
  import RowList from "$lib/components/editor/RowList.svelte";
  import LinkedTextField from "$lib/components/editor/LinkedTextField.svelte";
  import { remapRowIndices, type RowChange } from "$lib/editor/row-list";
  import { oneLine } from "$lib/editor/labelled-row";
  import { ChevronDown } from "@lucide/svelte";

  let {
    events,
    onCommit,
  }: {
    events: TimelineEvent[];
    onCommit: (events: TimelineEvent[]) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let _events = $state<TimelineEvent[]>(events);
  /** Which events have their description showing. View state, never serialized. */
  let expandedSet = $state(new Set<number>());
  /** The event whose title is opening for typing, after an insert or a fresh `/timeline`. */
  let focusedRow = $state<number | null>(null);

  function commit() {
    onCommit($state.snapshot(_events) as TimelineEvent[]);
  }

  function setEvent(index: number, patch: Partial<TimelineEvent>) {
    _events[index] = { ..._events[index], ...patch };
    focusedRow = null;
    commit();
  }

  function toggleExpand(i: number) {
    const s = new Set(expandedSet);
    if (s.has(i)) s.delete(i);
    else s.add(i);
    expandedSet = s;
  }

  // Order changes come from the Row List, which owns the controls and the arithmetic;
  // what is left here is Timeline's own business — carrying the expanded set along with
  // the rows, and deciding which changes commit. A move and a delete commit at once; a
  // freshly inserted event is blank, so it opens for typing and becomes a document write
  // when the GM types into it.
  function handleRowChange(next: TimelineEvent[], change: RowChange) {
    _events = next;
    expandedSet = remapRowIndices(expandedSet, change);
    if (change.kind === "insert") {
      expandedSet = new Set([...expandedSet, change.index]); // description visible
      focusedRow = change.index;
      return;
    }
    focusedRow = null;
    commit();
  }

  export function setAttrs(attrs: { events: TimelineEvent[] }) {
    _events = attrs.events;
    focusedRow = null;
  }

  /** A fresh insert opens its one blank event's title for typing. */
  export function focusRow(index: number) {
    focusedRow = index;
  }
</script>

<!-- One event, drawn by Timeline: the Row List draws the controls over this and
     the insert-between gaps around it, and knows nothing of dates or titles. -->
{#snippet eventRow(event: TimelineEvent, i: number)}
  <!-- Spine column: continuous line + node. The connecting line starts under the
       node and extends past the row bottom (-bottom-[34px]) to bridge the 20px
       insertion gap and meet the next node, which paints over its tail. The last
       event draws no descending line. The node turns Crimson while the GM is in one of
       the row's fields — the timeline's single use of the accent, and the same signal
       the node used to carry for the mode this block no longer has. -->
  <div class="relative w-4 flex-none self-stretch" aria-hidden="true">
    {#if i < _events.length - 1}
      <div
        class="absolute left-1/2 -translate-x-1/2 top-[9px] -bottom-[34px] w-px bg-muted-foreground/25"
      ></div>
    {/if}
    <div
      class="absolute left-1/2 -translate-x-1/2 top-[9px] size-[9px] rounded-full border bg-background
             border-muted-foreground/50 group-focus-within:border-primary"
    ></div>
  </div>

  <!-- Content column — pr-14 reserves the gutter the Row List's controls sit in.

       Date, then title, then the description behind the chevron: every value a field
       all of the time, so there is nothing to open before the GM can type — and an
       empty one is reachable through its placeholder rather than needing a mode to
       exist at all. -->
  <div class="flex-1 min-w-0 pb-2 pr-14">
    <!-- Date label: Metamorphous, small, ember-muted -->
    <LinkedTextField
      value={event.date}
      onCommit={(date) => setEvent(i, { date })}
      restrict={oneLine}
      ariaLabel={`Event ${i + 1} date`}
      placeholder="Date"
      class="font-heading text-[11px] leading-tight text-muted-foreground mb-0.5"
    />

    <div class="flex items-start gap-1">
      <!-- Title: Metamorphous (world voice) -->
      <LinkedTextField
        value={event.title}
        onCommit={(title) => setEvent(i, { title })}
        restrict={oneLine}
        focused={focusedRow === i}
        ariaLabel={`Event ${i + 1} title`}
        placeholder="Untitled event"
        class="min-w-0 flex-1 font-heading text-sm leading-snug text-foreground"
      />

      <!-- Expand/collapse toggle for the description. Drawn on every event, not only
           the ones that have one: it is now the way a description is *added*, the mode
           that used to reveal an empty one having gone. -->
      <button
        type="button"
        class="shrink-0 mt-1 p-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground
               transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2
               focus-visible:ring-primary focus-visible:ring-offset-2"
        onclick={() => toggleExpand(i)}
        aria-label={expandedSet.has(i) ? `Collapse event ${i + 1}` : `Expand event ${i + 1}`}
        aria-expanded={expandedSet.has(i)}
      >
        <ChevronDown
          size={12}
          class="transition-transform duration-150 motion-reduce:transition-none {expandedSet.has(i)
            ? 'rotate-180'
            : ''}"
        />
      </button>
    </div>

    <!-- Collapsible description: grid-rows slide (snaps under prefers-reduced-motion).
         `multiline`, because a description wraps across lines inside the fence and the
         format's own escape keeps a line that reads as a heading out of the next
         event. -->
    <!-- `inert` as well as `aria-hidden`, and this is the pair rather than one of them:
         the panel holds a *focusable* field now where it used to hold text, so hidden
         from a screen reader and still in the tab order would put the caret in a value
         clipped to no height. Kept mounted rather than swapped out with an `{#if}`, so
         the height it animates to is a height it has. -->
    <div
      class="desc-panel grid overflow-hidden transition-[grid-template-rows] duration-150 ease-out"
      style="grid-template-rows: {expandedSet.has(i) ? '1fr' : '0fr'}"
      aria-hidden={!expandedSet.has(i)}
      inert={!expandedSet.has(i)}
    >
      <div class="min-h-0">
        <!-- Description: Nunito (reading prose voice) -->
        <LinkedTextField
          value={event.description}
          onCommit={(description) => setEvent(i, { description })}
          multiline
          ariaLabel={`Event ${i + 1} description`}
          placeholder="Description (optional)"
          class="font-sans text-xs text-muted-foreground pt-1 pb-1"
        />
      </div>
    </div>
  </div>
{/snippet}

<div class="timeline-block my-2 select-none" contenteditable="false">
  <!-- No chrome of its own. This corner held a trash can, because a sealed block holds
       every click and so ProseMirror never selected the node for Backspace to take
       (#175 review). The gutter handle picks the block up (#190) and its menu deletes it
       (#194), so the block draws neither. -->

  {#if _events.length === 0}
    <div class="ml-6 text-xs text-muted-foreground font-sans italic mb-1">No events yet</div>
  {/if}

  <!-- Order, the hover-revealed move / delete / insert-between controls and their
       gaps are the Row List's; the gaps are indented to clear the spine. -->
  <RowList
    rows={_events}
    row={eventRow}
    noun="event"
    insertionPointClass="pl-6"
    createRow={createBlankEvent}
    onChange={handleRowChange}
  />
</div>

<style>
  @media (prefers-reduced-motion: reduce) {
    .desc-panel {
      transition: none;
    }
  }
</style>
