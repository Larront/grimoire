// Capture-day grouping (#230) — the only date information a [[Quick Note]] shows.
//
// A Quick Note carries an RFC-3339 `captured_at` and the pane shows **no
// per-note timestamp**: the day heading says when, and a line captured at 21:40
// is not more precisely placed than the one before it. So the whole of "when"
// lives in this one pure function, which is also what lets ordering be a claim a
// test can make without rendering a pane.
//
// The day is the GM's **local** calendar day, not UTC's. A thought parked at
// 11pm belongs under tonight's heading, and a group boundary an hour past
// midnight in another timezone would put it under tomorrow's.
import type { QuickNote } from "$lib/bindings.gen";

/** One day's worth of captured thoughts, as the pane draws it. */
export interface CaptureDay {
  /** The local calendar day as `YYYY-MM-DD` — the group's identity and sort key. */
  key: string;
  /** The heading: Today, Yesterday, or the date written out. */
  label: string;
  /** The day's Quick Notes, chronological. */
  notes: QuickNote[];
}

/** The local calendar day a timestamp falls in, as `YYYY-MM-DD`. */
function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * What a day heading reads. Today and yesterday are named rather than dated,
 * because that is how a GM refers to a session they are in or just finished; a
 * year is only spelled out once it is no longer the current one.
 */
function dayLabel(date: Date, now: Date): string {
  const key = dayKey(date);
  if (key === dayKey(now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === dayKey(yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/**
 * Quick Notes grouped by the day they were captured — **newest day first,
 * chronological within a day.**
 *
 * The two directions are deliberate and not a slip: the day a GM wants is
 * almost always the one they are in, so it sits at the top; inside a day the
 * thoughts read in the order they arrived, because consecutive captures are
 * usually the same train of thought.
 *
 * `now` is a parameter so "Today" is a claim a test can pin.
 */
export function groupByCaptureDay(notes: QuickNote[], now: Date = new Date()): CaptureDay[] {
  const byDay = new Map<string, QuickNote[]>();
  for (const note of notes) {
    const key = dayKey(new Date(note.captured_at));
    const bucket = byDay.get(key);
    if (bucket) bucket.push(note);
    else byDay.set(key, [note]);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, dayNotes]) => ({
      key,
      label: dayLabel(new Date(dayNotes[0].captured_at), now),
      // The command already returns capture order, and a newly captured line is
      // appended to it — but a group that only holds when its input is sorted is
      // a group whose ordering claim lives somewhere else.
      notes: [...dayNotes].sort(
        (a, b) => a.captured_at.localeCompare(b.captured_at) || a.id - b.id,
      ),
    }));
}
