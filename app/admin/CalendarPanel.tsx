"use client";

import { useState } from "react";
import { PendingButton } from "./PendingButton";
import { panel, btnGhost, btnDanger, SectionTitle } from "./ui";

/**
 * The Calendar panel: a month grid of booked appointments with each day's
 * bookings expandable to their answers, plus Cancel. One implementation for
 * both admin surfaces — the dashboard tab and the chat's revealed panel.
 * Client-side only for month paging and expansion; every write goes through
 * the server action passed in as a prop (the UsersPanel pattern).
 */

export type CalendarAppointment = {
  id: string;
  /** ISO instant; rendered in the admin's local timezone. */
  startsAt: string;
  answers: Record<string, string>;
};

type Props = {
  rows: CalendarAppointment[];
  /** Question labels per field key, so answers read as asked. */
  fieldLabels: Record<string, string>;
  cancelAction: (formData: FormData) => Promise<void>;
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarPanel({ rows, fieldLabels, cancelAction }: Props) {
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
    </section>
  );
}
