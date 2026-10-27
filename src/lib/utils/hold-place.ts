// Keeps what the GM is looking at where it is while something above the end of the page
// closes.
//
// A section that closes near the end of a note makes the note shorter than the scroll
// it was at, so the browser scrolls back and everything on screen drops — the header the
// GM just pressed went out from under the pointer (2026-10 design review). Held, the
// page keeps its length for now, and the room left over goes as the GM scrolls up
// through it, so nothing moves that they didn't move.
const holds = new WeakMap<HTMLElement, () => void>();

function scrollParent(el: Element): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

/** Hold the page `el` scrolls in at its length now. Call as the section starts to close. */
export function holdPlace(el: Element): void {
  const scroller = scrollParent(el);
  const content = scroller
    ? ([...scroller.children].find((c) => c.contains(el)) as HTMLElement | undefined)
    : undefined;
  if (!scroller || !content) return;

  // How far down the content the bottom of the view reaches.
  const reach = () =>
    scroller.scrollTop +
    scroller.clientHeight -
    (content.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop);

  holds.get(content)?.();
  content.style.minHeight = `${reach()}px`;

  const release = () => {
    scroller.removeEventListener("scroll", follow);
    content.style.minHeight = "";
    holds.delete(content);
  };
  // Scrolling up gives the held room back as it goes; once the content fills the view on
  // its own, the hold has nothing left to do.
  const follow = () => {
    const held = parseFloat(content.style.minHeight);
    const need = reach();
    if (need >= held) return;
    content.style.minHeight = "";
    const natural = content.offsetHeight;
    if (need <= natural) release();
    else content.style.minHeight = `${need}px`;
  };
  scroller.addEventListener("scroll", follow, { passive: true });
  holds.set(content, release);
}
