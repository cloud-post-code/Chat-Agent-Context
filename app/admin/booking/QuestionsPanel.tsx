import { deleteAppointmentFieldAction, moveAppointmentFieldAction } from "../actions";
import { BookingFieldForm } from "../BookingFieldForm";
import { PendingButton } from "../PendingButton";
import { panel, btnGhost, btnDanger, SectionTitle } from "../ui";
import type { BookingConfig } from "@/lib/appointmentTypes";

/**
 * The intake question catalog — moved here from the Calendar panel so the
 * questions live with the rest of the booking setup. Same form-per-row idiom
 * as DirectivesPanel; each row is a BookingFieldForm, which now also carries
 * the "Only ask when…" condition and the new field types.
 */
export function QuestionsPanel({ config }: { config: BookingConfig }) {
  return (
    <section>
      <div data-fill="surface" style={panel}>
        <SectionTitle>Questions</SectionTitle>
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13 }}>
          Asked one at a time, after date &amp; time and the visitor&apos;s details. Use
          &ldquo;Only ask when…&rdquo; to show a question only after a certain earlier answer.
        </p>
      </div>

      {config.fields.map((f, i) => (
        <div key={f.key} data-fill="surface" style={panel}>
          <BookingFieldForm field={f} catalog={config.fields} />
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
        <BookingFieldForm key={config.fields.length} catalog={config.fields} />
      </div>
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
