"use client";

import { saveStaffAction } from "../actions";
import { PendingButton } from "../PendingButton";
import { field as fieldStyle, btn, Label } from "../ui";
import type { ServiceRow, StaffRow } from "@/lib/booking/types";
import { WeeklyHoursField } from "./WeeklyHoursEditor";
import { RowsEditor, SelectField, minuteOptions, type RowColumn } from "./RowsEditor";

/**
 * One provider's editor — also the "Add provider" form when `staff` is left
 * out. Time off is rows of date pickers, the preference tag and every
 * duration are dropdowns; the hidden fields post in the same line format the
 * server action already parses (app/admin/booking/lines.ts).
 */

const PREFERENCE_TAGS = ["Female", "Male", "Non-binary"];

const TIME_OFF_COLUMNS: RowColumn[] = [
  { key: "start", label: "First day off", kind: "date", required: true },
  { key: "end", label: "Last day off", kind: "date" },
  { key: "label", label: "Reason", placeholder: "Holiday" },
];

/** A stored time-off block as the date cells the editor shows (whole days). */
function timeOffRows(timeOff: StaffRow["timeOff"] | undefined) {
  return (timeOff ?? []).map((t) => {
    const endExclusive = new Date(t.end);
    endExclusive.setUTCDate(endExclusive.getUTCDate() - 1);
    return { start: t.start.slice(0, 10), end: endExclusive.toISOString().slice(0, 10), label: t.label ?? "" };
  });
}

export function StaffForm({ staff, services }: { staff?: StaffRow; services: ServiceRow[] }) {
  return (
    <form action={saveStaffAction}>
      {staff ? <input type="hidden" name="id" value={staff.id} /> : null}

      <div style={grid2}>
        <div>
          <Label>Name</Label>
          <input name="name" defaultValue={staff?.name} required style={fieldStyle} />
        </div>
        <div>
          <Label>Role</Label>
          <input name="role" defaultValue={staff?.role} placeholder="Stylist, Massage therapist…" style={fieldStyle} />
        </div>
      </div>

      <Label>Bio</Label>
      <textarea name="bio" defaultValue={staff?.bio} rows={3} style={{ ...fieldStyle, resize: "vertical" }} />

      <Label>Photo</Label>
      {staff?.photoUrl ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={staff.photoUrl} alt="" style={{ width: 48, height: 48, borderRadius: "var(--radius-sm)", objectFit: "cover" }} />
          <label style={checkboxLabel}>
            <input type="checkbox" name="removePhoto" /> Remove photo
          </label>
        </div>
      ) : null}
      <input type="file" name="photo" accept="image/*" style={fieldStyle} />

      <div style={grid3}>
        <div>
          <Label>Specialties (comma-separated)</Label>
          <input name="specialties" defaultValue={staff?.specialties.join(", ")} style={fieldStyle} />
        </div>
        <div>
          <Label>Languages (comma-separated)</Label>
          <input name="languages" defaultValue={staff?.languages.join(", ")} style={fieldStyle} />
        </div>
        <div>
          <Label>Credentials (comma-separated)</Label>
          <input name="credentials" defaultValue={staff?.credentials.join(", ")} style={fieldStyle} />
        </div>
      </div>

      <SelectField
        name="genderLabel"
        label="Preference tag (shown only when gender preference is on under Hours)"
        defaultValue={staff?.genderLabel ?? ""}
        options={[{ value: "", label: "None" }, ...PREFERENCE_TAGS.map((t) => ({ value: t, label: t }))]}
        width={240}
      />

      <WeeklyHoursField label="Own hours" prefix="hours" initial={staff?.hours ?? null} optional />

      <RowsEditor name="timeOff" label="Time off (whole days)" columns={TIME_OFF_COLUMNS} initial={timeOffRows(staff?.timeOff)} addLabel="+ Add time off" />

      {services.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <Label>Own price and length per service (blank = the service&apos;s own)</Label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {services.map((sv) => (
              <div key={sv.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, flex: "1 1 160px" }}>{sv.name}</span>
                <input
                  name={`priceOverride.${sv.id}`}
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Price"
                  aria-label={`${sv.name} price`}
                  defaultValue={staff?.priceOverrides[sv.id]}
                  style={{ ...fieldStyle, width: 110, marginBottom: 0 }}
                />
                <select
                  name={`durationOverride.${sv.id}`}
                  defaultValue={staff?.durationOverrides[sv.id] !== undefined ? String(staff.durationOverrides[sv.id]) : ""}
                  aria-label={`${sv.name} length`}
                  style={{ ...fieldStyle, width: 150, marginBottom: 0 }}
                >
                  {minuteOptions(staff?.durationOverrides[sv.id], "Service's own").map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <SelectField
        name="enabled"
        label="Bookable"
        defaultValue={(staff?.enabled ?? true) ? "on" : "off"}
        options={[
          { value: "on", label: "Yes — visitors can pick them" },
          { value: "off", label: "No — hidden for now" },
        ]}
        width={240}
      />

      <PendingButton pendingLabel={staff ? "Saving…" : "Adding…"} style={btn as React.CSSProperties}>
        {staff ? "Save" : "Add provider"}
      </PendingButton>
    </form>
  );
}

const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
const grid3: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 };
const checkboxLabel: React.CSSProperties = { fontSize: 12, display: "flex", alignItems: "center", gap: 6 };
