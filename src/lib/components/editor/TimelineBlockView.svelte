<script lang="ts">
  import { createBlankEvent, insertEventAt, moveEventUp, moveEventDown, renderTimelineText, type TimelineEvent } from "$lib/editor/timeline-block";
  import { tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import type { NoteSearchResult } from "$lib/editor/wiki-link";
  import { FileText } from "@lucide/svelte";

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
    editingIndex = i;
  }

  function deleteEvent(i: number) {
    _events = _events.filter((_, idx) => idx !== i);
    editingIndex = -1;
    onCommit($state.snapshot(_events) as TimelineEvent[]);
  }

  function insertAt(index: number) {
    _events = insertEventAt($state.snapshot(_events) as TimelineEvent[], index, createBlankEvent());
    editingIndex = index;
  }

  function nudgeUp(i: number) {
    if (i <= 0) return;
    _events = moveEventUp($state.snapshot(_events) as TimelineEvent[], i);
    onCommit($state.snapshot(_events) as TimelineEvent[]);
  }

  function nudgeDown(i: number) {
    if (i >= _events.length - 1) return;
    _events = moveEventDown($state.snapshot(_events) as TimelineEvent[], i);
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
    const el = field === "title" ? titleInputs[eventIndex] : descTextareas[eventIndex];
    const currentValue =
      field === "title" ? _events[eventIndex].title : _events[eventIndex].description;
    const cursor = el?.selectionStart ?? currentValue.length;
    const before = currentValue.slice(0, triggerStart);
    const after = currentValue.slice(cursor);
    const inserted = `[[${item.path}]]`;
    const newValue = before + inserted + after;
    if (field === "title") {
      _events[eventIndex] = { ..._events[eventIndex], title: newValue };
    } else {
      _events[eventIndex] = { ..._events[eventIndex], description: newValue };
    }
    suggestion = null;
    const newCursor = triggerStart + inserted.length;
    tick().then(() => {
      const fieldEl = field === "title" ? titleInputs[eventIndex] : descTextareas[eventIndex];
      fieldEl?.focus();
      fieldEl?.setSelectionRange(newCursor, newCursor);
    });
  }

  export function setAttrs(newEvents: TimelineEvent[]) {
    _events = newEvents;
    editingIndex = -1;
  }

  export function openEdit(index: number) {
    editingIndex = index;
  }
</script>

{#snippet insertionPoint(index: number, label: string, visible: boolean)}
  <button
    type="button"
    class="insertion-point w-full flex items-center gap-1 h-5 mb-0.5 rounded transition-opacity duration-100 focus-visible:opacity-100 focus-visible:pointer-events-auto"
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

<div class="timeline-block my-1 select-none" contenteditable="false">
  {#if _events.length === 0}
    <div class="text-xs text-muted-foreground font-sans italic mb-1">No events yet</div>
  {/if}

  {#each _events as event, i (i)}
    <!-- Gap before event i (hover-revealed, focus-visible) -->
    {@render insertionPoint(
      i,
      i === 0 ? "Insert event at top" : `Insert event after position ${i}`,
      gapVisible(i),
    )}

    <div
      class="timeline-event relative pr-14"
      role="group"
      aria-label={`Event ${i + 1}`}
      onfocusout={(e) => handleFocusOut(e, i)}
      onmouseenter={() => (hoveredIndex = i)}
      onmouseleave={() => (hoveredIndex = null)}
    >
      <!-- Up / down nudge controls -->
      <div class="absolute top-0 right-6 flex flex-col">
        <button
          type="button"
          class="text-[9px] text-muted-foreground leading-none p-0.5 transition-opacity"
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
          class="text-[9px] text-muted-foreground leading-none p-0.5 transition-opacity"
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
        class="absolute top-0 right-0 text-muted-foreground hover:text-destructive text-xs leading-none p-0.5 cursor-pointer"
        onclick={() => deleteEvent(i)}
        tabindex="-1"
        aria-label="Delete event"
      >
        ×
      </button>

      {#if editingIndex === i}
        <!-- Edit mode -->
        <input
          bind:this={titleInputs[i]}
          bind:value={event.title}
          type="text"
          placeholder="Title"
          class="w-full bg-transparent border-b border-border text-sm outline-none font-heading font-semibold text-foreground mb-1"
          oninput={(e) => handleTrigger(e.currentTarget, i, "title")}
          onkeydown={(e) => handleFieldKeydown(e, i, "title")}
        />
        <input
          bind:value={event.date}
          type="text"
          placeholder="Date (optional)"
          class="w-full bg-transparent border-b border-border text-xs outline-none text-muted-foreground font-sans mb-1"
        />
        <textarea
          bind:this={descTextareas[i]}
          bind:value={event.description}
          placeholder="Description (optional)"
          rows={2}
          class="w-full bg-transparent border-b border-border text-xs outline-none resize-none text-muted-foreground font-sans"
          oninput={(e) => handleTrigger(e.currentTarget, i, "description")}
          onkeydown={(e) => handleFieldKeydown(e, i, "description")}
        ></textarea>
      {:else}
        <!-- Display mode -->
        <div
          role="button"
          tabindex={0}
          onclick={() => startEdit(i)}
          onkeydown={(e) => e.key === 'Enter' && startEdit(i)}
          class="mb-1.5"
        >
          {#if event.date}
            <div class="text-xs text-muted-foreground font-sans">{@html renderTimelineText(event.date)}</div>
          {/if}
          <div class="font-heading text-sm font-semibold text-foreground">{@html renderTimelineText(event.title)}</div>
          {#if event.description}
            <div class="text-xs text-muted-foreground font-sans whitespace-pre-wrap">{@html renderTimelineText(event.description)}</div>
          {/if}
        </div>
      {/if}
    </div>
  {/each}

  <!-- Trailing gap: appends to the end; always visible (subsumes the empty-state add) -->
  {@render insertionPoint(_events.length, "Add event", true)}
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
