<script lang="ts">
  import { createBlankEvent, insertEventAt, moveEventUp, moveEventDown, type TimelineEvent } from "$lib/editor/timeline-block";
  import { tick } from "svelte";

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

  $effect(() => {
    const idx = editingIndex;
    if (idx < 0 || idx >= _events.length) return;
    tick().then(() => {
      titleInputs[idx]?.focus();
    });
  });

  function commit() {
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

  // A gap before event g is hover-revealed when hovering either event it sits
  // between (event g-1 or event g). The trailing append gap is always visible
  // and rendered separately, so it does not go through here.
  function gapVisible(g: number): boolean {
    return hoveredIndex === g - 1 || hoveredIndex === g;
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
        />
        <input
          bind:value={event.date}
          type="text"
          placeholder="Date (optional)"
          class="w-full bg-transparent border-b border-border text-xs outline-none text-muted-foreground font-sans mb-1"
        />
        <textarea
          bind:value={event.description}
          placeholder="Description (optional)"
          rows={2}
          class="w-full bg-transparent border-b border-border text-xs outline-none resize-none text-muted-foreground font-sans"
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
            <div class="text-xs text-muted-foreground font-sans">{event.date}</div>
          {/if}
          <div class="font-heading text-sm font-semibold text-foreground">{event.title}</div>
          {#if event.description}
            <div class="text-xs text-muted-foreground font-sans whitespace-pre-wrap">{event.description}</div>
          {/if}
        </div>
      {/if}
    </div>
  {/each}

  <!-- Trailing gap: appends to the end; always visible (subsumes the empty-state add) -->
  {@render insertionPoint(_events.length, "Add event", true)}
</div>
