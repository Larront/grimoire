// What the app says about a world, in the same words wherever it says it: the
// Splash's rows and its last world, and the world's own home page.

/** How long ago, in words: "3 hours ago", "yesterday", "over a year ago". */
export function timeAgo(isoString: string, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(isoString).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes === 1 ? "a minute ago" : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks === 1 ? "a week ago" : `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months <= 1 ? "a month ago" : `${months} months ago`;
  return "over a year ago";
}

/** What is in a world: "205 notes · 3 scenes · 2 maps", or that it is empty. */
export function worldContents(w: {
  note_count: number;
  scene_count: number;
  map_count: number;
}): string {
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const parts = [
    w.note_count > 0 && count(w.note_count, "note"),
    w.scene_count > 0 && count(w.scene_count, "scene"),
    w.map_count > 0 && count(w.map_count, "map"),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nothing in it yet";
}
