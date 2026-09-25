import { setBookingEnabledAction } from "./actions";
import { PendingButton } from "./PendingButton";
import { panel, btn, btnDanger, SectionTitle } from "./ui";

/**
 * The booking on/off switch. The question catalog lives in the Booking
 * section's Form tab (app/admin/booking/FormPanel.tsx) — this is
 * just the toggle, rendered everywhere it must never be more than one click
 * away: Settings › Booking (the fixed home for the switch, on or off),
 * Appointments (there is nothing to show a calendar of while booking is off,
 * but the switch that turns it back on has to stay put), and the top of the
 * Booking section's Services panel (the first thing setting services up
 * needs).
 */
export function BookingToggle({ enabled }: { enabled: boolean }) {
  return (
    <div data-fill="surface" style={panel}>
      <SectionTitle>Booking</SectionTitle>
      <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13, marginBottom: 10 }}>
        Let visitors book a time with you right in the chat. The agent draws a
        step-by-step booking flow that asks your intake questions, one at a
        time, then a date and time. Bookings land in your Inbox under Appointments.
      </p>
      <form action={setBookingEnabledAction} style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* A hidden unchecked value submits "off"; the checkbox overrides it. */}
        {enabled ? null : <input type="hidden" name="enabled" value="on" />}
        <PendingButton pendingLabel="Saving…" style={(enabled ? btnDanger : btn) as React.CSSProperties}>
          {enabled ? "Turn booking off" : "Turn booking on"}
        </PendingButton>
        <span style={{ fontSize: 13, color: "var(--on-surface)" }}>
          Booking is <strong>{enabled ? "on" : "off"}</strong>.
        </span>
      </form>
    </div>
  );
}

/**
 * Settings › Booking: just the toggle, wrapped as its own section. Always
 * present, on or off, because it holds the only switch that turns booking
 * back on.
 */
export function BookingSettings({ config }: { config: { enabled: boolean } }) {
  return (
    <section>
      <BookingToggle enabled={config.enabled} />
    </section>
  );
}
