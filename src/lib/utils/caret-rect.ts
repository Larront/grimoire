// Where a character of a text field is drawn — what an input does not say.
//
// A text input reports its own box and nothing about where its text sits inside it, so a
// menu anchored to the field opened at the field's corner: in a statblock's body the link
// menu sat 70px below and 300px left of the `[[` it was completing. A mirror element with
// the field's own type metrics, laid out off-screen, says where that character falls.

const COPIED = [
  "boxSizing",
  "width",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
  "overflowWrap",
] as const;

/**
 * The box of the character at `index` in a field's value, in viewport coordinates — one
 * line tall and no width. The field's own box where there is no layout to measure.
 */
export function caretRect(el: HTMLInputElement | HTMLTextAreaElement, index: number): DOMRect {
  const box = el.getBoundingClientRect();
  if (!box.width && !box.height) return box;

  const style = getComputedStyle(el);
  const mirror = document.createElement("div");
  for (const prop of COPIED) mirror.style[prop] = style[prop];
  mirror.style.position = "fixed";
  mirror.style.visibility = "hidden";
  mirror.style.left = "0";
  mirror.style.top = "0";
  mirror.style.whiteSpace = el instanceof HTMLTextAreaElement ? "pre-wrap" : "pre";
  mirror.textContent = el.value.slice(0, index);
  const mark = document.createElement("span");
  mark.textContent = el.value.slice(index) || "​";
  mirror.appendChild(mark);
  document.body.appendChild(mirror);

  const at = mark.getBoundingClientRect();
  const origin = mirror.getBoundingClientRect();
  mirror.remove();

  const line = parseFloat(style.lineHeight) || at.height;
  return new DOMRect(
    box.left + (at.left - origin.left) - el.scrollLeft,
    box.top + (at.top - origin.top) - el.scrollTop,
    0,
    line,
  );
}
