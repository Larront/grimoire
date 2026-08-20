<script lang="ts">
  // The Quick Notes Pane (#230, #232) — where a parked thought is found again.
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
  // Everything a GM does to a Quick Note short of filing it (#229) is here, and
  // the four affordances answer four different fears:
  //
  //   * **Fix one** — the row takes the Linked Text Field's ordinary posture, so a
  //     typo costs a click and one write. Links stay drawn and stay unfiled.
  //   * **Forget one** — deferred behind the same undo toast pin deletion uses. A
  //     mis-click mid-session must not cost a thought.
  //   * **Find one** — a text filter, never Tantivy: ADR-0018 keeps the Search
  //     Index blind to this table, so retrieval inside the pen is a substring over
  //     the rows already loaded.
  //   * **Read it from the other end** — a newest/oldest toggle, because clearing a
  //     list is work you do from the bottom.
  //
  // Filtering and sorting are derivations of the list and nothing else: no command
  // is called, no row is rewritten, and the ledger holds exactly what it held.
  import { Search, Trash2, ArrowDownWideNarrow, ArrowUpNarrowWide } from "@lucide/svelte";
  import { quickNotes } from "$lib/stores/quick-notes.svelte";
  import { groupByCaptureDay, type CaptureOrder } from "$lib/utils/quick-note-days";
  import { filterQuickNotes } from "$lib/utils/quick-note-search";
  import { linkedPlainText } from "$lib/editor/linked-text";
  import { linkResolver } from "$lib/stores/link-resolver.svelte";
  import { stripWikiFragment } from "$lib/editor/wiki-target";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { toastUndo } from "$lib/toast";
  import LinkedTextField from "$lib/components/editor/LinkedTextField.svelte";
  import WikiCaptureBox from "$lib/components/editor/WikiCaptureBox.svelte";
  import type { QuickNote } from "$lib/bindings.gen";

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

  let query = $state("");
  let order = $state<CaptureOrder>("newest");

  // Rows whose undo window is still open. They leave the list the instant the GM
  // clicks and stay in the ledger the whole time — which is what makes undo
  // lossless (see `toastUndo`); a row that lingered for five seconds would read as
  // a button that failed.
  let forgetting = $state<number[]>([]);

  const held = $derived(quickNotes.notes.filter((note) => !forgetting.includes(note.id)));
  const matching = $derived(filterQuickNotes(held, query));
  const days = $derived(groupByCaptureDay(matching, today, order));
  const filtering = $derived(query.trim().length > 0);

  async function capture(body: string) {
    // Deliberately un-caught: `api` has already told the GM the write failed, and
    // the rejection is what puts the line back in the box — a thought that never
    // reached the ledger exists nowhere else.
    await quickNotes.capture(body);
    // A capture drops the filter, because the alternative is worse: a line
    // committed while a filter it does not match is active would land in the ledger
    // and vanish from the screen, which reads exactly like a write that failed.
    query = "";
  }

  /**
   * Commit an edited line.
   *
   * Nothing is caught back into the row: a failed write has already been reported
   * by `api`, and the field draws the value the ledger still holds — so refusing
   * the edit *is* the rollback. An emptied field is refused by the store for the
   * same reason: forgetting a thought is the button beside it, which is undoable.
   */
  function commitEdit(note: QuickNote, body: string) {
    void quickNotes.edit(note.id, body).catch(() => {});
  }

  /**
   * Forget one thought, with the window to change your mind that pin deletion has.
   *
   * The toast echoes the line as the pane drew it — links as their titles, not as
   * `[[targets]]` — because a GM clearing a session's pen has several similar
   * thoughts on screen and needs to know which one left.
   */
  function forget(note: QuickNote) {
    forgetting = [...forgetting, note.id];
    const done = () => (forgetting = forgetting.filter((id) => id !== note.id));
    toastUndo(
      `"${toastLine(note.body)}" deleted`,
      async () => {
        // A failed delete has been toasted by `api` and the row is still in the
        // ledger, so putting it back on screen is the honest thing either way.
        await quickNotes.remove(note.id).catch(() => {});
        done();
      },
      done,
    );
  }

  /** The line, short enough to sit in a toast beside an Undo button. */
  function toastLine(body: string) {
    const line = linkedPlainText(body).trim();
    return line.length > 48 ? `${line.slice(0, 47).trimEnd()}…` : line;
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

      <!-- Only once there is a list to work on: a filter box and a sort toggle over
           an empty pen are two controls that can do nothing. -->
      {#if quickNotes.notes.length > 0}
        <div class="mt-3 flex items-center gap-2">
          <div class="relative flex-1">
            <Search
              class="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50 pointer-events-none"
            />
            <input
              data-quick-notes-filter
              type="text"
              aria-label="Find a Quick Note"
              placeholder="Find a thought…"
              bind:value={query}
              onkeydown={(e) => {
                // Escape clears rather than blurs: the way out of a filter is
                // seeing the whole list again.
                if (e.key === "Escape") {
                  e.preventDefault();
                  query = "";
                }
              }}
              class="w-full rounded-md border border-border/60 bg-background py-1.5 pl-8 pr-2 font-sans text-xs
                     text-foreground placeholder:text-muted-foreground/40 transition-colors
                     focus:border-primary/60 focus:outline-none"
            />
          </div>
          <button
            type="button"
            data-quick-notes-order={order}
            aria-label={order === "newest"
              ? "Sorted newest first — read oldest first instead"
              : "Sorted oldest first — read newest first instead"}
            onclick={() => (order = order === "newest" ? "oldest" : "newest")}
            class="flex shrink-0 items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5
                   font-sans text-xs text-muted-foreground transition-colors cursor-pointer
                   hover:border-primary/60 hover:text-foreground focus-visible:outline-none
                   focus-visible:ring-2 focus-visible:ring-primary"
          >
            {#if order === "newest"}
              <ArrowDownWideNarrow class="size-3.5" />
              Newest
            {:else}
              <ArrowUpNarrowWide class="size-3.5" />
              Oldest
            {/if}
          </button>
        </div>
      {/if}
    </div>
  </div>

  <!-- Delegated the way prose delegates it (`Editor.svelte`): one handler over the
       list rather than a handler per drawn link, so the same posture holds however
       many Quick Notes the pen is holding. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="flex-1 min-h-0 overflow-y-auto px-8 py-6" onclick={handleClick}>
    <div class="mx-auto w-full max-w-3xl">
      {#if days.length === 0 && filtering}
        <!-- A filter matching nothing is not an empty pen, and saying so would be
             alarming: the thoughts are all still there, behind the query. -->
        <p data-quick-notes-no-match class="mt-16 text-center text-sm text-muted-foreground italic">
          Nothing here matches that.
        </p>
      {:else if days.length === 0}
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
                  class="group flex items-start gap-2 rounded-lg bg-card/60 px-3 py-2 text-sm text-foreground"
                >
                  <div class="min-w-0 flex-1">
                    <LinkedTextField
                      value={note.body}
                      ariaLabel="Quick Note"
                      onCommit={(next) => commitEdit(note, next)}
                      class="text-sm leading-relaxed"
                    />
                  </div>
                  <!-- Quiet until the row is under the pointer or the button is
                       tabbed to: a column of bins down a session's worth of thoughts
                       would be the loudest thing in the pane. Always in the DOM, so
                       it stays reachable by keyboard. -->
                  <button
                    type="button"
                    data-quick-note-delete={note.id}
                    aria-label="Delete Quick Note"
                    onclick={() => forget(note)}
                    class="shrink-0 rounded p-1 text-muted-foreground/50 opacity-0 transition
                           cursor-pointer hover:bg-destructive/10 hover:text-destructive
                           group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none
                           focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Trash2 class="size-3.5" />
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      {/if}
    </div>
  </div>
</div>
