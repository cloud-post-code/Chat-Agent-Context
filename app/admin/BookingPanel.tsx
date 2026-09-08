import {
  setBookingEnabledAction,
  saveAppointmentFieldAction,
  deleteAppointmentFieldAction,
  moveAppointmentFieldAction,
} from "./actions";
import { PendingButton } from "./PendingButton";
import { panel, field, btn, btnGhost, btnDanger, SectionTitle, Label } from "./ui";
import { FIELD_TYPES, type BookingConfig } from "@/lib/appointments";

/**
 * The Appointments settings panel: the booking toggle and the question
 * catalog the wizard asks from. Always present (it is where booking gets
 * turned on); the Calendar panel appears alongside it once enabled. Same
 * form-per-row idiom as DirectivesPanel.
 */

const TYPE_LABELS: Record<string, string> = {
  short_text: "Short text",
  long_text: "Long text",
  email: "Email",
  phone: "Phone",
};

export function BookingPanel({ config }: { config: BookingConfig }) {
  return (
    <section>
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
              <form
                action={saveAppointmentFieldAction}
                style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}
              >
                <input type="hidden" name="key" value={f.key} />
                <div style={{ flex: "1 1 220px" }}>
                  <Label>Question</Label>
                  <input name="label" defaultValue={f.label} style={field} />
                </div>
                <div>
                  <Label>Type</Label>
                  <select name="type" defaultValue={f.type} style={{ ...field, width: "auto" }}>
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABELS[t] ?? t}
                      </option>
                    ))}
                  </select>
                </div>
                <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, paddingBottom: 8 }}>
                  <input type="checkbox" name="required" defaultChecked={f.required} /> Required
                </label>
                <PendingButton pendingLabel="Saving…" style={btn as React.CSSProperties}>
                  Save
                </PendingButton>
              </form>
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

          <form
            action={saveAppointmentFieldAction}
            data-fill="surface"
            style={{ ...panel, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}
          >
            <div style={{ flex: "1 1 220px" }}>
              <Label>New question</Label>
              <input name="label" placeholder="e.g. Your phone number" style={field} />
            </div>
            <div>
              <Label>Type</Label>
              <select name="type" defaultValue="short_text" style={{ ...field, width: "auto" }}>
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t] ?? t}
                  </option>
                ))}
              </select>
            </div>
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, paddingBottom: 8 }}>
              <input type="checkbox" name="required" /> Required
            </label>
            <PendingButton pendingLabel="Adding…" style={btn as React.CSSProperties}>
              Add question
            </PendingButton>
          </form>
        </>
      ) : null}
    </section>
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
