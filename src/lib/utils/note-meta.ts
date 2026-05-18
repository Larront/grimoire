export function formatBreadcrumb(path: string): string {
  const parts = path.split('/');
  if (parts.length <= 3) {
    return parts.join(' / ');
  }
  return `${parts[0]} / … / ${parts[parts.length - 1]}`;
}

export function formatRelativeTime(isoString: string, now = new Date()): string {
  const diffMs = now.getTime() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'just now';

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return diffMin === 1 ? '1 minute ago' : `${diffMin} minutes ago`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return diffHour === 1 ? '1 hour ago' : `${diffHour} hours ago`;

  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return diffDay === 1 ? '1 day ago' : `${diffDay} days ago`;

  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 4) return diffWeek === 1 ? 'last week' : `${diffWeek} weeks ago`;

  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return diffMonth === 1 ? 'last month' : `${diffMonth} months ago`;

  const diffYear = Math.floor(diffDay / 365);
  return diffYear === 1 ? 'last year' : `${diffYear} years ago`;
}
