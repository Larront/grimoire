<script lang="ts">
  // The Quick Notes Pane (#230) — where a parked thought is found again.
  //
  // Two surfaces exist for a [[Quick Note]] and this is the reading one: the
  // dialog (#231) is a gesture that lists nothing, and this is a place. It holds
  // every Quick Note in the ledger, grouped by the day it was captured, and its
  // own capture box so a GM already looking at the list need not reach for a
  // shortcut.
  //
  // **The links here are drawn and not filed**, which inverts the Linked Text
  // Field's usual argument (ADR-0018 §Consequences): that field draws links
  // because the scanner has already filed them, and a flat field would be lying.
  // A Quick Note's links are the mirror image — drawn, clickable, and deliberately
  // absent from the Link Index, the Search Index and the graph. Drawn links are a
  // superset of filed links, and the gap is exactly this pane.
  //
  // Rows are `readonly` fields on purpose: **editing arrives with #232**, and a
  // read-only field is the absence of a control rather than a disabled one, so
  // nothing here offers a way in that does nothing.
  import { quickNotes } from "$lib/stores/quick-notes.svelte";
  import { groupByCaptureDay } from "$lib/utils/quick-note-days";
  import { linkResolver } from "$lib/stores/link-resolver.svelte";
  import { stripWikiFragment } from "$lib/editor/wiki-target";
  import { tabs } from "$lib/stores/tabs.svelte";
  import LinkedTextField from "$lib/components/editor/LinkedTextField.svelte";
  import WikiCaptureBox from "$lib/components/editor/WikiCaptureBox.svelte";

  // The day the pane thinks it is, re-read when the local day turns over. A
  // session that crosses midnight is the ordinary case here, and without this the
  // heading over yesterday's thoughts still reads "Today" while a fresh capture
  // opens a second, correctly dated group beside it.
  let today = $state(new Date());

  $effect(() => {
    const midnight = new Date(today);
    midnight.setHours(24, 0, 0, 0);
    const timer = setTimeout(() => (today = new Date()), midnight.getTime() - Date.now());
    return () => clearTimeout(timer);
  });

  const days = $derived(groupByCaptureDay(quickNotes.notes, today));

  async function capture(body: string) {
    // Deliberately un-caught: `api` has already told the GM the write failed, and
    // the rejection is what puts the line back in the box — a thought that never
    // reached the ledger exists nowhere else.
    await quickNotes.capture(body);
  }

  /**
   * A click on a drawn link opens the note it names.
   *
   * Unlike prose, an unresolved target does **nothing**: in the editor a click on
   * a stub creates the note, but writing a note out of the pen would be filing —
   * and ADR-0018 is explicit that filed links arrive when the Quick Note does
   * (#229). Until then a broken link stays drawn, faded, and inert.
   */
  async function handleClick(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest<HTMLElement>("[data-wiki-link]");
    if (!link?.dataset.path) return;
    const note = await linkResolver.resolve(stripWikiFragment(link.dataset.path)).catch(() => null);
    // `navigateOpen`, as the Graph does it: a note already open is switched to
    // rather than opened a second time, and the pane stays one step back.
    if (note) tabs.navigateOpen({ type: "note", id: note.id, title: note.title });
  }
</script>

<div data-quick-notes-pane class="flex flex-1 min-h-0 flex-col overflow-hidden">
  <!-- Pinned above the list, so the box a GM types into never scrolls away. -->
  <div class="shrink-0 border-b border-border px-8 pt-8 pb-5">
    <div class="mx-auto w-full max-w-3xl">
      <h1 class="font-sans text-3xl font-semibold tracking-tight text-foreground">Quick Notes</h1>
      <div class="mt-3 h-px bg-linear-to-r from-primary/30 via-primary/10 to-transparent"></div>
      <div class="relative mt-5">
        <WikiCaptureBox
          ariaLabel="Capture a Quick Note"
          placeholder="Park a thought…"
          onCommit={capture}
        />
      </div>
    </div>
  </div>

  <!-- Delegated the way prose delegates it (`Editor.svelte`): one handler over the
       list rather than a handler per drawn link, so the same posture holds however
       many Quick Notes the pen is holding. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="flex-1 min-h-0 overflow-y-auto px-8 py-6" onclick={handleClick}>
    <div class="mx-auto w-full max-w-3xl">
      {#if days.length === 0}
        <!-- One warm line in the world voice, and nothing else: an empty pen needs
             no illustration, no example rows and no explanation of itself. -->
        <p data-quick-notes-empty class="mt-16 text-center text-sm text-muted-foreground italic">
          Thoughts that arrived before their place did.
        </p>
      {:else}
        {#each days as day (day.key)}
          <section data-capture-day={day.key} class="mb-8 last:mb-0">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
              {day.label}
            </h2>
            <ul class="mt-3 flex flex-col gap-1.5">
              {#each day.notes as note (note.id)}
                <li
                  data-quick-note={note.id}
                  class="rounded-lg bg-card/60 px-3 py-2 text-sm text-foreground"
                >
                  <LinkedTextField
                    value={note.body}
                    ariaLabel="Quick Note"
                    readonly
                    class="text-sm leading-relaxed"
                  />
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      {/if}
    </div>
  </div>
</div>
