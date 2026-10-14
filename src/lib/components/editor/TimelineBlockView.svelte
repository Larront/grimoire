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
  import { createBlankEvent, type Timeline, type TimelineEvent } from "$lib/editor/timeline-block";
  import RowList from "$lib/components/editor/RowList.svelte";
  import LinkedTextField from "$lib/components/editor/LinkedTextField.svelte";
  import { remapRowIndices, settleRowChange, type RowChange } from "$lib/editor/row-list";
  import { oneLine } from "$lib/editor/labelled-row";
  import { linkedPlainText } from "$lib/editor/linked-text";
  import { tick } from "svelte";
  import { ChevronDown, Plus } from "@lucide/svelte";

  // The block's record, taken as one prop bag rather than field by field: the connector
  // mounts a block with its record spread over the props, so the rest element *is* the
  // record and nothing here re-lists it (#209).
  let {
    onCommit,
    ...attrs
  }: Timeline & {
    onCommit: (timeline: Timeline) => void;
  } = $props();

  // The editable copy — one record, so an undo hands over a whole timeline and `setAttrs`
  // has no field it can leave behind holding a stale value.
  // svelte-ignore state_referenced_locally
  let timeline = $state<Timeline>({ ...attrs });
  /** Which events have their description showing. View state, never serialized. */
  let expandedSet = $state(new Set<number>());
  /** The event whose title is opening for typing, after an insert or a fresh `/timeline`. */
  let focusedRow = $state<number | null>(null);
  /** The event whose description is opening for typing, from its "Add description". */
  let focusedDescription = $state<number | null>(null);

  function commit() {
    onCommit($state.snapshot(timeline) as Timeline);
  }

  function setEvent(index: number, patch: Partial<TimelineEvent>) {
    timeline.events[index] = { ...timeline.events[index], ...patch };
    focusedRow = null;
    focusedDescription = null;
    commit();
  }

  const isBlank = (e: TimelineEvent) => !e.date.trim() && !e.title.trim() && !e.description.trim();

  // An insert the GM walked away from goes away with them. It was never written — a blank
  // event is not serialized — but it stayed on screen as an "Untitled event", and a stray
  // click between two events used to leave one behind. Focus moving within the row (to
  // its controls, or from title to date) is not leaving it.
  async function dropIfAbandoned(e: FocusEvent, event: TimelineEvent) {
    const row = (e.currentTarget as HTMLElement).closest("[data-row-index]");
    if (row && e.relatedTarget instanceof Node && row.contains(e.relatedTarget)) return;
    // A task, not a microtask: microtasks run between this listener and the field's own
    // blur, and removing the row first left the closing field — drawn by position — to
    // save its empty title over the event that had moved into its place.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // A field swapping its drawn value for an input loses focus for a moment and has it
    // back by now; that is not leaving.
    if (row && row.contains(document.activeElement)) return;
    const index = timeline.events.indexOf(event);
    if (index === -1 || !isBlank(timeline.events[index])) return;
    timeline.events = timeline.events.filter((_, i) => i !== index);
    expandedSet = remapRowIndices(expandedSet, { kind: "delete", index });
    focusedRow = null;
  }

  /** "Add description": open the panel and its field for typing. */
  function addDescription(i: number) {
    expandedSet = new Set([...expandedSet, i]);
    focusedDescription = i;
  }

  const eventName = (e: TimelineEvent) => linkedPlainText(e.title);

  function toggleExpand(i: number) {
    const s = new Set(expandedSet);
    if (s.has(i)) s.delete(i);
    else s.add(i);
    expandedSet = s;
  }

  // Order changes come from the Row List, which owns the controls and the splicing;
  // what is left here is Timeline's own business — carrying the expanded set along with
  // the rows, and what it means for this block to open an event. Whether the change
  // reaches the document is `settleRowChange`'s rule, stated once there.
  function handleRowChange(next: TimelineEvent[], change: RowChange) {
    timeline.events = next;
    expandedSet = remapRowIndices(expandedSet, change);
    settleRowChange(change, {
      // A new event opens its title for typing. Its description stays closed until the
      // GM asks for one, as a fresh `/timeline`'s does: the two used to disagree.
      // Cleared first, so a second insert at the same position is a change the title
      // field sees: it opens on `focused` becoming true, and it was already true.
      focus: (index) => {
        focusedRow = null;
        void tick().then(() => (focusedRow = index));
      },
      commit: () => {
        focusedRow = null;
        commit();
      },
    });
  }

  export function setAttrs(next: Timeline) {
    // An undo that adds or removes events would leave the expanded set pointing at
    // whichever events now sit at those positions, so it starts again closed.
    if (next.events.length !== timeline.events.length) expandedSet = new Set();
    timeline = next;
    focusedRow = null;
    focusedDescription = null;
  }

  /** A fresh insert opens its one blank event's title for typing. */
  export function focusRow(index: number) {
    focusedRow = index;
  }
</script>

<!-- One event, drawn by Timeline: the Row List draws the controls over it and knows
     nothing of dates or titles.

     The date sits in its own column to the left of the spine, like a chronicle's margin:
     at the table the question is "when?", and the eye can run straight down the dates.
     It used to be the smallest, faintest line above the title. In a narrow pane there is
     no room for a margin, and the grid puts the same field back above the title. -->
{#snippet eventRow(event: TimelineEvent, i: number)}
  {@const hasDescription = event.description.trim() !== ""}
  {@const expanded = expandedSet.has(i)}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- Blur in the capture phase rather than focusout: a field closing on blur leaves the
       page before a bubbling focusout reaches here, so the event was never heard. -->
  <div class="timeline-event" onblurcapture={(e) => dropIfAbandoned(e, event)}>
    <div class="timeline-date">
      <LinkedTextField
        value={event.date}
        onCommit={(date) => setEvent(i, { date })}
        restrict={oneLine}
        ariaLabel={`Event ${i + 1} date`}
        placeholder="Date"
        class="font-sans text-sm font-medium leading-snug text-foreground"
      />
    </div>

    <!-- Spine: continuous line + node. The node turns Crimson while the GM is in one of
         the row's fields — the timeline's single use of the accent. -->
    <div class="timeline-spine relative" aria-hidden="true">
      {#if i < timeline.events.length - 1}
        <div
          class="absolute left-1/2 -translate-x-1/2 top-[9px] -bottom-[9px] w-px bg-muted-foreground/30"
        ></div>
      {/if}
      <div
        class="absolute left-1/2 -translate-x-1/2 top-[7px] size-[9px] rounded-full border bg-background
               border-muted-foreground group-focus-within:border-primary"
      ></div>
    </div>

    <div class="timeline-body min-w-0 {i < timeline.events.length - 1 ? 'pb-3' : 'pb-1'}">
      <div class="flex items-start gap-1">
        <!-- Title: Metamorphous (world voice) -->
        <LinkedTextField
          value={event.title}
          onCommit={(title) => setEvent(i, { title })}
          restrict={oneLine}
          focused={focusedRow === i}
          ariaLabel={`Event ${i + 1} title`}
          placeholder="Untitled event"
          class="min-w-0 flex-1 font-heading text-base leading-snug text-foreground"
        />

        {#if hasDescription}
          <button
            type="button"
            class="flex size-7 shrink-0 -my-1 items-center justify-center rounded-md text-muted-foreground
                 transition-colors motion-reduce:transition-none hover:bg-muted hover:text-foreground
                 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            onclick={() => toggleExpand(i)}
            aria-label={expanded ? `Collapse event ${i + 1}` : `Expand event ${i + 1}`}
            aria-expanded={expanded}
            title={expanded ? "Hide description" : "Show description"}
          >
            <ChevronDown
              size={14}
              class="transition-transform duration-150 motion-reduce:transition-none {expanded
                ? 'rotate-180'
                : ''}"
            />
          </button>
        {/if}
      </div>

      <!-- Collapsed, an event with a description shows its first line, so the chevron
         means "more" rather than "maybe something"; it opens the rest. An event without
         one shows nothing at rest and offers "Add description" on hover or focus. -->
      {#if hasDescription && !expanded}
        <button
          type="button"
          class="mt-0.5 block w-full truncate rounded-sm text-left font-sans text-sm leading-relaxed text-muted-foreground
               hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          onclick={() => toggleExpand(i)}
          aria-label={`Show the description of event ${i + 1}`}
        >
          {linkedPlainText(event.description).split("\n")[0]}
        </button>
      {:else if !hasDescription && !expanded}
        <button
          type="button"
          class="timeline-add-description mt-0.5 inline-flex h-6 items-center gap-1 rounded-md px-1 -mx-1 text-xs
               text-muted-foreground hover:bg-muted hover:text-foreground
               focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          onclick={() => addDescription(i)}
        >
          <Plus size={12} aria-hidden="true" />
          Add description
        </button>
      {/if}

      <!-- The full description, in reading size: it used to be 12px with a tight line, in
         a note whose prose is 16px. `inert` as well as `aria-hidden` while closed, and
         kept mounted, so the height it animates to is a height it has. -->
      <div
        class="desc-panel grid overflow-hidden transition-[grid-template-rows] duration-150 ease-out"
        style="grid-template-rows: {expanded ? '1fr' : '0fr'}"
        aria-hidden={!expanded}
        inert={!expanded}
      >
        <div class="min-h-0">
          <LinkedTextField
            value={event.description}
            onCommit={(description) => setEvent(i, { description })}
            multiline
            focused={focusedDescription === i}
            ariaLabel={`Event ${i + 1} description`}
            placeholder="Description"
            class="font-sans text-sm leading-relaxed text-foreground pt-1"
          />
        </div>
      </div>
    </div>
  </div>
{/snippet}

<!-- The frame every note block shares (DESIGN.md §4, "in the page"). The timeline was the
     one block without it, so its controls had no edge to sit against and it read as part
     of the prose. A query container, so the date can leave the margin in a narrow pane. -->
<div
  class="timeline-block @container/timeline my-2 select-none rounded-lg border border-border bg-card/40 px-3 py-2"
  contenteditable="false"
>
  <!-- No chrome of its own. The gutter handle picks the block up (#190) and its menu
       deletes it (#194), so the block draws neither. -->

  {#if timeline.events.length === 0}
    <p class="pl-[9.25rem] pt-1 text-sm text-muted-foreground">
      No events yet — add the first thing that happened.
    </p>
  {/if}

  <!-- Order and the move / delete / insert controls are the Row List's; Add lines up with
       the titles, past the date margin and the spine. -->
  <RowList
    rows={timeline.events}
    row={eventRow}
    noun="event"
    rowName={eventName}
    addClass="timeline-add"
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

  /* An event: the date in a 7rem margin, the spine, then the title and description. One
     date field, placed by the grid — in a narrow pane (28rem, where the margin starts to
     cost the title more than the date gains) it moves above the title. */
  /* The insert point's plus sits on the spine: past the 7rem date margin and the gap,
     at the middle of the 1rem spine column. */
  .timeline-block {
    --row-insert-x: 8.125rem;
  }

  .timeline-event {
    display: grid;
    flex: 1;
    min-width: 0;
    grid-template-columns: 7rem 1rem minmax(0, 1fr);
    grid-template-areas: "date spine body";
    column-gap: 0.625rem;
  }

  .timeline-date {
    grid-area: date;
    padding-top: 0.125rem;
  }

  /* Right-aligned in the margin, so each date sits against the spine it belongs to. */
  .timeline-date :global(button),
  .timeline-date :global(input) {
    text-align: right;
  }

  .timeline-spine {
    grid-area: spine;
  }

  .timeline-body {
    grid-area: body;
  }

  /* Add lines up with the titles: past the margin, the spine and their gaps. */
  .timeline-block :global(.timeline-add) {
    padding-left: 9.25rem;
  }

  @container timeline (max-width: 28rem) {
    .timeline-block {
      --row-insert-x: 0.5rem;
    }

    .timeline-event {
      grid-template-columns: 1rem minmax(0, 1fr);
      grid-template-areas:
        "spine date"
        "spine body";
    }

    .timeline-date {
      padding-top: 0;
    }

    .timeline-date :global(button),
    .timeline-date :global(input) {
      text-align: left;
    }

    .timeline-block :global(.timeline-add) {
      padding-left: 1.625rem;
    }

    .timeline-block > p {
      padding-left: 1.625rem;
    }
  }

  /* "Add description" is there when the GM is working on the event, not while reading. */
  .timeline-add-description {
    opacity: 0;
  }

  :global(.row-list-row:hover) .timeline-add-description,
  :global(.row-list-row:focus-within) .timeline-add-description {
    opacity: 1;
  }
</style>
