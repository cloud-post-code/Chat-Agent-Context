import { saveBookingSettingsAction } from "../actions";
import { PendingButton } from "../PendingButton";
import { field as fieldStyle, btn, panel, SectionTitle, Label } from "../ui";
import type { BookingSettings } from "@/lib/booking/types";
import { WeeklyHoursField } from "./WeeklyHoursEditor";
import { RowsEditor, SelectField, minuteOptions, type RowColumn } from "./RowsEditor";

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
const ADVANCE_DAYS = [7, 14, 30, 60, 90, 120, 180, 365];
const BUFFER_MINUTES = [0, 5, 10, 15, 20, 30, 45, 60];

const leadTimeLabel = (m: number) => (m === 0 ? "None" : m < 60 ? `${m} min` : m % 1440 === 0 ? `${m / 1440} day${m / 1440 > 1 ? "s" : ""}` : `${m / 60} hr`);
const withCurrent = (presets: number[], current: number) => [...new Set([...presets, current])].sort((a, b) => a - b);
const bufferOptions = (current: number) => withCurrent(BUFFER_MINUTES, current).map((m) => ({ value: String(m), label: m ? `${m} min` : "None" }));

const HOLIDAY_COLUMNS: RowColumn[] = [
  { key: "date", label: "Date", kind: "date", required: true },
  { key: "label", label: "What", placeholder: "Christmas Day" },
];

/**
 * "Hours & rules": business hours, holidays, and every timing rule the
 * availability engine reads (lib/booking/availability.ts). Every rule with a
 * known set of answers is a dropdown; holidays are date rows. One form →
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

          <RowsEditor
            name="holidays"
            label="Closed days"
            columns={HOLIDAY_COLUMNS}
            initial={settings.holidays.map((h) => ({ date: h.date, label: h.label ?? "" }))}
            addLabel="+ Add a closed day"
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
            <SelectField
              name="maxAdvanceDays"
              label="How far ahead visitors can book"
              defaultValue={String(settings.maxAdvanceDays)}
              options={withCurrent(ADVANCE_DAYS, settings.maxAdvanceDays).map((d) => ({ value: String(d), label: d % 7 === 0 && d < 60 ? `${d / 7} week${d > 7 ? "s" : ""}` : d === 365 ? "1 year" : `${d} days` }))}
            />
            <SelectField name="bufferBeforeMinutes" label="Gap before every booking" defaultValue={String(settings.bufferBeforeMinutes)} options={bufferOptions(settings.bufferBeforeMinutes)} />
            <SelectField name="bufferAfterMinutes" label="Gap after every booking" defaultValue={String(settings.bufferAfterMinutes)} options={bufferOptions(settings.bufferAfterMinutes)} />
          </div>

          <SelectField
            name="defaultDurationMinutes"
            label="Length of a booking that names no service"
            defaultValue={String(settings.defaultDurationMinutes)}
            options={minuteOptions(settings.defaultDurationMinutes)}
            width={220}
          />

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

          <div style={grid2}>
            <SelectField
              name="confirmation"
              label="How a booking is confirmed"
              defaultValue={settings.confirmation}
              options={[
                { value: "instant", label: "Booked on the spot — the card confirms it" },
                { value: "request", label: "A request — you confirm it" },
              ]}
            />
            <SelectField
              name="staffSelection"
              label="Picking a provider"
              defaultValue={settings.staffSelection}
              options={[
                { value: "optional", label: "Optional — “Anyone available” first" },
                { value: "required", label: "Required — must pick a person" },
                { value: "hidden", label: "Hidden — never asked" },
              ]}
            />
          </div>

          <PendingButton pendingLabel="Saving…" style={btn as React.CSSProperties}>
            Save
          </PendingButton>
        </form>
      </div>
    </section>
  );
}

const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
const grid3: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 };
const checkboxLabel: React.CSSProperties = { fontSize: 13, display: "flex", alignItems: "center", gap: 6 };
