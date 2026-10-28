// Holding a note's length while a section near its end closes (2026-10 design review).
// jsdom has no layout, so the scroller's numbers are set by hand: a 500px view scrolled
// to 700 over content that starts at its top.
import { afterEach, describe, expect, it } from "vitest";
import { holdPlace } from "$lib/utils/hold-place";

function page(natural: number) {
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  const content = document.createElement("div");
  const section = document.createElement("div");
  content.append(section);
  scroller.append(content);
  document.body.append(scroller);

  let scrollTop = 700;
  Object.defineProperty(scroller, "clientHeight", { value: 500 });
  Object.defineProperty(scroller, "scrollTop", {
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v;
      scroller.dispatchEvent(new Event("scroll"));
    },
  });
  // The content's top is scrolled out of view by however far the page is scrolled.
  content.getBoundingClientRect = () => ({ top: -scrollTop }) as DOMRect;
  scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  // Its own height: what it holds, or the hold, whichever is more.
  Object.defineProperty(content, "offsetHeight", {
    get: () => Math.max(natural, parseFloat(content.style.minHeight) || 0),
  });
  return { scroller, content, section, scrollTo: (v: number) => (scroller.scrollTop = v) };
}

afterEach(() => document.body.replaceChildren());

describe("holdPlace", () => {
  it("keeps the page as long as the view reaches", () => {
    const { content, section } = page(800);
    holdPlace(section);
    expect(content.style.minHeight).toBe("1200px");
  });

  it("gives the room back as the GM scrolls up through it", () => {
    const { content, section, scrollTo } = page(800);
    holdPlace(section);
    scrollTo(500);
    expect(content.style.minHeight).toBe("1000px");
  });

  it("lets go once the content fills the view on its own", () => {
    const { content, section, scrollTo } = page(800);
    holdPlace(section);
    scrollTo(200);
    expect(content.style.minHeight).toBe("");
  });

  it("does nothing outside a scrolling page", () => {
    const loose = document.createElement("div");
    document.body.append(loose);
    expect(() => holdPlace(loose)).not.toThrow();
  });
});
