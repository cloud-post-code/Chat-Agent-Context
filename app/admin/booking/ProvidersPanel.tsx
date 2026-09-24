import { deleteStaffAction, moveStaffAction } from "../actions";
import { PendingButton } from "../PendingButton";
import { btnGhost, btnDanger, panel, SectionTitle } from "../ui";
import type { ServiceRow, StaffRow } from "@/lib/booking/types";
import { StaffForm } from "./StaffForm";

/**
 * One panel per provider — collapsed summary, expands to the full editor
 * (StaffForm) — plus an "Add provider" form. Own hours default to the
 * business hours; per-service price/duration only need a row when the tenant
 * sells services.
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
        <div key={s.id} data-fill="surface" style={panel}>
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
                {i < staff.length - 1 ? <MoveButton id={s.id} dir="down" /> : null}
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
      ))}

      <div data-fill="surface" style={panel}>
        <SectionTitle>Add a provider</SectionTitle>
        <StaffForm key={staff.length} services={services} />
      </div>
    </section>
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
