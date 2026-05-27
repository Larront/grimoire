// Reactive counter bumped by NotePane after write_note_content succeeds.
// RightRail subscribes so its Backlinks and Outbound sections reload on save.
let tick = $state(0);

export const linksTick = {
  get value() {
    return tick;
  },
  bump() {
    tick++;
  },
};
