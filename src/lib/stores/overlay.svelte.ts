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
});
