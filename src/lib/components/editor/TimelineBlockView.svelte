<script lang="ts">
  import { createBlankEvent, insertEventAt, moveEventUp, moveEventDown, renderTimelineText, type TimelineEvent } from "$lib/editor/timeline-block";
  import { tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import type { NoteSearchResult } from "$lib/editor/wiki-link";
  import { FileText, ChevronDown } from "@lucide/svelte";

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

  let titleInputs: (HTMLInputElement | undefined)[] = [];
  let descTextareas: (HTMLTextAreaElement | undefined)[] = [];

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
      titleInputs[idx]?.focus();
    });
  });

  function commit() {
    suggestion = null;
    onCommit($state.snapshot(_events) as TimelineEvent[]);
    editingIndex = -1;
  }

  function handleFocusOut(e: FocusEvent, i: number) {
    if (editingIndex !== i) return;
    const related = e.relatedTarget as Node | null;
    const container = e.currentTarget as HTMLElement;
    if (related && container.contains(related)) return;
    commit();
  }

  function startEdit(i: number) {
    // Auto-expand event when entering edit mode so description is visible
    if (!expandedSet.has(i)) {
      const s = new Set(expandedSet);
      s.add(i);
      expandedSet = s;
    }
    editingIndex = i;
  }

  function toggleExpand(i: number) {
    const s = new Set(expandedSet);
    if (s.has(i)) s.delete(i); else s.add(i);
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
    // Swap expanded states for indices i and i-1
    const s = new Set(expandedSet);
    const aExp = s.has(i), bExp = s.has(i - 1);
    aExp ? s.add(i - 1) : s.delete(i - 1);
    bExp ? s.add(i) : s.delete(i);
    expandedSet = s;
    onCommit($state.snapshot(_events) as TimelineEvent[]);
  }

  function nudgeDown(i: number) {
    if (i >= _events.length - 1) return;
    _events = moveEventDown($state.snapshot(_events) as TimelineEvent[], i);
    // Swap expanded states for indices i and i+1
    const s = new Set(expandedSet);
    const aExp = s.has(i), bExp = s.has(i + 1);
    aExp ? s.add(i + 1) : s.delete(i + 1);
    bExp ? s.add(i) : s.delete(i);
    expandedSet = s;
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
    const items = await invoke<NoteSearchResult[]>("search_notes", { query }).catch(() => []);
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
    const inputs = field === "title" ? titleInputs : descTextareas;
    const currentValue = _events[eventIndex][field];
    const cursor = inputs[eventIndex]?.selectionStart ?? currentValue.length;
    const before = currentValue.slice(0, triggerStart);
    const after = currentValue.slice(cursor);
    const inserted = `[[${item.path}]]`;
    _events[eventIndex] = { ..._events[eventIndex], [field]: before + inserted + after };
    suggestion = null;
    const newCursor = triggerStart + inserted.length;
    tick().then(() => {
      inputs[eventIndex]?.focus();
      inputs[eventIndex]?.setSelectionRange(newCursor, newCursor);
    });
  }

  export function setAttrs(newEvents: TimelineEvent[]) {
    _events = newEvents;
    editingIndex = -1;
  }

  export function openEdit(index: number) {
    const s = new Set(expandedSet);
    s.add(index);
    expandedSet = s;
    editingIndex = index;
  }
</script>

{#snippet insertionPoint(index: number, label: string, visible: boolean)}
  <button
    type="button"
    class="insertion-point w-full flex items-center gap-1 h-5 rounded transition-opacity duration-100
           focus-visible:opacity-100 focus-visible:pointer-events-auto
           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
    class:opacity-0={!visible}
    class:pointer-events-none={!visible}
    onclick={() => insertAt(index)}
    aria-label={label}
  >
    <span class="flex-1 border-t border-dashed border-muted-foreground/30"></span>
    <span class="text-[10px] text-muted-foreground/60 px-1 leading-none">+</span>
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
      class="timeline-event flex items-start gap-2"
      role="group"
      aria-label={`Event ${i + 1}`}
      onfocusout={(e) => handleFocusOut(e, i)}
      onmouseenter={() => (hoveredIndex = i)}
      onmouseleave={() => (hoveredIndex = null)}
    >
      <!-- Spine column: dot + connecting line to next event -->
      <div class="flex flex-col items-center w-4 flex-none self-stretch pt-[2px]">
        <div
          class="size-[9px] rounded-full border border-primary/50 bg-background shrink-0 mt-[7px] z-10"
          aria-hidden="true"
        ></div>
        {#if i < _events.length - 1}
          <div class="flex-1 w-px bg-border/50 mt-1" aria-hidden="true"></div>
        {/if}
      </div>

      <!-- Content column -->
      <div class="flex-1 min-w-0 pb-2 relative pr-14">
        <!-- Up / down nudge controls -->
        <div class="absolute top-0 right-6 flex flex-col">
          <button
            type="button"
            class="text-[9px] text-muted-foreground leading-none p-0.5 transition-opacity
                   focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
            class:opacity-20={i === 0}
            class:cursor-not-allowed={i === 0}
            class:cursor-pointer={i !== 0}
            disabled={i === 0}
            onclick={() => nudgeUp(i)}
            tabindex="-1"
            aria-label="Move event up"
          >▲</button>
          <button
            type="button"
            class="text-[9px] text-muted-foreground leading-none p-0.5 transition-opacity
                   focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
            class:opacity-20={i === _events.length - 1}
            class:cursor-not-allowed={i === _events.length - 1}
            class:cursor-pointer={i !== _events.length - 1}
            disabled={i === _events.length - 1}
            onclick={() => nudgeDown(i)}
            tabindex="-1"
            aria-label="Move event down"
          >▼</button>
        </div>

        <!-- Delete button -->
        <button
          type="button"
          class="absolute top-0 right-0 text-muted-foreground hover:text-destructive text-xs
                 leading-none p-0.5 cursor-pointer rounded
                 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          onclick={() => deleteEvent(i)}
          tabindex="-1"
          aria-label="Delete event"
        >×</button>

        {#if editingIndex === i}
          <!-- Edit mode: all fields visible -->
          <input
            bind:this={titleInputs[i]}
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
                   text-primary/70 mb-1 focus-visible:border-primary"
          />
          <textarea
            bind:this={descTextareas[i]}
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
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
              onclick={() => startEdit(i)}
              onkeydown={(e) => e.key === 'Enter' && startEdit(i)}
              aria-label={`Edit event: ${event.title || 'Untitled'}`}
            >
              {#if event.date}
                <!-- Date label: Metamorphous, small, --primary-tinted -->
                <div class="font-heading text-[11px] leading-tight text-primary/70 mb-0.5">
                  {@html renderTimelineText(event.date)}
                </div>
              {/if}
              <!-- Title: Metamorphous (world voice) -->
              <div class="font-heading text-sm leading-snug text-foreground">
                {@html renderTimelineText(event.title || '(Untitled event)')}
              </div>
            </button>

            {#if event.description}
              <!-- Expand/collapse toggle for description -->
              <button
                type="button"
                class="shrink-0 mt-1 p-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground
                       transition-colors focus-visible:outline-none focus-visible:ring-2
                       focus-visible:ring-primary focus-visible:ring-offset-1"
                onclick={() => toggleExpand(i)}
                aria-label={expandedSet.has(i) ? `Collapse event ${i + 1}` : `Expand event ${i + 1}`}
                aria-expanded={expandedSet.has(i)}
              >
                <ChevronDown
                  size={12}
                  class="transition-transform duration-200 {expandedSet.has(i) ? 'rotate-180' : ''}"
                />
              </button>
            {/if}
          </div>

          <!-- Collapsible description: grid-rows slide (snaps under prefers-reduced-motion) -->
          {#if event.description}
            <div
              class="desc-panel grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out"
              style="grid-template-rows: {expandedSet.has(i) ? '1fr' : '0fr'}"
              aria-hidden={!expandedSet.has(i)}
            >
              <div class="min-h-0">
                <!-- Description: Nunito (reading prose voice) -->
                <div class="font-sans text-xs text-muted-foreground whitespace-pre-wrap pt-1 pb-1">
                  {@html renderTimelineText(event.description)}
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
