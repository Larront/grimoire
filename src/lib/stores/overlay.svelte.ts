/** A pane's Details Pane sheet, keyed by the pane that owns it. Two panes each
 *  render their own surface (ADR-0006 §1), so one shared token would let the
 *  right pane's sheet silently close the left's while the left still believed
 *  itself open (#200). */
export type RightRailPanel = `right-rail:${"left" | "right"}`;

export type OverlayPanel = "sidebar" | RightRailPanel;

class OverlayState {
  active = $state<OverlayPanel | null>(null);

  request(panel: OverlayPanel) {
    this.active = panel;
  }

  release(panel: OverlayPanel) {
    if (this.active === panel) this.active = null;
  }

  /** Close whichever sheet is open: a shell dialog is opening, and goes on top of
   *  the page rather than under a sheet (2026-10 design review). */
  dismiss() {
    this.active = null;
  }
}

export const overlay = new OverlayState();

/**
 * Modal dialogs reachable from anywhere in the shell.
 *
 * These are not overlay panels in the mutual-exclusion sense above — a dialog
 * takes a focus trap of its own and does not compete with the mobile sheets —
 * but they are shell-level open/closed flags with no better home, and this is
 * the module that owns shell-level open/closed flags. They lived on
 * `searchPalette` only because it existed first (#221).
 */
export const dialogs = $state({
  settingsOpen: false,
  tagManagerOpen: false,
  /** The [[Quick Notes Dialog]] (#231). Here rather than beside the Command
   *  Palette's own state: it is a shell-level dialog like the two above, and the
   *  gesture that opens it is a keystroke of its own, not a palette command. */
  quickNoteOpen: false,
  /** "Make this world mine". The shell's rather than the sidebar's: the sidebar
   *  unmounts below 1024px, and took the dialog and its typed name with it. */
  adoptOpen: false,
  /** Every template in the world: open one to edit, rename, delete, make one.
   *  Templates had a list in the sidebar footer that buried the Files tree when
   *  opened (2026-10 design review); they are managed here instead, and made
   *  into notes from the New menu and the palette. */
  templatesOpen: false,
  /** Open it with the new template's name field ready, for "Create new template". */
  templatesNaming: false,
});
