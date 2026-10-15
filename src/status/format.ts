/** "12 min ago", "3 h ago", "2 d ago", or "never" for a missing date. Dates in the future read as "just now". */
export function ageLabel(d: Date | null, now: Date): string {
  if (!d) return "never";
  const min = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
