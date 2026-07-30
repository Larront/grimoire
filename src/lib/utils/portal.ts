/**
 * Moves an element to the end of `<body>` for as long as it is mounted.
 *
 * Needed by anything `position: fixed` drawn inside the note editor. `.tiptap` is a
 * query container (`app.css`), and a query container applies layout containment,
 * which makes it the containing block for its fixed-position descendants — so a
 * dropdown positioned in viewport coordinates would land offset by the column's own
 * position and then scroll away with the prose. Out at the body it is positioned
 * against the viewport, which is what its coordinates already mean.
 */
export function portal(node: HTMLElement) {
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    },
  };
}
