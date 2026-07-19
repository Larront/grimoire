export const SIDEBAR_COOKIE_NAME = "sidebar:state";
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
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
