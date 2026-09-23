"use client";

import { useState } from "react";
import { PendingButton } from "./PendingButton";
import { BookingSettings } from "./BookingPanel";
import { panel, btnGhost, btnDanger, SectionTitle } from "./ui";
import type { BookingConfig } from "@/lib/appointmentTypes";

/**
 * The Calendar panel: a month grid of booked appointments with each day's
 * bookings expandable to their answers, plus Cancel — and below them the
 * appointment settings, so the booking toggle and the question catalog sit
 * with the bookings they produce. One implementation for both admin surfaces:
 * the dashboard tab and the chat's revealed panel.
 *
 * This panel is ALWAYS present, including when booking is off, because it now
 * holds the only control that turns booking back on. Booking off hides the
 * grid (there is nothing to show) but never the settings.
 *
 * Client-side only for month paging and expansion; every write goes through a
 * server action passed in as a prop (the UsersPanel pattern).
 */

export type CalendarAppointment = {
  id: string;
  /** ISO instant; rendered in the admin's local timezone. */
  startsAt: string;
  answers: Record<string, string>;
};

/** An order placed from the cart card, as the panel lists it. */
export type CalendarOrder = {
  id: string;
  createdAt: string;
  startsAt: string | null;
  lines: { name: string; quantity: number; choices: string; note: string; lineTotal: string }[];
  contact: { name: string; phone: string; email: string };
  fulfillment: string;
  notes: string;
  subtotal: string;
};

type Props = {
  rows: CalendarAppointment[];
  /** Orders from the menu's cart, newest first; the menu card is on for every tenant with items. */
  orders?: CalendarOrder[];
  deleteOrderAction?: (formData: FormData) => Promise<void>;
  /** Question labels per field key, so answers read as asked. */
  fieldLabels: Record<string, string>;
  cancelAction: (formData: FormData) => Promise<void>;
  /** The booking toggle and question catalog, rendered below the grid. */
  config: BookingConfig;
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarPanel({ rows, fieldLabels, cancelAction, config, orders = [], deleteOrderAction }: Props) {
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

  const byDay = new Map<number, CalendarAppointment[]>();
  for (const r of rows) {
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
      {/* Nothing to show a calendar of while booking is off — but the settings
          below stay, because they hold the switch that turns it back on. */}
      {config.enabled ? (
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
                        background: "var(--primary)",
                        color: "var(--on-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {new Date(a.startsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 14 }}>
          No appointments booked yet.
        </p>
      ) : (
        rows.map((a) => (
          <div key={a.id} data-fill="surface" style={{ ...panel, display: openId === null || openId === a.id ? "block" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
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
              <form action={cancelAction}>
                <input type="hidden" name="id" value={a.id} />
                <PendingButton pendingLabel="Cancelling…" style={btnDanger as React.CSSProperties}>
                  Cancel
                </PendingButton>
              </form>
            </div>
            <dl style={{ margin: "8px 0 0", fontSize: 13 }}>
              {Object.entries(a.answers).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 6 }}>
                  <dt style={{ color: "var(--on-surface)", fontSize: 12 }}>{fieldLabels[k] ?? k}</dt>
                  <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))
      )}
        </>
      ) : null}

      {orders.length > 0 && <Orders orders={orders} deleteAction={deleteOrderAction} />}

      <BookingSettings config={config} />
    </section>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Orders placed from the cart card: what, for whom, how, when, and the total. */
function Orders({ orders, deleteAction }: { orders: CalendarOrder[]; deleteAction?: (formData: FormData) => Promise<void> }) {
  return (
    <div data-fill="surface" style={panel}>
      <SectionTitle>Orders</SectionTitle>
      {orders.map((o) => (
        <div key={o.id} style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <strong style={{ fontSize: 14 }}>
              {o.contact.name || "Order"}
              {o.subtotal ? ` · ${o.subtotal}` : ""}
              {o.fulfillment ? ` · ${o.fulfillment.replace("_", " ")}` : ""}
            </strong>
            {deleteAction && (
              <form action={deleteAction}>
                <input type="hidden" name="id" value={o.id} />
                <PendingButton pendingLabel="Removing…" style={btnDanger as React.CSSProperties}>
                  Remove
                </PendingButton>
              </form>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--on-surface)", marginTop: 2 }}>
            Placed {when(o.createdAt)}
            {o.startsAt ? ` · for ${when(o.startsAt)}` : ""}
            {[o.contact.phone, o.contact.email].filter(Boolean).length ? ` · ${[o.contact.phone, o.contact.email].filter(Boolean).join(" · ")}` : ""}
          </div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13 }}>
            {o.lines.map((l, i) => (
              <li key={i}>
                {l.quantity} × {l.name}
                {l.choices ? ` (${l.choices})` : ""}
                {l.note ? ` — ${l.note}` : ""}
                {l.lineTotal ? ` · ${l.lineTotal}` : ""}
              </li>
            ))}
          </ul>
          {o.notes && <p style={{ fontSize: 13, margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{o.notes}</p>}
        </div>
      ))}
    </div>
  );
}
