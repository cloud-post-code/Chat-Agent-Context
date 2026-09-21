import {
  setBookingEnabledAction,
  deleteAppointmentFieldAction,
  moveAppointmentFieldAction,
} from "./actions";
import { BookingFieldForm } from "./BookingFieldForm";
import { PendingButton } from "./PendingButton";
import { panel, btn, btnGhost, btnDanger, SectionTitle } from "./ui";
import type { BookingConfig } from "@/lib/appointmentTypes";

/**
 * The Appointments settings: the booking toggle and the question catalog the
 * wizard asks from. Rendered inside the Calendar panel, below the month grid,
 * so the switch and the questions live with the bookings they produce. Same
 * form-per-row idiom as DirectivesPanel.
 *
 * Exported as a fragment rather than its own <section>: the Calendar panel
 * owns the section these render into.
 */

export function BookingSettings({ config }: { config: BookingConfig }) {
  return (
    <>
      <div data-fill="surface" style={panel}>
        <SectionTitle>Appointments</SectionTitle>
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13, marginBottom: 10 }}>
          Let visitors book a time with you right in the chat. The agent draws a
          step-by-step booking flow that asks the questions below, one at a
          time, then a date and time. Bookings land on your Calendar.
        </p>
        <form action={setBookingEnabledAction} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* A hidden unchecked value submits "off"; the checkbox overrides it. */}
          {config.enabled ? null : <input type="hidden" name="enabled" value="on" />}
          <PendingButton
            pendingLabel="Saving…"
            style={(config.enabled ? btnDanger : btn) as React.CSSProperties}
          >
            {config.enabled ? "Turn booking off" : "Turn booking on"}
          </PendingButton>
          <span style={{ fontSize: 13, color: "var(--on-surface)" }}>
            Booking is <strong>{config.enabled ? "on" : "off"}</strong>.
          </span>
        </form>
      </div>

      {config.enabled ? (
        <>
          {config.fields.map((f, i) => (
            <div key={f.key} data-fill="surface" style={panel}>
              <BookingFieldForm field={f} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {i > 0 ? <MoveButton fieldKey={f.key} dir="up" /> : null}
                {i < config.fields.length - 1 ? <MoveButton fieldKey={f.key} dir="down" /> : null}
                <form action={deleteAppointmentFieldAction} style={{ marginLeft: "auto" }}>
                  <input type="hidden" name="key" value={f.key} />
                  <PendingButton pendingLabel="Removing…" style={btnDanger as React.CSSProperties}>
                    Remove
                  </PendingButton>
                </form>
              </div>
            </div>
          ))}

          {/* Keyed by the catalog's size so a successful Add remounts the form
              and its type picker falls back to the default. */}
          <div data-fill="surface" style={panel}>
            <BookingFieldForm key={config.fields.length} />
          </div>
        </>
      ) : null}
    </>
  );
}

function MoveButton({ fieldKey, dir }: { fieldKey: string; dir: "up" | "down" }) {
  return (
    <form action={moveAppointmentFieldAction}>
      <input type="hidden" name="key" value={fieldKey} />
      <input type="hidden" name="dir" value={dir} />
      <PendingButton pendingLabel="…" style={btnGhost as React.CSSProperties}>
        {dir === "up" ? "↑ Earlier" : "↓ Later"}
      </PendingButton>
    </form>
  );
}
