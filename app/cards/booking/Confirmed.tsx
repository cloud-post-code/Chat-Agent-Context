"use client";

import type { BookingFlow, BookingSelection, LocationRow, ServiceRow, StaffRow } from "@/lib/booking/types";
import { formatDuration } from "@/lib/booking/types";
import { formatInZone } from "@/lib/booking/time";
import type { CreateBookingResult } from "./api";
import { buildIcsDataUrl } from "./ics";
import { linkBtn } from "./ui";

export function Confirmed({
  flow,
  result,
  waitlisted,
  provider,
  location,
  selection,
}: {
  flow: BookingFlow;
  result: CreateBookingResult;
  waitlisted: boolean;
  service: ServiceRow | null;
  provider: StaffRow | null;
  location: LocationRow | null;
  selection: BookingSelection;
}) {
  const zone = selection.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const start = new Date(result.startsAt);
  const end = new Date(result.endsAt);
  const locationLine =
    selection.mode === "online" ? "Online" : selection.mode === "mobile" ? selection.customerAddress : location?.address || result.locationName;
  const businessSlug = flow.business.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "booking";
  const ics = buildIcsDataUrl({
    uid: `${result.id}@${businessSlug}.booking`,
    startsAt: result.startsAt,
    endsAt: result.endsAt,
    summary: result.serviceName || "Appointment",
    location: locationLine,
    description: flow.rules.confirmationNote,
  });
  const durationMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));

  return (
    <div
      data-fill="bg-soft"
      style={{
        background: "var(--bg-soft)",
        border: "1px solid var(--success-on-bg-soft)",
        borderRadius: "var(--radius-md)",
        color: "var(--on-bg-soft)",
        padding: 16,
        maxWidth: 560,
      }}
    >
      <strong style={{ fontSize: 16, fontFamily: "var(--font-heading)" }}>{waitlisted ? "You're on the waitlist." : "You're booked."}</strong>
      <dl style={{ margin: "10px 0", fontSize: 14 }}>
        <Row label="Service">{result.serviceName || "Appointment"}</Row>
        <Row label="Provider">{result.staffName || provider?.name || "Any available"}</Row>
        <Row label="When">{formatInZone(start, zone)}</Row>
        <Row label="Duration">{formatDuration(durationMinutes)}</Row>
        {locationLine && <Row label="Location">{locationLine}</Row>}
      </dl>
      {flow.rules.confirmationNote && <p style={{ fontSize: 13, fontStyle: "italic" }}>{flow.rules.confirmationNote}</p>}
      <a href={ics} download="appointment.ics" style={{ ...linkBtn, display: "inline-block", marginTop: 10 }}>
        Add to calendar
      </a>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <dt style={{ fontSize: 12, opacity: 0.75 }}>{label}</dt>
      <dd style={{ margin: 0 }}>{children}</dd>
    </div>
  );
}
