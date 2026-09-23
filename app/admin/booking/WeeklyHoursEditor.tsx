"use client";

import { useState } from "react";
import { field as fieldStyle, btnGhost, Label } from "../ui";
import { DAY_KEYS, type DayKey, type WeeklyHours, type HoursRange } from "@/lib/booking/types";

/**
 * One day per row: a "Closed" checkbox and up to two open/close pairs.
 * Serializes to hidden `<input type="time">` names the server reads back
 * with `hoursFromForm` (app/admin/booking/forms.ts): "<prefix>.<day>.<i>.start"
 * / ".end". A day with no ranges (its "Closed" box on) submits nothing for
 * that day, which `sanitizeWeeklyHours` reads as closed.
 *
 * When `optional` is set, a "Use business hours" checkbox sits above the
 * table; checked, the whole table is hidden and nothing under `prefix` is
 * submitted at all — `sanitizeOptionalHours` reads an absent/empty set as
 * "use the business hours" (a provider's or a location's own-hours override).
 */

const DAY_LABELS: Record<DayKey, string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
};

const DEFAULT_RANGE: HoursRange = { start: "09:00", end: "17:00" };

type DayState = Record<DayKey, HoursRange[]>;

function initialDays(initial: WeeklyHours | null): DayState {
  const src = initial ?? ({} as WeeklyHours);
  return DAY_KEYS.reduce((acc, d) => {
    acc[d] = src[d]?.length ? src[d] : [];
    return acc;
  }, {} as DayState);
}

export function WeeklyHoursEditor({
  prefix,
  initial,
  optional = false,
}: {
  /** Hidden-input name prefix, e.g. "hours" or "staffHours". */
  prefix: string;
  initial: WeeklyHours | null;
  optional?: boolean;
}) {
  const [useBusiness, setUseBusiness] = useState(optional && initial === null);
  const [days, setDays] = useState<DayState>(() => initialDays(initial));

  const setClosed = (day: DayKey, closed: boolean) =>
    setDays((prev) => ({ ...prev, [day]: closed ? [] : [DEFAULT_RANGE] }));

  const addRange = (day: DayKey) =>
    setDays((prev) => ({
      ...prev,
      [day]: prev[day].length >= 2 ? prev[day] : [...prev[day], DEFAULT_RANGE],
    }));

  const removeRange = (day: DayKey, i: number) =>
    setDays((prev) => ({ ...prev, [day]: prev[day].filter((_, j) => j !== i) }));

  const setRange = (day: DayKey, i: number, patch: Partial<HoursRange>) =>
    setDays((prev) => ({
      ...prev,
      [day]: prev[day].map((r, j) => (j === i ? { ...r, ...patch } : r)),
    }));

  return (
    <div>
      {optional ? (
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={useBusiness}
            onChange={(e) => setUseBusiness(e.target.checked)}
          />
          Use business hours
        </label>
      ) : null}

      {!useBusiness && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {DAY_KEYS.map((day) => {
            const ranges = days[day];
            const closed = ranges.length === 0;
            return (
              <div
                key={day}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <span style={{ width: 36, fontSize: 13, fontWeight: 600 }}>{DAY_LABELS[day]}</span>
                <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                  <input type="checkbox" checked={closed} onChange={(e) => setClosed(day, e.target.checked)} />
                  Closed
                </label>
                {!closed &&
                  ranges.map((r, i) => (
                    <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="time"
                        name={`${prefix}.${day}.${i}.start`}
                        value={r.start}
                        onChange={(e) => setRange(day, i, { start: e.target.value })}
                        style={{ ...fieldStyle, width: 110, marginBottom: 0 }}
                      />
                      <span style={{ fontSize: 12 }}>–</span>
                      <input
                        type="time"
                        name={`${prefix}.${day}.${i}.end`}
                        value={r.end}
                        onChange={(e) => setRange(day, i, { end: e.target.value })}
                        style={{ ...fieldStyle, width: 110, marginBottom: 0 }}
                      />
                      {ranges.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => removeRange(day, i)}
                          style={{ ...(btnGhost as React.CSSProperties), padding: "2px 8px", fontSize: 12 }}
                        >
                          ✕
                        </button>
                      ) : null}
                    </span>
                  ))}
                {!closed && ranges.length < 2 ? (
                  <button
                    type="button"
                    onClick={() => addRange(day)}
                    style={{ ...(btnGhost as React.CSSProperties), padding: "2px 8px", fontSize: 12 }}
                  >
                    + another range
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A <Label> + WeeklyHoursEditor pair, for panels that just want it dropped in. */
export function WeeklyHoursField({
  label,
  prefix,
  initial,
  optional,
}: {
  label: string;
  prefix: string;
  initial: WeeklyHours | null;
  optional?: boolean;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <Label>{label}</Label>
      <WeeklyHoursEditor prefix={prefix} initial={initial} optional={optional} />
    </div>
  );
}
