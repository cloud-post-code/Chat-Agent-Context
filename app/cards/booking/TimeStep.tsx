"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BookingFlow, BookingSelection, DayAvailability, Slot } from "@/lib/booking/types";
import { formatInZone, shiftDays, ymd, zonedParts, zonedToUtc } from "@/lib/booking/time";
import { getAvailabilityDay, getAvailabilityMonth } from "./api";
import { Chip, chipRow, inputStyle, linkBtn, liveBtn, sectionLabel } from "./ui";
import { stepFrame } from "./ServiceStep";

/** Shown when an earlier card changed and the chosen time is no longer offered for it. */
export const STALE_TIME = "That time isn't available for this choice any more — pick another.";

const COMMON_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Australia/Sydney",
];

function visitorZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map((s) => Number.parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

type Grouped = Record<"Morning" | "Afternoon" | "Evening", Slot[]>;

function groupSlots(slots: Slot[], zone: string): Grouped {
  const out: Grouped = { Morning: [], Afternoon: [], Evening: [] };
  for (const s of slots) {
    const hour = zonedParts(new Date(s.startsAt), zone).hh;
    if (hour < 12) out.Morning.push(s);
    else if (hour < 17) out.Afternoon.push(s);
    else out.Evening.push(s);
  }
  return out;
}

export function TimeStep({
  flow,
  selection,
  setSelection,
  slug,
  onNext,
  onBack,
  nextLabel,
  locked = false,
}: {
  flow: BookingFlow;
  selection: BookingSelection;
  setSelection: (s: BookingSelection) => void;
  slug: string;
  onNext: () => void;
  /** Left out when earlier steps stay editable in the thread: no Back button. */
  onBack?: () => void;
  /** "Next" by default; a step already answered reads "Update". */
  nextLabel?: string;
  /** The booking is done (or abandoned): controls disabled, no button. */
  locked?: boolean;
}) {
  const businessTz = flow.business.timezone;
  const [zone, setZone] = useState(() => selection.timezone || visitorZone());
  const todayBiz = zonedParts(new Date(), businessTz).date;
  // A time already chosen (the card re-mounted, or came back from storage)
  // opens on its own day, with that day's times loaded underneath.
  const [initialDate] = useState<string | null>(() => (selection.startsAt ? ymd(new Date(selection.startsAt), businessTz) : null));
  const [month, setMonth] = useState(() => (initialDate ?? todayBiz).slice(0, 7));
  const [days, setDays] = useState<DayAvailability[]>([]);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(initialDate);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [dayFull, setDayFull] = useState(false);
  const [dayStart, setDayStart] = useState<string | null>(null);
  const [loadingDay, setLoadingDay] = useState(false);
  const [earliest, setEarliest] = useState<Slot | null>(null);
  const [stale, setStale] = useState(false);

  const addonKey = selection.addonIds.join(",");
  // Everything the offered times depend on. When it changes under a chosen
  // time, that day is fetched again and the time kept only if still offered.
  const choiceKey = [selection.serviceId, selection.variantId, addonKey, selection.staffId, selection.locationId].join("|");
  // The choices the current time was picked under: picking a slot can itself
  // fill in staffId, which must not read as "the provider changed".
  const pickedUnder = useRef<string | null>(null);
  const latest = useRef(selection);
  latest.current = selection;

  useEffect(() => {
    let cancelled = false;
    setLoadingMonth(true);
    getAvailabilityMonth({
      slug,
      serviceId: selection.serviceId,
      variantId: selection.variantId,
      addonIds: selection.addonIds,
      staffId: selection.staffId,
      locationId: selection.locationId,
      month,
    }).then((res) => {
      if (cancelled) return;
      setLoadingMonth(false);
      if (res.ok) {
        setDays(res.days ?? []);
        setEarliest(res.earliest ?? null);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, slug, selection.serviceId, selection.variantId, addonKey, selection.staffId, selection.locationId]);

  /**
   * Load one day's times. With `verify`, the chosen time is checked against
   * what came back: gone (or, for a waitlist entry, the day no longer full)
   * means it is let go and the visitor told to pick another.
   */
  function loadDay(date: string, verify = false) {
    const sel = latest.current;
    setSelectedDate(date);
    setLoadingDay(true);
    getAvailabilityDay({
      slug,
      serviceId: sel.serviceId,
      variantId: sel.variantId,
      addonIds: sel.addonIds,
      staffId: sel.staffId,
      locationId: sel.locationId,
      date,
    }).then((res) => {
      setLoadingDay(false);
      if (!res.ok) return;
      const dayslots = res.slots ?? [];
      setSlots(dayslots);
      setDayFull(!!res.full);
      setDayStart(res.dayStart ?? null);
      if (!verify || !sel.startsAt) return;
      const stillOffered = sel.waitlist
        ? !!res.full
        : dayslots.some((s) => s.startsAt === sel.startsAt && (!sel.staffId || s.staffIds.includes(sel.staffId)));
      if (!stillOffered) {
        setStale(true);
        setSelection({ ...latest.current, startsAt: "", waitlist: false });
      }
    });
  }
  const pickDay = (date: string) => loadDay(date);

  useEffect(() => {
    if (!selection.startsAt || pickedUnder.current === choiceKey) return;
    pickedUnder.current = choiceKey;
    loadDay(ymd(new Date(selection.startsAt), businessTz), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choiceKey]);

  const minMonth = todayBiz.slice(0, 7);
  const maxDate = shiftDays(todayBiz, flow.rules.maxAdvanceDays);
  const maxMonth = maxDate.slice(0, 7);

  function shiftMonth(n: number) {
    const [y, m] = month.split("-").map((s) => Number.parseInt(s, 10));
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    const next = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (next < minMonth || next > maxMonth) return;
    setMonth(next);
    setSelectedDate(null);
    setSlots([]);
  }

  // "Earliest available" is a slot, not just a day: one tap picks it, and the
  // day's other times load underneath in case the visitor wants a later one.
  function jumpToEarliest() {
    if (!earliest) return;
    const date = ymd(new Date(earliest.startsAt), businessTz);
    setMonth(date.slice(0, 7));
    pickDay(date);
    pickSlot(earliest);
  }

  const zones = useMemo(() => [...new Set([zone, businessTz, ...COMMON_ZONES])], [zone, businessTz]);

  function pickSlot(slot: Slot) {
    const staffId = selection.staffId ?? (slot.staffIds[0] ?? null);
    pickedUnder.current = [selection.serviceId, selection.variantId, addonKey, staffId, selection.locationId].join("|");
    setStale(false);
    setSelection({
      ...selection,
      startsAt: slot.startsAt,
      timezone: zone,
      waitlist: false,
      staffId,
    });
  }

  function joinWaitlist() {
    if (!selectedDate) return;
    const startIso = dayStart || zonedToUtc(selectedDate, "09:00", businessTz).toISOString();
    pickedUnder.current = choiceKey;
    setStale(false);
    setSelection({ ...selection, startsAt: startIso, timezone: zone, waitlist: true });
  }

  const grouped = groupSlots(slots, zone);
  const canNext = !!selection.startsAt;

  return (
    <fieldset disabled={locked} style={stepFrame}>
      {stale && <p style={{ color: "var(--danger-on-bg-soft)", fontSize: 13, margin: "0 0 10px" }}>{STALE_TIME}</p>}
      {earliest && (
        <button type="button" onClick={jumpToEarliest} style={{ ...linkBtn, marginBottom: 10 }}>
          Earliest available — {formatInZone(new Date(earliest.startsAt), zone)}
        </button>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <button type="button" onClick={() => shiftMonth(-1)} disabled={month <= minMonth} style={linkBtn} aria-label="Previous month">
          ‹
        </button>
        <strong>{monthLabel(month)}</strong>
        <button type="button" onClick={() => shiftMonth(1)} disabled={month >= maxMonth} style={linkBtn} aria-label="Next month">
          ›
        </button>
      </div>
      <MonthGrid month={month} days={days} today={todayBiz} maxDate={maxDate} selected={selectedDate} onPick={pickDay} loading={loadingMonth} />
      {selectedDate && (
        <div style={{ marginTop: 14 }}>
          <div style={sectionLabel}>Times for {selectedDate}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <label htmlFor="booking-zone" style={{ fontSize: 12 }}>
              Zone
            </label>
            <select id="booking-zone" value={zone} onChange={(e) => setZone(e.target.value)} style={{ ...inputStyle, width: "auto", marginBottom: 0 }}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>
          {zone !== businessTz && (
            <p style={{ fontSize: 12, opacity: 0.8 }}>
              Times shown in {zone}; the business is in {businessTz}.
            </p>
          )}
          {loadingDay && <p style={{ fontSize: 13 }}>Loading times…</p>}
          {!loadingDay && slots.length === 0 && !dayFull && <p style={{ fontSize: 13 }}>No times that day.</p>}
          {(["Morning", "Afternoon", "Evening"] as const).map(
            (label) =>
              grouped[label].length > 0 && (
                <div key={label} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>{label}</div>
                  <div style={chipRow}>
                    {grouped[label].map((s) => (
                      <Chip key={s.startsAt} selected={selection.startsAt === s.startsAt} onClick={() => pickSlot(s)}>
                        {formatInZone(new Date(s.startsAt), zone, { weekday: undefined, month: undefined, day: undefined })}
                      </Chip>
                    ))}
                  </div>
                </div>
              ),
          )}
          {dayFull && flow.rules.waitlist && (
            <button type="button" onClick={joinWaitlist} style={{ ...linkBtn, marginTop: 6 }}>
              Join the waitlist for {selectedDate}
            </button>
          )}
        </div>
      )}
      {flow.rules.recurring && <RecurrenceControl selection={selection} setSelection={setSelection} />}
      {!locked && (
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          {onBack && (
            <button type="button" onClick={onBack} style={linkBtn}>
              Back
            </button>
          )}
          <button type="button" onClick={onNext} disabled={!canNext} style={{ ...linkBtn, ...liveBtn, opacity: canNext ? 1 : 0.55 }}>
            {nextLabel ?? "Next"}
          </button>
        </div>
      )}
    </fieldset>
  );
}

function MonthGrid({
  month,
  days,
  today,
  maxDate,
  selected,
  onPick,
  loading,
}: {
  month: string;
  days: DayAvailability[];
  today: string;
  maxDate: string;
  selected: string | null;
  onPick: (d: string) => void;
  loading: boolean;
}) {
  const [y, m] = month.split("-").map((s) => Number.parseInt(s, 10));
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Mon-first: JS getUTCDay is 0=Sun..6=Sat; shift so Mon=0..Sun=6.
  const firstWeekday = (first.getUTCDay() + 6) % 7;
  const byDate = new Map(days.map((d) => [d.date, d]));
  const cells: (string | null)[] = Array(firstWeekday).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, fontSize: 11, opacity: 0.7, marginBottom: 4 }}>
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <div key={d} style={{ textAlign: "center" }}>
            {d}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {cells.map((date, i) => {
          if (!date) return <div key={`e${i}`} />;
          const info = byDate.get(date);
          const inRange = date >= today && date <= maxDate;
          const disabled = !inRange || (info ? !info.open : false);
          return (
            <button
              key={date}
              type="button"
              disabled={disabled}
              onClick={() => onPick(date)}
              aria-current={selected === date ? "date" : undefined}
              style={{
                aspectRatio: "1 / 1",
                fontSize: 12,
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                background: selected === date ? "var(--on-surface)" : "var(--surface)",
                color: selected === date ? "var(--surface)" : "var(--on-surface)",
                opacity: disabled ? 0.4 : 1,
                cursor: disabled ? "default" : "pointer",
                minHeight: 32,
              }}
            >
              {Number.parseInt(date.slice(-2), 10)}
            </button>
          );
        })}
      </div>
      {loading && <p style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>Loading availability…</p>}
    </div>
  );
}

function RecurrenceControl({
  selection,
  setSelection,
}: {
  selection: BookingSelection;
  setSelection: (s: BookingSelection) => void;
}) {
  const freq = selection.recurrence?.frequency ?? "";
  const count = selection.recurrence?.count ?? 4;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={sectionLabel}>Repeat</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select
          value={freq}
          onChange={(e) => {
            const v = e.target.value as "weekly" | "biweekly" | "monthly" | "";
            setSelection({ ...selection, recurrence: v ? { frequency: v, count } : null });
          }}
          style={{ ...inputStyle, width: "auto", marginBottom: 0 }}
        >
          <option value="">No</option>
          <option value="weekly">Weekly</option>
          <option value="biweekly">Every 2 weeks</option>
          <option value="monthly">Monthly</option>
        </select>
        {freq && (
          <select
            value={count}
            onChange={(e) =>
              setSelection({ ...selection, recurrence: { frequency: freq, count: Number.parseInt(e.target.value, 10) } })
            }
            style={{ ...inputStyle, width: "auto", marginBottom: 0 }}
          >
            {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
