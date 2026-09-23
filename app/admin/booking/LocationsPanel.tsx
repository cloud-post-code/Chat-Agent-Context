import { saveLocationAction, deleteLocationAction, moveLocationAction } from "../actions";
import { PendingButton } from "../PendingButton";
import { field as fieldStyle, btn, btnGhost, btnDanger, panel, SectionTitle, Label } from "../ui";
import { LOCATION_KINDS, type LocationKind, type LocationRow } from "@/lib/booking/types";
import { WeeklyHoursField } from "./WeeklyHoursEditor";

const KIND_LABELS: Record<LocationKind, string> = {
  business: "A branch",
  virtual: "Online",
  mobile: "We come to you",
};

// A short, common list — not exhaustive; the tenant's own zone is always an
// option because the select falls back to it via defaultValue.
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

/**
 * One panel per location — collapsed summary, expands to the full editor —
 * plus an "Add location" form.
 */
export function LocationsPanel({ locations }: { locations: LocationRow[] }) {
  return (
    <section>
      <div data-fill="surface" style={panel}>
        <SectionTitle>Locations</SectionTitle>
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13 }}>
          Branches, an online option, and a service area for coming to the customer. Leave a
          service&apos;s &ldquo;where&rdquo; empty on the Services tab and every location offers it.
        </p>
      </div>

      {locations.length === 0 ? (
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 14 }}>No locations yet — add one below.</p>
      ) : null}

      {locations.map((l, i) => (
        <div key={l.id} data-fill="surface" style={panel}>
          <details>
            <summary style={summaryStyle}>
              <strong style={{ fontSize: 14, flex: "1 1 160px" }}>{l.name}</strong>
              <span style={meta}>{KIND_LABELS[l.kind]}</span>
              <span style={{ ...meta, color: l.enabled ? "var(--success-on-surface)" : "var(--on-surface)" }}>
                {l.enabled ? "Enabled" : "Disabled"}
              </span>
              <span style={{ fontSize: 12, textDecoration: "underline" }}>Edit</span>
            </summary>
            <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
              <LocationForm location={l} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {i > 0 ? <MoveButton id={l.id} dir="up" /> : null}
                {i < locations.length - 1 ? <MoveButton id={l.id} dir="down" /> : null}
                <form action={deleteLocationAction} style={{ marginLeft: "auto" }}>
                  <input type="hidden" name="id" value={l.id} />
                  <PendingButton pendingLabel="Removing…" style={btnDanger as React.CSSProperties}>
                    Remove
                  </PendingButton>
                </form>
              </div>
            </div>
          </details>
        </div>
      ))}

      <div data-fill="surface" style={panel}>
        <SectionTitle>Add a location</SectionTitle>
        <LocationForm key={locations.length} />
      </div>
    </section>
  );
}

function LocationForm({ location }: { location?: LocationRow }) {
  return (
    <form action={saveLocationAction}>
      {location ? <input type="hidden" name="id" value={location.id} /> : null}

      <div style={grid2}>
        <div>
          <Label>Name</Label>
          <input name="name" defaultValue={location?.name} required style={fieldStyle} />
        </div>
        <div>
          <Label>Kind</Label>
          <select name="kind" defaultValue={location?.kind ?? "business"} style={fieldStyle}>
            {LOCATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={grid2}>
        <div>
          <Label>Address</Label>
          <input name="address" defaultValue={location?.address} style={fieldStyle} />
        </div>
        <div>
          <Label>Phone</Label>
          <input name="phone" defaultValue={location?.phone} style={fieldStyle} />
        </div>
      </div>

      <Label>Timezone</Label>
      <select name="timezone" defaultValue={location?.timezone ?? ""} style={fieldStyle}>
        <option value="">Same as business</option>
        {COMMON_ZONES.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </select>

      <WeeklyHoursField label="Hours" prefix="hours" initial={location?.hours ?? null} optional />

      <div style={box}>
        <Label>Service area (for &ldquo;we come to you&rdquo;)</Label>
        <Label>Postal codes served (comma or space-separated; blank = everywhere in the radius)</Label>
        <input name="postalCodes" defaultValue={location?.serviceArea.postalCodes.join(", ")} style={fieldStyle} />
        <div style={grid2}>
          <div>
            <Label>Radius (miles)</Label>
            <input name="radiusMiles" type="number" min="0" step="0.1" defaultValue={location?.serviceArea.radiusMiles} style={fieldStyle} />
          </div>
          <div>
            <Label>Travel fee</Label>
            <input name="travelFee" type="number" min="0" step="0.01" defaultValue={location?.serviceArea.travelFee} style={fieldStyle} />
          </div>
        </div>
        <Label>Description (shown to visitors, e.g. &ldquo;Within 20 miles of downtown&rdquo;)</Label>
        <input name="serviceAreaDescription" defaultValue={location?.serviceArea.description} style={{ ...fieldStyle, marginBottom: 0 }} />
      </div>

      <Label>Meeting link (for &ldquo;Online&rdquo;)</Label>
      <input name="meetingLink" defaultValue={location?.meetingLink} placeholder="https://…" style={fieldStyle} />

      <Label>Note</Label>
      <textarea name="note" defaultValue={location?.note} rows={2} style={{ ...fieldStyle, resize: "vertical" }} />

      <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
        <input type="checkbox" name="enabled" defaultChecked={location?.enabled ?? true} /> Enabled
      </label>

      <PendingButton pendingLabel={location ? "Saving…" : "Adding…"} style={btn as React.CSSProperties}>
        {location ? "Save" : "Add location"}
      </PendingButton>
    </form>
  );
}

function MoveButton({ id, dir }: { id: string; dir: "up" | "down" }) {
  return (
    <form action={moveLocationAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="dir" value={dir} />
      <PendingButton pendingLabel="…" style={btnGhost as React.CSSProperties}>
        {dir === "up" ? "↑ Earlier" : "↓ Later"}
      </PendingButton>
    </form>
  );
}

const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
const box: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: 12,
  marginBottom: 12,
};
const summaryStyle: React.CSSProperties = {
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  listStyle: "none",
};
const meta: React.CSSProperties = { fontSize: 12, color: "var(--on-surface)", whiteSpace: "nowrap" };
