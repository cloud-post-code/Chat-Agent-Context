/**
 * A pure .ics builder: a confirmed booking's facts → a
 * `data:text/calendar;charset=utf8,…` URL the browser can save as a file.
 * No imports — this never needs to know the booking shapes, only the four
 * facts a calendar event needs.
 */

export type IcsEvent = {
  /** Unique per event; the booking id plus a domain-ish suffix is enough. */
  uid: string;
  /** ISO-8601 instants. */
  startsAt: string;
  endsAt: string;
  summary: string;
  location?: string;
  description?: string;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** An ISO instant → "YYYYMMDDTHHMMSSZ", the VEVENT wire format, always UTC. */
function toIcsUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** RFC 5545 §3.3.11 text escaping: backslash, semicolon, comma, newline. */
function escapeText(s: string): string {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export function buildIcsDataUrl(ev: IcsEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Chat Agent Context//Booking//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${escapeText(ev.uid)}`,
    `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
    `DTSTART:${toIcsUtc(ev.startsAt)}`,
    `DTEND:${toIcsUtc(ev.endsAt)}`,
    `SUMMARY:${escapeText(ev.summary)}`,
    ev.location ? `LOCATION:${escapeText(ev.location)}` : "",
    ev.description ? `DESCRIPTION:${escapeText(ev.description)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  const body = lines.join("\r\n");
  return `data:text/calendar;charset=utf8,${encodeURIComponent(body)}`;
}
