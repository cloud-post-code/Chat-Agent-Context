import { deleteServiceAction, moveServiceAction } from "../actions";
import { BookingToggle } from "../BookingPanel";
import { PendingButton } from "../PendingButton";
import { panel, btnGhost, btnDanger, SectionTitle } from "../ui";
import { pricingLabel, formatDuration, type ServiceRow, type StaffRow, type LocationRow } from "@/lib/booking/types";
import { ServiceForm } from "./ServiceForm";

/**
 * One panel per service — a collapsed summary row that expands to the full
 * editor — plus an "Add service" form. The booking on/off switch sits at the
 * top: turning booking on is the first thing setting up services needs, and
 * it must never be more than one tab away.
 */
export function ServicesPanel({
  services,
  staff,
  locations,
  currency,
  bookingEnabled,
}: {
  services: ServiceRow[];
  staff: StaffRow[];
  locations: LocationRow[];
  currency: string;
  bookingEnabled: boolean;
}) {
  const categories = [...new Set(services.map((s) => s.category).filter(Boolean))];

  return (
    <section>
      <BookingToggle enabled={bookingEnabled} />

      <div data-fill="surface" style={panel}>
        <SectionTitle>Services</SectionTitle>
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13 }}>
          What visitors can book — pricing, duration, who performs it and where. Order here is
          the order the booking card shows them in.
        </p>
      </div>

      {services.length === 0 ? (
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 14 }}>No services yet — add one below.</p>
      ) : null}

      {services.map((s, i) => (
        <div key={s.id} data-fill="surface" style={panel}>
          <details>
            <summary style={summaryStyle}>
              {s.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.imageUrl} alt="" style={thumb} />
              ) : (
                <div style={{ ...thumb, background: "var(--bg-soft)" }} />
              )}
              <strong style={{ fontSize: 14, flex: "1 1 160px" }}>{s.name}</strong>
              <span style={meta}>{s.category || "—"}</span>
              <span style={meta}>{pricingLabel(s.pricing, currency)}</span>
              <span style={meta}>{formatDuration(s.durationMinutes)}</span>
              <span style={{ ...meta, color: s.enabled ? "var(--success-on-surface)" : "var(--on-surface)" }}>
                {s.enabled ? "Enabled" : "Disabled"}
              </span>
              <span style={{ fontSize: 12, textDecoration: "underline" }}>Edit</span>
            </summary>
            <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
              <ServiceForm service={s} staff={staff} locations={locations} categories={categories} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {i > 0 ? <MoveButton id={s.id} dir="up" /> : null}
                {i < services.length - 1 ? <MoveButton id={s.id} dir="down" /> : null}
                <form action={deleteServiceAction} style={{ marginLeft: "auto" }}>
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
        <SectionTitle>Add a service</SectionTitle>
        <ServiceForm key={services.length} staff={staff} locations={locations} categories={categories} />
      </div>
    </section>
  );
}

function MoveButton({ id, dir }: { id: string; dir: "up" | "down" }) {
  return (
    <form action={moveServiceAction}>
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
