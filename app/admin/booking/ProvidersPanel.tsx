import { saveStaffAction, deleteStaffAction, moveStaffAction } from "../actions";
import { PendingButton } from "../PendingButton";
import { field as fieldStyle, btn, btnGhost, btnDanger, panel, SectionTitle, Label } from "../ui";
import type { ServiceRow, StaffRow } from "@/lib/booking/types";
import { WeeklyHoursField } from "./WeeklyHoursEditor";
import { formatTimeOffLines } from "./lines";

/**
 * One panel per provider — collapsed summary, expands to the full editor —
 * plus an "Add provider" form. Own hours default to the business hours;
 * per-service price/duration only need a row when the tenant sells services.
 */
export function ProvidersPanel({ staff, services }: { staff: StaffRow[]; services: ServiceRow[] }) {
  return (
    <section>
      <div data-fill="surface" style={panel}>
        <SectionTitle>Providers</SectionTitle>
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13 }}>
          The people who perform your services. Leave a service&apos;s &ldquo;who can perform
          it&rdquo; empty on the Services tab and anyone here can take it.
        </p>
      </div>

      {staff.length === 0 ? (
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 14 }}>No providers yet — add one below.</p>
      ) : null}

      {staff.map((s, i) => (
        <StaffRowPanel key={s.id} s={s} index={i} count={staff.length} services={services} />
      ))}

      <div data-fill="surface" style={panel}>
        <SectionTitle>Add a provider</SectionTitle>
        <StaffForm key={staff.length} services={services} />
      </div>
    </section>
  );
}

/** One provider's collapsed summary + editor; also the element the copilot reveals alone. */
export function StaffRowPanel({
  s,
  index,
  count,
  services,
}: {
  s: StaffRow;
  /** Position in the panel's order, for the move buttons. */
  index: number;
  count: number;
  services: ServiceRow[];
}) {
  const i = index;
  return (
        <div data-fill="surface" data-element={s.id} style={panel}>
          <details>
            <summary style={summaryStyle}>
              {s.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.photoUrl} alt="" style={thumb} />
              ) : (
                <div style={{ ...thumb, background: "var(--bg-soft)" }} />
              )}
              <strong style={{ fontSize: 14, flex: "1 1 160px" }}>{s.name}</strong>
              <span style={meta}>{s.role || "—"}</span>
              <span style={{ ...meta, color: s.enabled ? "var(--success-on-surface)" : "var(--on-surface)" }}>
                {s.enabled ? "Enabled" : "Disabled"}
              </span>
              <span style={{ fontSize: 12, textDecoration: "underline" }}>Edit</span>
            </summary>
            <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
              <StaffForm staff={s} services={services} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {i > 0 ? <MoveButton id={s.id} dir="up" /> : null}
                {i < count - 1 ? <MoveButton id={s.id} dir="down" /> : null}
                <form action={deleteStaffAction} style={{ marginLeft: "auto" }}>
                  <input type="hidden" name="id" value={s.id} />
                  <PendingButton pendingLabel="Removing…" style={btnDanger as React.CSSProperties}>
                    Remove
                  </PendingButton>
                </form>
              </div>
            </div>
          </details>
        </div>
  );
}

function StaffForm({ staff, services }: { staff?: StaffRow; services: ServiceRow[] }) {
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
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
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

      <Label>Preference tag</Label>
      <input name="genderLabel" defaultValue={staff?.genderLabel} placeholder="Female, Male, Non-binary…" style={fieldStyle} />
      <p style={{ fontSize: 12, fontStyle: "italic", margin: "-4px 0 12px", color: "var(--on-surface)" }}>
        Shown only when gender preference is on under Hours &amp; rules.
      </p>

      <WeeklyHoursField label="Own hours" prefix="hours" initial={staff?.hours ?? null} optional />

      <Label>Time off — one per line: start date | end date | label (whole days)</Label>
      <textarea
        name="timeOff"
        defaultValue={formatTimeOffLines(staff?.timeOff)}
        rows={2}
        placeholder="2026-12-24 | 2026-12-27 | Holiday"
        style={{ ...fieldStyle, fontFamily: "ui-monospace, monospace", fontSize: 13, resize: "vertical" }}
      />

      {services.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <Label>Price / duration overrides (blank = the service&apos;s own)</Label>
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
                  defaultValue={staff?.priceOverrides[sv.id]}
                  style={{ ...fieldStyle, width: 110, marginBottom: 0 }}
                />
                <input
                  name={`durationOverride.${sv.id}`}
                  type="number"
                  min="5"
                  placeholder="Minutes"
                  defaultValue={staff?.durationOverrides[sv.id]}
                  style={{ ...fieldStyle, width: 110, marginBottom: 0 }}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
        <input type="checkbox" name="enabled" defaultChecked={staff?.enabled ?? true} /> Enabled
      </label>

      <PendingButton pendingLabel={staff ? "Saving…" : "Adding…"} style={btn as React.CSSProperties}>
        {staff ? "Save" : "Add provider"}
      </PendingButton>
    </form>
  );
}

function MoveButton({ id, dir }: { id: string; dir: "up" | "down" }) {
  return (
    <form action={moveStaffAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="dir" value={dir} />
      <PendingButton pendingLabel="…" style={btnGhost as React.CSSProperties}>
        {dir === "up" ? "↑ Earlier" : "↓ Later"}
      </PendingButton>
    </form>
  );
}

const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
const grid3: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 };
const summaryStyle: React.CSSProperties = {
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  listStyle: "none",
};
const thumb: React.CSSProperties = { width: 48, height: 48, borderRadius: "var(--radius-sm)", objectFit: "cover", flexShrink: 0 };
const meta: React.CSSProperties = { fontSize: 12, color: "var(--on-surface)", whiteSpace: "nowrap" };
