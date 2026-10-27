// Focus into what a pane shows, once it has drawn it.
//
// Opening a note from the palette, or closing a tab, left focus nowhere — on the page
// itself — so the next keystroke went to nothing and the next Tab started from the
// top of the window (2026-10 design review). A note's text, if the pane shows a note;
// else its open tab, so the arrow keys and Ctrl+W carry on from there.

const TRIES = 20;
const STEP_MS = 50;

/** `note`: wait for its text to draw (it loads); anything else takes its tab at once. */
export async function focusPane(pane: "left" | "right", note = true): Promise<void> {
  for (let i = 0; i < (note ? TRIES : 1); i++) {
    // The right pane's drop zone carries the same marker, so look in each.
    for (const root of document.querySelectorAll(`[data-pane-content="${pane}"]`)) {
      const text = root.querySelector<HTMLElement>(".ProseMirror");
      if (text) {
        text.focus();
        return;
      }
    }
    await new Promise((r) => setTimeout(r, STEP_MS));
  }
  const tab = document.querySelector<HTMLElement>(
    `[data-tab-pane="${pane}"] [role="tab"][aria-selected="true"]`,
  );
  // No tab left: the pane shows the world's home, whose first step is New note.
  const home = [...document.querySelectorAll(`[data-pane-content="${pane}"]`)]
    .map((root) => root.querySelector<HTMLElement>('[data-testid="home-new-note"]'))
    .find(Boolean);
  (tab ?? home)?.focus();
}
