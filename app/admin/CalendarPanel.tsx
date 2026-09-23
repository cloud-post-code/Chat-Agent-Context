"use client";

import { useState } from "react";
import { PendingButton } from "./PendingButton";
import { BookingToggle } from "./BookingPanel";
import { panel, btn, btnGhost, btnDanger, SectionTitle } from "./ui";

/**
 * The Calendar panel: a month grid of booked appointments with each day's
 * bookings expandable to the full appointment — service, provider, location,
 * customer, price, status and intake answers — plus Cancel, and a Confirm for
 * waitlisted rows. Below it, the booking on/off toggle (the question catalog
 * and every other setting now live in the Booking section's own sub-tabs).
 *
 * This panel is ALWAYS present, including when booking is off, because the
 * toggle that turns it back on lives here. Booking off hides the grid (there
 * is nothing to show) but never the toggle.
 *
 * Client-side only for month paging and expansion; every write goes through a
 * server action passed in as a prop (the UsersPanel pattern).
 */

export type CalendarAppointment = {
  id: string;
  /** ISO instant; rendered in the admin's local timezone. */
  startsAt: string;
  status: string;
  serviceName: string;
  staffName: string;
  locationName: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  durationMinutes: number;
  /** Formatted total ("$45", "From $45", "Quote"), or "" when unpriced. */
  priceDisplay: string;
  answers: Record<string, string>;
};

type Props = {
  rows: CalendarAppointment[];
  /** Question labels per field key, so answers read as asked. */
  fieldLabels: Record<string, string>;
  cancelAction: (formData: FormData) => Promise<void>;
  confirmAction: (formData: FormData) => Promise<void>;
  /** Whether booking is on — the toggle at the bottom always renders. */
  enabled: boolean;
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarPanel({ rows, fieldLabels, cancelAction, confirmAction, enabled }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [openId, setOpenId] = useState<string | null>(null);

  const move = (d: number) => {
    const next = new Date(year, month + d, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  };

  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Monday-first grid: JS getDay() is Sunday-0.
  const lead = (first.getDay() + 6) % 7;

  const live = rows.filter((r) => r.status !== "cancelled");
  const byDay = new Map<number, CalendarAppointment[]>();
  for (const r of live) {
    const d = new Date(r.startsAt);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const day = d.getDate();
    byDay.set(day, [...(byDay.get(day) ?? []), r]);
  }

  const monthLabel = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const cells: Array<number | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const today =
    now.getFullYear() === year && now.getMonth() === month ? now.getDate() : null;

  return (
    <section>
      {/* Nothing to show a calendar of while booking is off — but the toggle
          below stays, because it holds the switch that turns it back on. */}
      {enabled ? (
        <>
      <div data-fill="surface" style={panel}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <SectionTitle>Calendar</SectionTitle>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={() => move(-1)} style={btnGhost as React.CSSProperties} aria-label="Previous month">
              ‹
            </button>
            <strong style={{ fontSize: 14, minWidth: 130, textAlign: "center" }}>{monthLabel}</strong>
            <button onClick={() => move(1)} style={btnGhost as React.CSSProperties} aria-label="Next month">
              ›
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
          {DAY_NAMES.map((d) => (
            <div key={d} style={{ fontSize: 11, color: "var(--on-surface)", textAlign: "center", padding: "2px 0" }}>
              {d}
            </div>
          ))}
          {cells.map((day, i) => (
            <div
              key={i}
              style={{
                minHeight: 52,
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                padding: 4,
                background: day === today ? "var(--bg-soft)" : "transparent",
                opacity: day === null ? 0.35 : 1,
              }}
            >
              {day !== null ? (
                <>
                  <div style={{ fontSize: 11, color: "var(--on-surface)" }}>{day}</div>
                  {(byDay.get(day) ?? []).map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setOpenId(openId === a.id ? null : a.id)}
                      title={[a.serviceName, a.customerName].filter(Boolean).join(" · ")}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        fontSize: 11,
                        marginTop: 2,
                        padding: "2px 4px",
                        borderRadius: "var(--radius-sm)",
                        border: "none",
                        cursor: "pointer",
                        background: a.status === "waitlisted" ? "var(--bg-soft)" : "var(--primary)",
                        color: a.status === "waitlisted" ? "var(--on-bg-soft)" : "var(--on-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {[
                        new Date(a.startsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
                        a.serviceName,
                        a.customerName.split(" ")[0],
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {live.length === 0 ? (
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 14 }}>
          No appointments booked yet.
        </p>
      ) : (
        live.map((a) => (
          <div key={a.id} data-fill="surface" style={{ ...panel, display: openId === null || openId === a.id ? "block" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <strong style={{ fontSize: 14 }}>
                  {new Date(a.startsAt).toLocaleString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </strong>
                {a.status === "waitlisted" ? <StatusBadge>Waitlist</StatusBadge> : null}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {a.status === "waitlisted" ? (
                  <form action={confirmAction}>
                    <input type="hidden" name="id" value={a.id} />
                    <PendingButton pendingLabel="Confirming…" style={btn as React.CSSProperties}>
                      Confirm
                    </PendingButton>
                  </form>
                ) : null}
                <form action={cancelAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <PendingButton pendingLabel="Cancelling…" style={btnDanger as React.CSSProperties}>
                    Cancel
                  </PendingButton>
                </form>
              </div>
            </div>

            <dl style={{ margin: "10px 0 0", fontSize: 13, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
              {a.serviceName ? <Fact label="Service" value={a.serviceName} /> : null}
              {a.staffName ? <Fact label="Provider" value={a.staffName} /> : null}
              {a.locationName ? <Fact label="Location" value={a.locationName} /> : null}
              <Fact label="Duration" value={a.durationMinutes ? `${a.durationMinutes} min` : "—"} />
              {a.priceDisplay ? <Fact label="Price" value={a.priceDisplay} /> : null}
              {a.customerName ? <Fact label="Customer" value={a.customerName} /> : null}
              {a.customerEmail ? <Fact label="Email" value={a.customerEmail} /> : null}
              {a.customerPhone ? <Fact label="Phone" value={a.customerPhone} /> : null}
            </dl>

            {Object.keys(a.answers).length > 0 ? (
              <dl style={{ margin: "10px 0 0", fontSize: 13 }}>
                {Object.entries(a.answers).map(([k, v]) => (
                  <div key={k} style={{ marginBottom: 6 }}>
                    <dt style={{ color: "var(--on-surface)", fontSize: 12 }}>{fieldLabels[k] ?? k}</dt>
                    <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{v}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        ))
      )}
        </>
      ) : null}

      <BookingToggle enabled={enabled} />
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt style={{ color: "var(--on-surface)", fontSize: 11 }}>{label}</dt>
      <dd style={{ margin: 0 }}>{value}</dd>
    </div>
  );
}

function StatusBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        marginLeft: 8,
        fontSize: 11,
        fontWeight: 700,
        padding: "1px 8px",
        borderRadius: "var(--radius-pill)",
        background: "var(--bg-soft)",
        color: "var(--accent-on-bg-soft)",
        border: "1px solid var(--border)",
      }}
    >
      {children}
    </span>
  );
}
