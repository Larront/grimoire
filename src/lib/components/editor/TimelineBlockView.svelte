<script lang="ts">
  import type { TimelineEvent } from "$lib/editor/timeline-block";

  let { events }: { events: TimelineEvent[] } = $props();

  // svelte-ignore state_referenced_locally
  let _events = $state(events);

  export function setAttrs(newEvents: TimelineEvent[]) {
    _events = newEvents;
  }
</script>

<div class="timeline-block my-1 select-none" contenteditable="false">
  {#each _events as event, i (i)}
    <div class="timeline-event mb-2">
      {#if event.date}
        <div class="text-xs text-muted-foreground font-sans">{event.date}</div>
      {/if}
      <div class="font-heading text-sm font-semibold text-foreground">{event.title}</div>
      {#if event.description}
        <div class="text-xs text-muted-foreground font-sans whitespace-pre-wrap">{event.description}</div>
      {/if}
    </div>
  {/each}
</div>
