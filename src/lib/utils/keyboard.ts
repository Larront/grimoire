/**
 * Whether a keystroke landed somewhere the GM is typing.
 *
 * Window-level shortcuts listen everywhere, which means they also hear the
 * keystrokes meant for a rename field, a label, or the editor. Anything bound at
 * the window asks this first, so a `Backspace` while naming a map deletes a
 * character rather than a rectangle.
 */
export function isTypingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

/**
 * A modifier shortcut as the GM's platform writes it: `Ctrl+Shift+N`, or `⌘⇧N` on
 * a Mac. The one way a key is spelled in a menu or the palette, which had grown
 * "Ctrl+N" beside "Ctrl 0" (2026-10 design review).
 */
export function shortcut(keys: string[]): string {
  return isMac
    ? "⌘" + keys.map((k) => (k === "Shift" ? "⇧" : k)).join("")
    : ["Ctrl", ...keys].join("+");
}
