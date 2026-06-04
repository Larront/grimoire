<script lang="ts">
  import { createBlankEvent, insertEventAt, moveEventUp, moveEventDown, renderTimelineText, type TimelineEvent } from "$lib/editor/timeline-block";
  import { tick } from "svelte";
  import { api } from "$lib/api";
  import type { NoteSearchResult } from "$lib/editor/wiki-link";
  import { notes } from "$lib/stores/notes.svelte";
  import { FileText, ChevronDown, ChevronUp, X, Plus } from "@lucide/svelte";

  // Wikilink stub-vs-resolved styling. A link is "known" if it would navigate —
  // i.e. its path matches a note, or (mirroring Editor.svelte's click handler) it
  // resolves via an alias. Alias lookups are async, so results are cached here and
  // consulted by isKnownPath. A path that hasn't resolved yet defaults to known
  // (full accent) so a real link is never briefly shown as a faded, unclickable
  // stub; only paths that fail both checks settle to broken.
  let linkResolution = $state(new Map<string, boolean>());

  const isKnownPath = (path: string) => linkResolution.get(path) ?? true;

  $effect(() => {
    const paths = new Set<string>();
    for (const ev of _events) {
      for (const field of [ev.date, ev.title, ev.description]) {
        for (const m of field.matchAll(/\[\[([^\]]+)\]\]/g)) {
          const inner = m[1].trim();
          const pipe = inner.indexOf("|");
          paths.add((pipe >= 0 ? inner.slice(0, pipe) : inner).trim());
        }
      }
    }
    const noteList = notes.notes; // tracked: re-resolve when the ledger's notes load/change
    let cancelled = false;
    (async () => {
      const next = new Map<string, boolean>();
      for (const p of paths) {
        if (noteList.some((n) => n.path === p)) {
          next.set(p, true);
        } else {
          const resolved = await api.resolveNoteByAlias(p).catch(() => null);
          next.set(p, resolved != null);
        }
      }
      if (!cancelled) linkResolution = next;
    })();
    return () => {
      cancelled = true;
    };
  });

  let {
    events,
    onCommit,
  }: {
    events: TimelineEvent[];
    onCommit: (events: TimelineEvent[]) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let _events = $state<TimelineEvent[]>(events);
  let editingIndex = $state(-1);
  let hoveredIndex = $state<number | null>(null);
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
    triggerStart: number;
    eventIndex: number;
    field: "title" | "description";
  }
  let suggestion = $state<SuggestionState | null>(null);

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

  function handleFocusOut(e: FocusEvent, i: number) {
    if (editingIndex !== i) return;
    const container = e.currentTarget as HTMLElement;
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

  // Swap the expanded state of two indices after reordering them
  function swapExpanded(a: number, b: number) {
    const s = new Set(expandedSet);
    const aExp = s.has(a), bExp = s.has(b);
    if (bExp) s.add(a); else s.delete(a);
    if (aExp) s.add(b); else s.delete(b);
    expandedSet = s;
  }

  function deleteEvent(i: number) {
    _events = _events.filter((_, idx) => idx !== i);
    // Compact expanded set: remove i, shift indices > i down by 1
    const shifted = new Set<number>();
    for (const idx of expandedSet) {
      if (idx === i) continue;
      shifted.add(idx > i ? idx - 1 : idx);
    }
    expandedSet = shifted;
    editingIndex = -1;
    onCommit($state.snapshot(_events) as TimelineEvent[]);
  }

  function insertAt(index: number) {
    _events = insertEventAt($state.snapshot(_events) as TimelineEvent[], index, createBlankEvent());
    // Shift expanded indices >= index up by 1, then auto-expand new event
    const shifted = new Set<number>();
    for (const idx of expandedSet) {
      shifted.add(idx >= index ? idx + 1 : idx);
    }
    shifted.add(index);
    expandedSet = shifted;
    editingIndex = index;
  }

  function nudgeUp(i: number) {
    if (i <= 0) return;
    _events = moveEventUp($state.snapshot(_events) as TimelineEvent[], i);
    swapExpanded(i, i - 1);
    onCommit($state.snapshot(_events) as TimelineEvent[]);
  }

  function nudgeDown(i: number) {
    if (i >= _events.length - 1) return;
    _events = moveEventDown($state.snapshot(_events) as TimelineEvent[], i);
    swapExpanded(i, i + 1);
    onCommit($state.snapshot(_events) as TimelineEvent[]);
  }

  function gapVisible(g: number): boolean {
    return hoveredIndex === g - 1 || hoveredIndex === g;
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

  export function setAttrs(newEvents: TimelineEvent[]) {
    _events = newEvents;
    editingIndex = -1;
  }

  export function openEdit(index: number) {
    startEdit(index);
  }
</script>

{#snippet insertionPoint(index: number, label: string, visible: boolean)}
  <button
    type="button"
    class="insertion-point w-full flex items-center gap-1 h-5 rounded transition-opacity duration-150 motion-reduce:transition-none
           focus-visible:opacity-100 focus-visible:pointer-events-auto
           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    class:opacity-0={!visible}
    class:pointer-events-none={!visible}
    onclick={() => insertAt(index)}
    aria-label={label}
  >
    <span class="flex-1 border-t border-dashed border-muted-foreground/30"></span>
    <Plus size={11} class="text-muted-foreground/60 shrink-0" aria-hidden="true" />
    <span class="flex-1 border-t border-dashed border-muted-foreground/30"></span>
  </button>
{/snippet}

<div class="timeline-block my-2 select-none" contenteditable="false">
  {#if _events.length === 0}
    <div class="ml-6 text-xs text-muted-foreground font-sans italic mb-1">No events yet</div>
  {/if}

  {#each _events as event, i (i)}
    <!-- Gap before event i (hover-revealed, focus-visible) — offset to align with content column -->
    <div class="pl-6">
      {@render insertionPoint(
        i,
        i === 0 ? "Insert event at top" : `Insert event after position ${i}`,
        gapVisible(i),
      )}
    </div>

    <!-- Event row: spine column + content column -->
    <div
      class="timeline-event group flex items-start gap-2"
      role="group"
      aria-label={`Event ${i + 1}`}
      onfocusout={(e) => handleFocusOut(e, i)}
      onmouseenter={() => (hoveredIndex = i)}
      onmouseleave={() => (hoveredIndex = null)}
    >
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

      <!-- Content column -->
      <div class="flex-1 min-w-0 pb-2 relative pr-14">
        <!-- Up / down nudge controls — revealed on hover / keyboard focus -->
        <div
          class="absolute top-0 right-6 flex flex-col opacity-0 transition-opacity duration-150 motion-reduce:transition-none
                 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <button
            type="button"
            class="p-0.5 rounded text-muted-foreground hover:text-foreground cursor-pointer
                   disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-muted-foreground
                   focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            disabled={i === 0}
            onclick={() => nudgeUp(i)}
            aria-label="Move event up"
          >
            <ChevronUp size={13} />
          </button>
          <button
            type="button"
            class="p-0.5 rounded text-muted-foreground hover:text-foreground cursor-pointer
                   disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-muted-foreground
                   focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            disabled={i === _events.length - 1}
            onclick={() => nudgeDown(i)}
            aria-label="Move event down"
          >
            <ChevronDown size={13} />
          </button>
        </div>

        <!-- Delete button — revealed on hover / keyboard focus -->
        <button
          type="button"
          class="absolute top-0 right-0 p-0.5 rounded cursor-pointer text-muted-foreground hover:text-destructive
                 opacity-0 transition-opacity duration-150 motion-reduce:transition-none
                 group-hover:opacity-100 group-focus-within:opacity-100
                 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          onclick={() => deleteEvent(i)}
          aria-label="Delete event"
        >
          <X size={13} />
        </button>

        {#if editingIndex === i}
          <!-- Edit mode: all fields visible -->
          <input
            bind:this={titleInput}
            bind:value={event.title}
            type="text"
            placeholder="Title"
            class="w-full bg-transparent border-b border-border text-sm outline-none font-heading
                   text-foreground mb-1 focus-visible:border-primary"
            oninput={(e) => handleTrigger(e.currentTarget, i, "title")}
            onkeydown={(e) => handleFieldKeydown(e, i, "title")}
          />
          <input
            bind:value={event.date}
            type="text"
            placeholder="Date (optional)"
            class="w-full bg-transparent border-b border-border text-[11px] outline-none font-heading
                   text-muted-foreground mb-1 focus-visible:border-primary"
          />
          <textarea
            bind:this={descTextarea}
            bind:value={event.description}
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
    </div>
  {/each}

  <!-- Trailing gap: always visible — offset to align with content column -->
  <div class="pl-6">
    {@render insertionPoint(_events.length, "Add event", true)}
  </div>
</div>

{#if suggestion}
  <div
    class="fixed z-50 min-w-[240px] max-h-[240px] overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-xl shadow-black/30"
    style="left: {suggestion.x}px; top: {suggestion.y}px;"
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
