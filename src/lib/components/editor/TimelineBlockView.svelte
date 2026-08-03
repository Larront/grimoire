<script lang="ts">
  import { createBlankEvent, renderTimelineText, type TimelineEvent } from "$lib/editor/timeline-block";
  import RowList from "$lib/components/editor/RowList.svelte";
  import { remapRowIndices, type RowChange } from "$lib/editor/row-list";
  import { tick } from "svelte";
  import { api } from "$lib/api";
  import { parseWikiTarget, type NoteSearchResult } from "$lib/editor/wiki-link";
  import { notes } from "$lib/stores/notes.svelte";
  import { linkResolver } from "$lib/stores/link-resolver.svelte";
  import { portal } from "$lib/utils/portal";
  import { placeMenu } from "$lib/utils/anchored-menu";
  import { FileText, ChevronDown, Trash2 } from "@lucide/svelte";

  // Wikilink stub-vs-resolved styling, answered by the Link Resolver — drawing, so
  // the cached read (a target that hasn't resolved yet stays full accent rather than
  // flashing as a faded, unclickable stub). The effect below only warms the cache
  // for the targets this timeline draws.
  const isKnownPath = (path: string) => linkResolver.isKnown(path);

  $effect(() => {
    const paths = new Set<string>();
    for (const ev of _events) {
      for (const field of [ev.date, ev.title, ev.description]) {
        for (const m of field.matchAll(/\[\[([^\]]+)\]\]/g)) {
          paths.add(parseWikiTarget(m[1]).path);
        }
      }
    }
    notes.notes; // tracked: re-prime when the ledger's notes load/change
    void linkResolver.prime(paths);
  });

  let {
    events,
    onCommit,
    onRemove,
  }: {
    events: TimelineEvent[];
    onCommit: (events: TimelineEvent[]) => void;
    /** Takes the whole timeline out of the note. Undo brings it back in one step. */
    onRemove?: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let _events = $state<TimelineEvent[]>(events);
  let editingIndex = $state(-1);
  // Set of expanded event indices (description visible)
  let expandedSet = $state(new Set<number>());

  // Only one event is editable at a time (editingIndex), so single refs suffice.
  let titleInput = $state<HTMLInputElement>();
  let descTextarea = $state<HTMLTextAreaElement>();

  interface SuggestionState {
    items: NoteSearchResult[];
    selectedIndex: number;
    x: number;
    y: number;
    /** The field's top, so a menu with no room below it flips clear of the row. */
    anchorTop: number;
    triggerStart: number;
    eventIndex: number;
    field: "title" | "description";
  }
  let suggestion = $state<SuggestionState | null>(null);
  let suggestionEl = $state<HTMLDivElement | undefined>();

  // Placed from its measured height, like the two components that draw the same list
  // elsewhere: an event edited near the foot of the window flips its menu above the
  // field instead of opening it off screen.
  $effect(() => {
    if (suggestion && suggestionEl) placeMenu(suggestionEl, suggestion);
  });

  $effect(() => {
    const idx = editingIndex;
    if (idx < 0 || idx >= _events.length) return;
    tick().then(() => {
      titleInput?.focus();
    });
  });

  function commit() {
    suggestion = null;
    onCommit($state.snapshot(_events) as TimelineEvent[]);
    editingIndex = -1;
  }

  function handleFocusOut(i: number, container: HTMLElement) {
    if (editingIndex !== i) return;
    // Defer: during the display→edit swap the clicked button unmounts and fires
    // focusout before the new input is focused (relatedTarget is null at that
    // instant). Check where focus actually landed once it has settled.
    setTimeout(() => {
      if (editingIndex !== i) return;
      if (container.contains(document.activeElement)) return;
      commit();
    });
  }

  function expand(i: number) {
    const s = new Set(expandedSet);
    s.add(i);
    expandedSet = s;
  }

  function startEdit(i: number) {
    expand(i); // auto-expand so the description is visible in edit mode
    editingIndex = i;
  }

  // Header click: if it landed on a wikilink, let it bubble to Editor.svelte's
  // delegated navigation handler instead of entering edit mode.
  function editFromHeader(e: MouseEvent, i: number) {
    if ((e.target as HTMLElement).closest("[data-wiki-link]")) return;
    startEdit(i);
  }

  function toggleExpand(i: number) {
    const s = new Set(expandedSet);
    if (s.has(i)) s.delete(i); else s.add(i);
    expandedSet = s;
  }

  // Order changes come from the Row List, which owns the controls and the
  // arithmetic; what is left here is Timeline's own business — carrying the
  // expanded set along with the rows, and deciding which changes commit. A move
  // and a delete commit at once; a freshly inserted event is blank and opens for
  // editing, so it commits when the GM leaves it (handleFocusOut).
  function handleRowChange(next: TimelineEvent[], change: RowChange) {
    _events = next;
    expandedSet = remapRowIndices(expandedSet, change);
    if (change.kind === "insert") {
      expandedSet = new Set([...expandedSet, change.index]); // description visible
      editingIndex = change.index;
      return;
    }
    if (change.kind === "delete") editingIndex = -1;
    onCommit($state.snapshot(_events) as TimelineEvent[]);
  }

  async function handleTrigger(
    el: HTMLInputElement | HTMLTextAreaElement,
    eventIndex: number,
    field: "title" | "description",
  ) {
    const value = el.value;
    const cursor = el.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursor);
    const lastOpen = textBeforeCursor.lastIndexOf("[[");
    if (lastOpen === -1) { suggestion = null; return; }
    const between = textBeforeCursor.slice(lastOpen + 2);
    if (between.includes("]]")) { suggestion = null; return; }
    const query = between;
    const items = await api.searchNotes(query).catch(() => []);
    const rect = el.getBoundingClientRect();
    suggestion = {
      items,
      selectedIndex: 0,
      x: rect.left,
      y: rect.bottom + 4,
      anchorTop: rect.top,
      triggerStart: lastOpen,
      eventIndex,
      field,
    };
  }

  function handleFieldKeydown(
    e: KeyboardEvent,
    eventIndex: number,
    field: "title" | "description",
  ) {
    if (!suggestion || suggestion.eventIndex !== eventIndex || suggestion.field !== field) return;
    const count = Math.max(suggestion.items.length, 1);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      suggestion.selectedIndex = (suggestion.selectedIndex + 1) % count;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      suggestion.selectedIndex = (suggestion.selectedIndex - 1 + count) % count;
    } else if (e.key === "Enter" && suggestion.items.length > 0) {
      e.preventDefault();
      acceptSuggestion(suggestion.items[suggestion.selectedIndex]);
    } else if (e.key === "Escape") {
      suggestion = null;
    }
  }

  function acceptSuggestion(item: NoteSearchResult) {
    if (!suggestion) return;
    const { eventIndex, field, triggerStart } = suggestion;
    const input = field === "title" ? titleInput : descTextarea;
    const currentValue = _events[eventIndex][field];
    const cursor = input?.selectionStart ?? currentValue.length;
    const before = currentValue.slice(0, triggerStart);
    const after = currentValue.slice(cursor);
    const inserted = `[[${item.path}]]`;
    _events[eventIndex] = { ..._events[eventIndex], [field]: before + inserted + after };
    suggestion = null;
    const newCursor = triggerStart + inserted.length;
    tick().then(() => {
      input?.focus();
      input?.setSelectionRange(newCursor, newCursor);
    });
  }

  export function setAttrs(attrs: { events: TimelineEvent[] }) {
    _events = attrs.events;
    editingIndex = -1;
  }

  export function openEdit(index: number) {
    startEdit(index);
  }
</script>

<!-- One event, drawn by Timeline: the Row List draws the controls over this and
     the insert-between gaps around it, and knows nothing of dates or titles.
     Values are read off `event` and bound through `_events[i]`, which is the same
     record — the bindings write to Timeline's own state, not to a snippet
     argument. -->
{#snippet eventRow(event: TimelineEvent, i: number)}
  <!-- Spine column: continuous line + node. The connecting line starts under the
       node and extends past the row bottom (-bottom-[34px]) to bridge the 20px
       insertion gap and meet the next node, which paints over its tail. The last
       event draws no descending line. The node turns Crimson only while editing —
       the timeline's single use of the accent. -->
  <div class="relative w-4 flex-none self-stretch" aria-hidden="true">
    {#if i < _events.length - 1}
      <div
        class="absolute left-1/2 -translate-x-1/2 top-[9px] -bottom-[34px] w-px bg-muted-foreground/25"
      ></div>
    {/if}
    <div
      class="absolute left-1/2 -translate-x-1/2 top-[9px] size-[9px] rounded-full border bg-background
             {editingIndex === i ? 'border-primary' : 'border-muted-foreground/50'}"
    ></div>
  </div>

  <!-- Content column — pr-14 reserves the gutter the Row List's controls sit in -->
  <div class="flex-1 min-w-0 pb-2 pr-14">
    {#if editingIndex === i}
      <!-- Edit mode: all fields visible -->
      <input
        bind:this={titleInput}
        bind:value={_events[i].title}
        type="text"
        placeholder="Title"
        class="w-full bg-transparent border-b border-border text-sm outline-none font-heading
               text-foreground mb-1 focus-visible:border-primary"
        oninput={(e) => handleTrigger(e.currentTarget, i, "title")}
        onkeydown={(e) => handleFieldKeydown(e, i, "title")}
      />
      <input
        bind:value={_events[i].date}
        type="text"
        placeholder="Date (optional)"
        class="w-full bg-transparent border-b border-border text-[11px] outline-none font-heading
               text-muted-foreground mb-1 focus-visible:border-primary"
      />
      <textarea
        bind:this={descTextarea}
        bind:value={_events[i].description}
        placeholder="Description (optional)"
        rows={2}
        class="w-full bg-transparent border-b border-border text-xs outline-none resize-none
               font-sans text-muted-foreground focus-visible:border-primary"
        oninput={(e) => handleTrigger(e.currentTarget, i, "description")}
        onkeydown={(e) => handleFieldKeydown(e, i, "description")}
      ></textarea>
    {:else}
      <!-- Display mode: date + title always visible; description collapsible on click -->

      <!-- Header row: date + title (click to edit) + chevron (click to expand/collapse) -->
      <div class="flex items-start gap-1">
        <button
          type="button"
          class="flex-1 min-w-0 text-left rounded
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          onclick={(e) => editFromHeader(e, i)}
          onkeydown={(e) => e.key === 'Enter' && startEdit(i)}
          aria-label={`Edit event: ${event.title || 'Untitled event'}`}
        >
          {#if event.date}
            <!-- Date label: Metamorphous, small, ember-muted -->
            <div class="font-heading text-[11px] leading-tight text-muted-foreground mb-0.5">
              {@html renderTimelineText(event.date, isKnownPath)}
            </div>
          {/if}
          <!-- Title: Metamorphous (world voice) -->
          <div
            class="font-heading text-sm leading-snug {event.title
              ? 'text-foreground'
              : 'text-muted-foreground/60 italic'}"
          >
            {#if event.title}{@html renderTimelineText(event.title, isKnownPath)}{:else}Untitled event{/if}
          </div>
        </button>

        {#if event.description}
          <!-- Expand/collapse toggle for description -->
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
              class="transition-transform duration-150 motion-reduce:transition-none {expandedSet.has(i) ? 'rotate-180' : ''}"
            />
          </button>
        {/if}
      </div>

      <!-- Collapsible description: grid-rows slide (snaps under prefers-reduced-motion) -->
      {#if event.description}
        <div
          class="desc-panel grid overflow-hidden transition-[grid-template-rows] duration-150 ease-out"
          style="grid-template-rows: {expandedSet.has(i) ? '1fr' : '0fr'}"
          aria-hidden={!expandedSet.has(i)}
        >
          <div class="min-h-0">
            <!-- Description: Nunito (reading prose voice) -->
            <div class="font-sans text-xs text-muted-foreground whitespace-pre-wrap pt-1 pb-1">
              {@html renderTimelineText(event.description, isKnownPath)}
            </div>
          </div>
        </div>
      {/if}
    {/if}
  </div>
{/snippet}

<div
  class="timeline-block group/block relative my-2 select-none"
  contenteditable="false"
>
  <!-- The block's only chrome, and the only way out of it: a sealed block holds every
       click, so ProseMirror never selects the node and Backspace has nothing to take
       (#175 review). Hover-revealed, in the corner the other blocks put theirs. -->
  {#if onRemove}
    <button
      type="button"
      class="absolute top-0 right-0 z-10 rounded p-0.5 cursor-pointer text-muted-foreground
             opacity-0 transition-opacity duration-150 motion-reduce:transition-none
             hover:text-destructive group-hover/block:opacity-100 focus-visible:opacity-100
             focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      aria-label="Remove timeline"
      onclick={onRemove}
    >
      <Trash2 size={13} />
    </button>
  {/if}

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
    onRowFocusOut={handleFocusOut}
  />
</div>

{#if suggestion}
  <!-- Portalled for the reason LinkedTextField's copy of this is: the prose column is
       a query container, whose layout containment would otherwise make it the
       containing block for this `fixed` dropdown. -->
  <div
    bind:this={suggestionEl}
    use:portal
    class="fixed z-50 min-w-[240px] max-h-[240px] overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-xl shadow-black/30"
    role="listbox"
    tabindex={-1}
    aria-label="Link to note"
    onmousedown={(e) => e.preventDefault()}
  >
    {#if suggestion.items.length === 0}
      <div class="px-3 py-2 font-sans text-sm text-muted-foreground/60 select-none">No notes found</div>
    {:else}
      {#each suggestion.items as item, i (item.id)}
        <button
          class="flex items-start gap-2.5 w-full px-3 py-2 text-left transition-colors {i === suggestion.selectedIndex ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}"
          role="option"
          aria-selected={i === suggestion.selectedIndex}
          onclick={() => acceptSuggestion(item)}
        >
          <FileText size={13} class="mt-0.5 shrink-0 opacity-60" />
          <div class="min-w-0">
            <div class="font-sans text-[0.8125rem] font-medium truncate">{item.title}</div>
            <div class="font-sans text-[0.7rem] text-muted-foreground/60 truncate">{item.path}</div>
          </div>
        </button>
      {/each}
    {/if}
  </div>
{/if}

<style>
  @media (prefers-reduced-motion: reduce) {
    .desc-panel {
      transition: none;
    }
  }
</style>
