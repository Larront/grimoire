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
  import { onDestroy } from "svelte";
  import * as Dialog from "$lib/components/ui/dialog";
  import WikiCaptureBox from "$lib/components/editor/WikiCaptureBox.svelte";
  import { dialogs } from "$lib/stores/overlay.svelte";
  import { ledger } from "$lib/stores/ledger.svelte";
  import { quickNotes } from "$lib/stores/quick-notes.svelte";
  import { pendingSaves } from "$lib/stores/pending-saves";

  let box = $state<ReturnType<typeof WikiCaptureBox>>();

  function onKeydown(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
    // `key` is "N" with Shift down, so the comparison has to be case-blind.
    if (e.key.toLowerCase() !== "n") return;
    if (!ledger.isOpen) return;
    e.preventDefault();
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
    class="sm:max-w-lg"
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
  >
    <Dialog.Title class="sr-only">Quick Note</Dialog.Title>
    <Dialog.Description class="sr-only">
      Park a thought. Enter commits it and clears the box for the next line; leaving commits
      whatever is in it.
    </Dialog.Description>
    <div class="relative">
      <WikiCaptureBox
        bind:this={box}
        ariaLabel="Capture a Quick Note"
        placeholder="Park a thought…"
        commitOnTeardown
        onCommit={capture}
      />
    </div>
  </Dialog.Content>
</Dialog.Root>
