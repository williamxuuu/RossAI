/** Human-friendly timestamps for the console. Pure, so server and client agree. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = Math.max(0, now - t);
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 14 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return formatDate(iso);
}

<<<<<<< HEAD
export function formatDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
=======
/**
 * A calendar date, rendered in UTC.
 *
 * Citations carry the day a passage was retrieved, not a moment. Rendering that in the
 * viewer's zone shows a source retrieved at 00:00 UTC as the previous day to anyone
 * west of Greenwich, which makes a paralegal doubt the citation for no reason.
 */
export function formatDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
}

export function formatDateTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
