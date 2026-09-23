import { saveBookingSettingsAction } from "../actions";
import { PendingButton } from "../PendingButton";
import { field as fieldStyle, btn, panel, SectionTitle, Label } from "../ui";
import type { BookingSettings } from "@/lib/booking/types";
import { WeeklyHoursField } from "./WeeklyHoursEditor";
import { formatHolidayLines } from "./lines";

const COMMON_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Phoenix",
  "America/Toronto",
  "America/Vancouver",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Australia/Sydney",
  "Asia/Tokyo",
];

const SLOT_INTERVALS = [5, 10, 15, 20, 30, 45, 60, 90, 120];
const LEAD_TIMES = [0, 15, 30, 45, 60, 90, 120, 180, 240, 360, 720, 1440, 2880];

const leadTimeLabel = (m: number) => (m < 60 ? `${m} min` : m % 1440 === 0 ? `${m / 1440} day${m / 1440 > 1 ? "s" : ""}` : `${m / 60} hr`);

/**
 * "Hours & rules": business hours, holidays, and every timing rule the
 * availability engine reads (lib/booking/availability.ts). One form →
 * saveBookingSettingsAction, marked "section=hours" so the action knows which
 * slice of BookingSettings this post updates.
 */
export function HoursPanel({ settings }: { settings: BookingSettings }) {
  return (
    <section>
      <div data-fill="surface" style={panel}>
        <SectionTitle>Hours &amp; rules</SectionTitle>
        <form action={saveBookingSettingsAction}>
          <input type="hidden" name="section" value="hours" />

          <Label>Timezone</Label>
          <select name="timezone" defaultValue={settings.timezone} style={fieldStyle}>
            {[settings.timezone, ...COMMON_ZONES.filter((z) => z !== settings.timezone)].map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>

          <WeeklyHoursField label="Business hours" prefix="hours" initial={settings.hours} />

          <Label>Holidays — one per line: YYYY-MM-DD | label</Label>
          <textarea
            name="holidays"
            defaultValue={formatHolidayLines(settings.holidays)}
            rows={3}
            placeholder="2026-12-25 | Christmas Day"
            style={{ ...fieldStyle, fontFamily: "ui-monospace, monospace", fontSize: 13, resize: "vertical" }}
          />

          <div style={grid3}>
            <div>
              <Label>Slot interval</Label>
              <select name="slotIntervalMinutes" defaultValue={settings.slotIntervalMinutes} style={fieldStyle}>
                {SLOT_INTERVALS.map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Lead time (minimum notice)</Label>
              <select name="leadTimeMinutes" defaultValue={settings.leadTimeMinutes} style={fieldStyle}>
                {[settings.leadTimeMinutes, ...LEAD_TIMES.filter((m) => m !== settings.leadTimeMinutes)]
                  .sort((a, b) => a - b)
                  .map((m) => (
                    <option key={m} value={m}>
                      {leadTimeLabel(m)}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <Label>Daily cutoff (optional)</Label>
              <input name="dailyCutoff" type="time" defaultValue={settings.dailyCutoff} style={fieldStyle} />
            </div>
          </div>

          <div style={grid3}>
            <div>
              <Label>Max advance (days)</Label>
              <input name="maxAdvanceDays" type="number" min="1" defaultValue={settings.maxAdvanceDays} style={fieldStyle} />
            </div>
            <div>
              <Label>Buffer before (minutes)</Label>
              <input name="bufferBeforeMinutes" type="number" min="0" defaultValue={settings.bufferBeforeMinutes} style={fieldStyle} />
            </div>
            <div>
              <Label>Buffer after (minutes)</Label>
              <input name="bufferAfterMinutes" type="number" min="0" defaultValue={settings.bufferAfterMinutes} style={fieldStyle} />
            </div>
          </div>

          <Label>Default duration (minutes, when a booking names no service)</Label>
          <input name="defaultDurationMinutes" type="number" min="5" defaultValue={settings.defaultDurationMinutes} style={{ ...fieldStyle, width: 130 }} />

          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, margin: "6px 0 14px" }}>
            <label style={checkboxLabel}>
              <input type="checkbox" name="sameDayBooking" defaultChecked={settings.sameDayBooking} /> Allow same-day booking
            </label>
            <label style={checkboxLabel}>
              <input type="checkbox" name="waitlist" defaultChecked={settings.waitlist} /> Offer a waitlist when full
            </label>
            <label style={checkboxLabel}>
              <input type="checkbox" name="recurring" defaultChecked={settings.recurring} /> Allow repeat bookings
            </label>
            <label style={checkboxLabel}>
              <input type="checkbox" name="genderPreference" defaultChecked={settings.genderPreference} /> Ask a gender preference
            </label>
          </div>

          <Label>Provider selection</Label>
          <select name="confirmation" defaultValue={settings.confirmation} aria-label="How bookings are confirmed" style={{ ...fieldStyle, width: 320 }}>
            <option value="instant">Booked on the spot — the card confirms it</option>
            <option value="request">A request — you confirm it (phone-only booking)</option>
          </select>
          <select name="staffSelection" defaultValue={settings.staffSelection} style={{ ...fieldStyle, width: 220 }}>
            <option value="hidden">Hidden — never asked</option>
            <option value="optional">Optional — &ldquo;Anyone available&rdquo; first</option>
            <option value="required">Required — must pick a person</option>
          </select>

          <PendingButton pendingLabel="Saving…" style={btn as React.CSSProperties}>
            Save
          </PendingButton>
        </form>
      </div>
    </section>
  );
}

const grid3: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 };
const checkboxLabel: React.CSSProperties = { fontSize: 13, display: "flex", alignItems: "center", gap: 6 };
