import { setBookingEnabledAction } from "./actions";
import { PendingButton } from "./PendingButton";
import { panel, btn, btnDanger, SectionTitle } from "./ui";

/**
 * The booking on/off switch. It used to carry the question catalog too, but
 * that moved to the Booking section's Questions tab (app/admin/booking/
 * QuestionsPanel.tsx) — this is now just the toggle, rendered in the two
 * places it must never be more than one click away from: the Calendar panel
 * (there is nothing to show a calendar of while booking is off, but the
 * switch that turns it back on has to stay put) and the top of the Booking
 * section's Services panel (the first thing setting services up needs).
 */
export function BookingToggle({ enabled }: { enabled: boolean }) {
  return (
    <div data-fill="surface" style={panel}>
      <SectionTitle>Appointments</SectionTitle>
      <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13, marginBottom: 10 }}>
        Let visitors book a time with you right in the chat. The agent draws a
        step-by-step booking flow; bookings land on your Calendar.
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
