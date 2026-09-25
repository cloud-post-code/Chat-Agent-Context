"use client";

import { useState } from "react";
import Link from "next/link";
import { PendingButton } from "./PendingButton";
import { panel, btn, btnGhost, btnDanger, SectionTitle } from "./ui";

/**
 * The Appointments panel (Inbox): a month grid of booked appointments —
 * service, provider, location, customer, price, status and intake answers —
 * with each day's bookings expandable to the full appointment, plus Cancel
 * and a Confirm for waitlisted rows. One implementation for both admin
 * surfaces: the dashboard tab and the chat's revealed panel.
 *
 * The booking switch and question catalog live under Settings › Booking
 * (BookingSettings); while booking is off this panel just points there.
 *
 * Client-side only for month paging and expansion; every write goes through a
 * server action passed in as a prop (the UsersPanel pattern).
 */

import type { CalendarAppointment } from "@/lib/adminElements";
export type { CalendarAppointment };

type Props = {
  rows: CalendarAppointment[];
  /** Question labels per field key, so answers read as asked. */
  fieldLabels: Record<string, string>;
  cancelAction: (formData: FormData) => Promise<void>;
  /** Confirms a waitlisted booking; without it the Confirm button is not drawn. */
  confirmAction?: (formData: FormData) => Promise<void>;
  /** Off: nothing to show a calendar of, so point at the switch instead. */
  bookingEnabled: boolean;
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function AppointmentsPanel({
  rows,
  fieldLabels,
  cancelAction,
  confirmAction,
  bookingEnabled,
}: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [openId, setOpenId] = useState<string | null>(null);

  if (!bookingEnabled) {
    return (
      <section data-fill="surface" style={panel}>
        <SectionTitle>Appointments</SectionTitle>
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 14 }}>
          Booking is off, so there is nothing to show here yet.{" "}
          <Link href="/admin/dashboard?tab=booking">Turn it on under Settings › Booking.</Link>
        </p>
      </section>
    );
  }

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
      <div data-fill="surface" style={panel}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <SectionTitle>Appointments</SectionTitle>
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
            <DayCell
              key={i}
              day={day}
              today={today}
              appointments={day !== null ? byDay.get(day) ?? [] : []}
              openId={openId}
              onToggle={(id) => setOpenId(openId === id ? null : id)}
            />
          ))}
        </div>
      </div>

      <AppointmentCards
        rows={live}
        openId={openId}
        fieldLabels={fieldLabels}
        cancelAction={cancelAction}
        confirmAction={confirmAction}
      />
    </section>
  );
}

function DayCell({
  day,
  today,
  appointments,
  openId,
  onToggle,
}: {
  day: number | null;
  today: number | null;
  appointments: CalendarAppointment[];
  openId: string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <div
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
          {appointments.map((a) => (
            <button
              key={a.id}
              onClick={() => onToggle(a.id)}
              aria-pressed={openId === a.id}
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

/** Every booking as a card with its facts and answers; a grid click narrows to one. */
function AppointmentCards({
  rows,
  openId,
  fieldLabels,
  cancelAction,
  confirmAction,
}: {
  rows: CalendarAppointment[];
  openId: string | null;
  fieldLabels: Record<string, string>;
  cancelAction: (formData: FormData) => Promise<void>;
  confirmAction?: (formData: FormData) => Promise<void>;
}) {
  if (rows.length === 0) {
    return (
      <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 14 }}>
        No appointments booked yet.
      </p>
    );
  }
  return (
    <>
      {rows.map((a) => (
        <AppointmentCard
          key={a.id}
          a={a}
          hidden={openId !== null && openId !== a.id}
          fieldLabels={fieldLabels}
          cancelAction={cancelAction}
          confirmAction={confirmAction}
        />
      ))}
    </>
  );
}

/**
 * One booking as a card: facts, intake answers, Cancel and (waitlisted)
 * Confirm. Also the `appointments` element the copilot reveals on its own.
 */
export function AppointmentCard({
  a,
  hidden = false,
  fieldLabels,
  cancelAction,
  confirmAction,
}: {
  a: CalendarAppointment;
  hidden?: boolean;
  fieldLabels: Record<string, string>;
  cancelAction: (formData: FormData) => Promise<void>;
  confirmAction?: (formData: FormData) => Promise<void>;
}) {
  return (
        <div data-fill="surface" data-element={a.id} style={{ ...panel, display: hidden ? "none" : "block" }}>
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
              {a.status === "waitlisted" && confirmAction ? (
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
  );
}
