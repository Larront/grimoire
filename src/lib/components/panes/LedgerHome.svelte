<script lang="ts" module>
  /*
    The world's home: what an empty pane shows.

    Revised in the 2026-10 design review. It showed only while a world had no notes —
    after the first one, an empty pane said "No tab open" and the world's name was
    never seen again — and it did not read as the page after the Splash. It is now the
    Splash's right-hand column carried into the world, in every empty pane: the
    world's name at Title size, what is in it, one primary next step (New note), and
    the notes last written in, to go back to. "Every world begins with its first note"
    is said only while that is true.

    New note takes focus once, when a world opens onto this page (as the Splash's
    Continue does), so Enter writes the first note; closing tabs later does not pull
    focus here. A failure is said by the toast the call raises, once.
  */
  /** The world open when New note last took focus on arrival. */
  let arrivedFor = -1;
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import type { Note } from "$lib/types/ledger";
  import { Button } from "$lib/components/ui/button";
  import { ledger } from "$lib/stores/ledger.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { scenes } from "$lib/stores/scenes.svelte";
  import { maps } from "$lib/stores/maps.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { dialogs } from "$lib/stores/overlay.svelte";
  import { shell } from "$lib/utils/shell-actions";
  import { createUntitledNote } from "$lib/utils/note-actions";
  import { timeAgo, worldContents } from "$lib/utils/world-words";
  import { needsAttention, type AttentionKind } from "$lib/stores/needs-attention.svelte";
  import {
    ArrowRight,
    FileText,
    FileWarning,
    Link2Off,
    LoaderCircle,
    MapPinOff,
  } from "@lucide/svelte";

  const ATTENTION_ICONS: Record<AttentionKind, typeof FileText> = {
    pins: MapPinOff,
    notes: FileWarning,
    links: Link2Off,
    repairs: Link2Off,
  };
  const quietLink =
    "rounded-sm text-(length:--font-ui) text-foreground-muted underline decoration-border underline-offset-2 hover:text-foreground";

  let { pane }: { pane: "left" | "right" } = $props();

  const RECENT = 5;

  let creating = $state(false);
  let newNote = $state<HTMLButtonElement | null>(null);

  const worldName = $derived(ledger.worldName);
  const written = $derived(notes.notes.filter((n) => !n.archived));
  const contents = $derived(
    worldContents({
      note_count: written.length,
      scene_count: scenes.scenes.length,
      map_count: maps.maps.length,
    }),
  );
  /** The notes as read when this page appeared, with their latest modified times. */
  let freshNotes = $state<Note[] | null>(null);
  const recent = $derived(
    (freshNotes ?? written)
      .filter((n) => !n.archived)
      .sort((a, b) => b.modified_at.localeCompare(a.modified_at))
      .slice(0, RECENT),
  );

  // New note takes focus on arrival only — the first time this world shows its
  // home in the focused pane, and only if nothing else has focus.
  // Saves move a note's modified time on the backend, not in the shared list, so
  // read it afresh for "Recently edited" — when this page appears and whenever the
  // list changes (a note made in the other pane). Here, not through `notes.load()`,
  // whose loading state is what decides whether this page is shown at all.
  $effect(() => {
    void notes.notes;
    api.silent
      .getNotes()
      .then((fresh) => (freshNotes = fresh))
      .catch(() => {});
  });

  onMount(() => {
    const generation = ledger.openGeneration;
    if (arrivedFor === generation || pane !== tabs.focusedPane) return;
    arrivedFor = generation;
    const focused = document.activeElement;
    if (!focused || focused === document.body) newNote?.focus();
  });

  async function writeNote() {
    tabs.setFocusedPane(pane);
    creating = true;
    try {
      await createUntitledNote();
    } catch (e) {
      // Said by the toast the call raised.
      console.error("create note failed:", e);
    } finally {
      creating = false;
    }
  }

  function openNote(id: number, title: string) {
    tabs.openTab({ type: "note", id, title }, pane);
  }
</script>

<div class="h-full overflow-y-auto" data-pane-scroll>
  <div class="mx-auto flex w-full max-w-[34rem] flex-col px-8 pt-[16vh] pb-16 splash-fade">
    <h2
      class="line-clamp-3 font-heading text-[2.75rem] leading-[1.15] tracking-tight text-foreground text-balance"
      title={worldName}
    >
      {worldName}
    </h2>
    {#if ledger.isSample}
      <!-- The example says what it is here, where a GM lands, rather than in a strip
           over every pane: that it is an example, that what they change is kept (it
           continues, and only "Start it over" on the Splash resets it), and how to keep
           it as theirs. -->
      <p class="mt-3 text-(length:--font-body) text-foreground-muted" data-testid="home-example">
        An example world · {contents}
      </p>
      <p class="mt-1 text-(length:--font-body) text-foreground-muted">
        What you change here is kept for next time.
      </p>
    {:else}
      <p class="mt-3 text-(length:--font-body) text-foreground-muted">
        {written.length ? contents : "Every world begins with its first note."}
      </p>
    {/if}

    <div class="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
      <Button
        bind:ref={newNote}
        size="lg"
        class="h-10 min-w-[8.5rem] gap-2 px-4 text-sm"
        disabled={creating}
        data-testid="home-new-note"
        onclick={() => void writeNote()}
      >
        {#if creating}
          <LoaderCircle class="animate-spin" />
          Creating…
        {:else}
          New note
          <ArrowRight data-icon="inline-end" />
        {/if}
      </Button>
      {#if ledger.isSample}
        <button
          type="button"
          data-testid="home-make-mine"
          class={quietLink}
          onclick={() => (dialogs.adoptOpen = true)}
        >
          Make this world mine
        </button>
      {:else}
        <button
          type="button"
          data-testid="start-from-template"
          class={quietLink}
          onclick={shell.openTemplatePicker}
        >
          Note from template…
        </button>
      {/if}
    </div>

    <!-- What the world needs from the GM, here as in the world menu, each with the one
         thing to do about it. It replaced three lasting toasts (2026-10 design review). -->
    {#if needsAttention.items.length}
      <section class="mt-12" aria-labelledby="home-attention-{pane}" data-testid="home-attention">
        <h3 id="home-attention-{pane}" class="text-xs font-semibold text-foreground-muted">
          Needs attention
        </h3>
        <ul class="mt-2 flex flex-col gap-2.5">
          {#each needsAttention.items as item (item.key)}
            {@const Icon = ATTENTION_ICONS[item.kind]}
            <li class="flex items-start gap-3">
              <Icon class="mt-0.5 size-4 shrink-0 text-foreground-muted" strokeWidth={1.5} />
              <div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                <span class="text-(length:--font-body) text-foreground">{item.label}</span>
                <button type="button" class={quietLink} onclick={() => void item.action.run()}>
                  {item.action.label}
                </button>
                {#if item.dismiss}
                  <button type="button" class={quietLink} onclick={item.dismiss.run}>
                    {item.dismiss.label}
                  </button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if recent.length}
      <section class="mt-14" aria-labelledby="home-recent-{pane}">
        <h3 id="home-recent-{pane}" class="text-xs font-semibold text-foreground-muted">
          Recently edited
        </h3>
        <!-- Pulled out by the rows' own padding, so names line up with the one above. -->
        <ul class="-mx-3 mt-2 flex flex-col">
          {#each recent as note (note.id)}
            <li>
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-surface-hover"
                data-testid="home-recent-note"
                onclick={() => openNote(note.id, note.title)}
              >
                <FileText class="size-4 shrink-0 text-foreground-muted" strokeWidth={1.5} />
                <span class="min-w-0 flex-1 truncate text-(length:--font-body) text-foreground" title={note.title}
                  >{note.title}</span
                >
                <span class="shrink-0 text-(length:--font-ui) text-foreground-muted"
                  >{timeAgo(note.modified_at)}</span
                >
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
</div>
