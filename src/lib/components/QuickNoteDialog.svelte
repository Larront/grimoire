<script lang="ts">
  // The Quick Notes Dialog (#231) — the same capture, now from anywhere.
  //
  // A GM four players deep into a scene presses `Ctrl/Cmd+Shift+N`, types a line,
  // and is back where they were. It holds one box and lists nothing: reading is
  // the [[Quick Notes Pane]]'s job, and this is a gesture rather than a place.
  //
  // Three rules are the whole component.
  //
  // **Always this dialog, no exceptions** — including over the pane, which has a
  // capture box of its own. The shortcut lives here rather than in a per-surface
  // handler so there is nowhere for a second meaning to grow: one key, one thing.
  // A shortcut that sometimes moves focus instead of opening something is one a GM
  // stops trusting mid-session.
  //
  // **Any exit commits non-empty text**, and three mechanisms cover the three
  // kinds of exit.
  //
  // A *dismissal* — Escape or a click outside — is intercepted rather than
  // watched: the write goes out while the box is still standing, and the dialog
  // closes only once the box says it is empty. Letting the dismissal happen and
  // committing on the way down would work right up until the write failed, and
  // then the line would go back into a box that no longer exists. A capture
  // surface that loses the thought on a failed write is the one thing this feature
  // must never be, so the dismissal waits.
  //
  // A window close or a ledger switch tears the context down without dismissing
  // anything, and [[Pending Saves]] is already the registry both await:
  // registering there commits the line while the outgoing ledger is still the open
  // one. That one cannot wait for a failure — blocking a window close forever is
  // worse than the toast the failure already raised.
  //
  // Anything else that lowers the flag — nobody, today — still unmounts the box,
  // and `commitOnTeardown` is the backstop under it.
  //
  // **Silent with no ledger open.** No toast explaining that a world is required —
  // the shell that mounts this only exists once one is, and the guard below makes
  // that the component's own rule rather than a consequence of where it is hung.
  //
  // What the GM sees (2026-10 design review). Every rule above used to be invisible:
  // Enter emptied the box and nothing else changed, which looks exactly like a lost
  // line, and what Escape does was said only to a screen reader. Now a line under the
  // box says "Parked · N today", the keys say what they will do with what is in the
  // box, and Enter on an empty box closes — one key per thought, one more to finish.
  // It takes the palette's place and look: the box is the surface, not a field drawn
  // inside a card, because the two dialogs that open on a key to type a line are one
  // family.
  import { onDestroy, untrack } from "svelte";
  import * as Dialog from "$lib/components/ui/dialog";
  import WikiCaptureBox from "$lib/components/editor/WikiCaptureBox.svelte";
  import { Check, NotebookPen } from "@lucide/svelte";
  import { dialogs } from "$lib/stores/overlay.svelte";
  import { ledger } from "$lib/stores/ledger.svelte";
  import { quickNotes } from "$lib/stores/quick-notes.svelte";
  import { pendingSaves } from "$lib/stores/pending-saves";
  import { searchPalette } from "$lib/stores/search.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { countCapturedOn } from "$lib/utils/quick-note-days";

  let box = $state<ReturnType<typeof WikiCaptureBox>>();
  let draft = $state("");
  /** Whether a line has been parked since the dialog opened — what the status line says. */
  let parked = $state(false);
  const today = $derived(countCapturedOn(quickNotes.notes));

  /** What the keys would do with what is in the box. Escape always parks a line. */
  const keys = $derived(draft.trim() ? "↵ park · esc park & close" : "↵ or esc close");

  /**
   * Where focus was when the dialog opened. Nothing focused means nothing to go back
   * to — the dialog's own answer then was the first button it could find, which put
   * a focus ring on the sidebar's Settings for no reason the GM could see.
   */
  let returnTo: Element | null = null;
  $effect.pre(() => {
    if (!dialogs.quickNoteOpen) return;
    parked = false;
    returnTo = untrack(() => document.activeElement);
  });

  function onKeydown(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
    // `key` is "N" with Shift down, so the comparison has to be case-blind.
    if (e.key.toLowerCase() !== "n") return;
    if (!ledger.isOpen) return;
    e.preventDefault();
    // Over the palette, the palette goes, as it does when this is its own command:
    // two modals stacked, scrim on scrim, is two places at once.
    searchPalette.open = false;
    dialogs.quickNoteOpen = true;
  }

  /**
   * Commit the line and then, if the box is empty, let the dialog go.
   *
   * A line that came back is a write that failed, and the GM has been told; the
   * dialog stays open holding it rather than closing over a thought that reached
   * nowhere.
   */
  async function commitAndClose() {
    if (await (box?.commit() ?? Promise.resolve(true))) dialogs.quickNoteOpen = false;
  }

  /** Whether an interaction landed in the `[[` dropdown, which is portalled to the
   *  body and so sits *outside* the dialog as far as the dismiss layer can tell.
   *  Choosing a note with the pointer is the box being used, not left. */
  function isInSuggestions(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(target.closest("[data-wiki-suggest]"));
  }

  // The teardowns no dismissal precedes. Committing *then* closing is the order
  // that matters on a ledger switch: `flushAll` is awaited while the outgoing
  // ledger is still open, and the close that follows leaves the box empty, so the
  // teardown commit finds nothing left to write.
  onDestroy(
    pendingSaves.register(async () => {
      await box?.commit();
      dialogs.quickNoteOpen = false;
    }),
  );

  async function capture(body: string) {
    // Un-caught as in the pane: `api` has already told the GM the write failed,
    // and the rejection is what puts the line back in the box.
    await quickNotes.capture(body);
    parked = true;
  }

  /** The pane, with whatever is in the box parked first — the box is never left behind. */
  async function openPane() {
    await commitAndClose();
    if (dialogs.quickNoteOpen) return;
    tabs.openTab({ type: "quickNotes", id: 0, title: "Quick Notes" });
  }
</script>

<svelte:window onkeydown={onKeydown} />

<Dialog.Root bind:open={dialogs.quickNoteOpen}>
  <!-- No close button: a dismissal is Escape or a click away, and both commit. A
       second control whose only job is what looking away already does would be one
       more thing than a surface meant to hold one box.

       The title and description are the screen reader's only way in — the box's
       placeholder is the sighted GM's — and being `sr-only` they are positioned
       out of flow, so they cost the card no row and no gap. -->
  <Dialog.Content
    data-testid="quick-note-dialog"
    class="sm:max-w-[560px] top-1/3 translate-y-0 gap-0 overflow-hidden p-0"
    showCloseButton={false}
    onOpenAutoFocus={(e) => {
      // The box, named rather than discovered. The trap's own answer is "the first
      // tabbable element", which is a question about layout it has to be able to
      // measure — and this is the hook where the answer is safe to give: the trap
      // has registered by now, so a dialog underneath this one has already been
      // paused and will not pull the caret back out.
      e.preventDefault();
      box?.focus();
    }}
    onEscapeKeydown={(e) => {
      e.preventDefault();
      void commitAndClose();
    }}
    onInteractOutside={(e) => {
      e.preventDefault();
      if (!isInSuggestions(e.target)) void commitAndClose();
    }}
    onCloseAutoFocus={(e) => {
      if (!returnTo || returnTo === document.body || !returnTo.isConnected) e.preventDefault();
    }}
  >
    <Dialog.Title class="sr-only">Quick Note</Dialog.Title>
    <Dialog.Description class="sr-only">
      Park a thought. Enter parks it and clears the box for the next; Enter on an empty box closes.
      Escape or clicking away parks whatever is in the box and closes.
    </Dialog.Description>
    <div class="flex items-start gap-2.5 px-3 py-2.5">
      <NotebookPen class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <WikiCaptureBox
        bind:this={box}
        bind:value={draft}
        variant="bare"
        ariaLabel="Capture a Quick Note"
        placeholder="Park a thought…"
        commitOnTeardown
        onCommit={capture}
        onEmptyEnter={() => void commitAndClose()}
      />
    </div>
    <div
      class="flex min-h-8 items-center border-t border-border py-1.5 pr-3 pl-[2.375rem]
             text-(length:--font-ui) text-foreground-muted"
    >
      <!-- Indented to the text column above (12px + the 16px icon + 10px), so the
           footer reads as being about the box. -->
      <!-- Always in the DOM, so the first "Parked" is announced and not just drawn. -->
      <p
        aria-live="polite"
        data-testid="quick-note-status"
        class="flex min-w-0 items-center gap-1.5 {parked ? 'mr-3' : ''}"
      >
        {#if parked}
          <Check class="size-3.5 shrink-0" aria-hidden="true" />
          <span class="truncate">Parked · {today} today</span>
        {/if}
      </p>
      <button
        type="button"
        data-testid="quick-note-open-pane"
        class="shrink-0 cursor-pointer rounded-sm underline decoration-foreground-muted/50 underline-offset-2
               hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2
               focus-visible:outline-ring"
        onclick={() => void openPane()}>Open Quick Notes</button
      >
      <span
        aria-hidden="true"
        data-testid="quick-note-keys"
        class="ml-auto shrink-0 pl-3 font-mono text-[11px]">{keys}</span
      >
    </div>
  </Dialog.Content>
</Dialog.Root>
