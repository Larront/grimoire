/**
 * Command Palette state, and only that: whether the palette is open, the query
 * a note result was opened from (NotePane reads it once to highlight matches),
 * which section the palette should open into, and — opened on a folder's "New
 * note from template…" — the folder the note goes into.
 *
 * The Settings and tag-manager dialog flags used to live here because this
 * module existed first; they are `dialogs` in `overlay.svelte.ts` now (#221).
 */
export const searchPalette = $state({
  open: false,
  activeQuery: "",
  openToTemplatePicker: false,
  /** `null`: beside the open note, as every other new note goes (`newNoteFolder`). */
  templateFolder: null as string | null,
});
