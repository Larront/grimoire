/**
 * The folder a note sits in, for Details' "Folder": the folders only, with a long
 * trail shortened in the middle. It used to end with the note's own file, so a note
 * at the top of the world showed its file name as if that were its folder (2026-10
 * design review).
 */
export function formatFolder(path: string): string {
  const folders = path.split("/").slice(0, -1);
  if (folders.length === 0) return "Top level";
  if (folders.length <= 3) return folders.join(" / ");
  return `${folders[0]} / … / ${folders[folders.length - 2]} / ${folders[folders.length - 1]}`;
}

export function formatRelativeTime(isoString: string, now = new Date()): string {
  const diffMs = now.getTime() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return "just now";

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return diffMin === 1 ? "1 minute ago" : `${diffMin} minutes ago`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return diffHour === 1 ? "1 hour ago" : `${diffHour} hours ago`;

  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return diffDay === 1 ? "1 day ago" : `${diffDay} days ago`;

  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 4) return diffWeek === 1 ? "last week" : `${diffWeek} weeks ago`;

  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return diffMonth === 1 ? "last month" : `${diffMonth} months ago`;

  const diffYear = Math.floor(diffDay / 365);
  return diffYear === 1 ? "last year" : `${diffYear} years ago`;
}
