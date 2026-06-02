<script lang="ts">
  import type { TimelineEvent } from "$lib/editor/timeline-block";
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
    _events = (_events as TimelineEvent[]).filter((_, idx) => idx !== i);
    editingIndex = -1;
    onCommit($state.snapshot(_events) as TimelineEvent[]);
  }

  function addEvent() {
    const newEvent: TimelineEvent = { date: "", title: "", description: "" };
    _events = [...(_events as TimelineEvent[]), newEvent];
    editingIndex = _events.length - 1;
  }

  export function setAttrs(newEvents: TimelineEvent[]) {
    _events = newEvents;
    editingIndex = -1;
  }

  export function openEdit(index: number) {
    editingIndex = index;
  }
</script>

<div class="timeline-block my-1 select-none" contenteditable="false">
  {#if _events.length === 0}
    <div class="text-xs text-muted-foreground font-sans italic mb-2">No events yet</div>
  {/if}

  {#each _events as event, i (i)}
    <div
      class="timeline-event relative mb-2 pr-6"
      onfocusout={(e) => handleFocusOut(e, i)}
    >
      <!-- Delete button (always visible) -->
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
        <div role="button" tabindex={0} onclick={() => startEdit(i)} onkeydown={(e) => e.key === 'Enter' && startEdit(i)}>
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

  <button
    type="button"
    class="text-xs text-muted-foreground hover:text-foreground cursor-pointer mt-1"
    onclick={addEvent}
  >
    + Add event
  </button>
</div>
