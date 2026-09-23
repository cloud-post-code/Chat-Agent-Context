import { deleteServiceAction, moveServiceAction, refreshServicesFromSiteAction } from "../actions";
import { BookingToggle } from "../BookingPanel";
import { PendingButton } from "../PendingButton";
import { panel, field as fieldStyle, btn, btnGhost, btnDanger, SectionTitle } from "../ui";
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
  siteUrl,
  notice,
}: {
  services: ServiceRow[];
  staff: StaffRow[];
  locations: LocationRow[];
  currency: string;
  bookingEnabled: boolean;
  /** The site onboarding read, when one is on file — the refresh's default. */
  siteUrl?: string | null;
  /** The last refresh's one-line result, carried back on the query string. */
  notice?: string;
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
        {/* The same read onboarding does, on demand: prices, durations, add-ons,
            policies and photos from the site, filling only what is still blank.
            Anything set by hand here is kept. */}
        <form action={refreshServicesFromSiteAction} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
          <input
            name="site"
            type="url"
            defaultValue={siteUrl ?? ""}
            placeholder="https://your-site.example"
            aria-label="Website to read"
            style={{ ...fieldStyle, width: "auto", flex: "1 1 240px", marginBottom: 0 }}
          />
          <PendingButton pendingLabel="Reading your site…" style={btn as React.CSSProperties}>
            Refresh from my site
          </PendingButton>
          <span style={{ fontSize: 12, fontStyle: "italic", color: "var(--on-surface)", flex: "1 1 100%" }}>
            Fills in prices, durations, add-ons, deposits, policies and photos the site states.
            Only blanks are filled — what you have typed here stays.
          </span>
        </form>
        {notice ? (
          <p role="status" style={{ fontSize: 13, marginTop: 10, color: "var(--on-surface)" }}>
            {notice}
          </p>
        ) : null}
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
