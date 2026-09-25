/** Minutes in "45 min", "1 hr", "1h 30m", "1.5 hours"; null when it isn't a length of time. */
export function durationMinutes(duration?: string): number | null {
  const text = (duration ?? "").trim().toLowerCase();
  if (!text) return null;
  const h = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  const m = text.match(/(\d+)\s*(?:minutes?|mins?|m)\b/);
  if (!h && !m) return null;
  return Math.round((h ? Number.parseFloat(h[1]) * 60 : 0) + (m ? Number.parseInt(m[1], 10) : 0));
}
