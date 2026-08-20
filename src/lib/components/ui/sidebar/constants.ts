export const SIDEBAR_WIDTH = "16rem";
export const SIDEBAR_WIDTH_MOBILE = "18rem";
export const SIDEBAR_WIDTH_ICON = "3rem";
export const SIDEBAR_KEYBOARD_SHORTCUT = "\\";

// Drag-to-resize bounds (px). The sidebar defaults to 16rem (256px) and the
// user can widen it — up to 480px — to read deeply-nested file names, or
// narrow it to 192px. The chosen width is persisted across sessions (#140).
export const SIDEBAR_WIDTH_DEFAULT_PX = 256;
export const SIDEBAR_WIDTH_MIN_PX = 192;
export const SIDEBAR_WIDTH_MAX_PX = 480;
export const SIDEBAR_WIDTH_STORAGE_KEY = "grimoire:sidebar-width";

// Collapsed-or-expanded, beside the width and recovered in the same beat (#226).
// Upstream writes a `sidebar:state` cookie here, which is a SvelteKit pattern
// that wants a server to read it back on the next render; there is none, so the
// sidebar opened on every launch no matter what the GM last did. That mattered
// little while collapsing only hid a panel the [[Icon Rail]] stood beside — now
// that collapsed *is* the rail, it is a state a GM may want to live in.
export const SIDEBAR_STATE_STORAGE_KEY = "grimoire:sidebar-open";

/** The GM's last collapsed-or-expanded, or expanded if they have no last. */
export function readSidebarOpen(): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    const saved = localStorage.getItem(SIDEBAR_STATE_STORAGE_KEY);
    return saved === null ? true : saved === "true";
  } catch {
    return true;
  }
}

export function persistSidebarOpen(open: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SIDEBAR_STATE_STORAGE_KEY, String(open));
  } catch {
    // Storage disabled or full — the state just won't survive a restart, which
    // is where this started.
  }
}
