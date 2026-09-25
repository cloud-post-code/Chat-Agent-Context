import { deleteAppointmentFieldAction, moveAppointmentFieldAction } from "../actions";
import { BookingFieldForm } from "../BookingFieldForm";
import { PendingButton } from "../PendingButton";
import { panel, btnGhost, btnDanger, SectionTitle } from "../ui";
import { FIELD_ROLE_LABELS, type AppointmentFieldRow, type BookingConfig } from "@/lib/appointmentTypes";

/**
 * The intake question catalog — moved here from the Calendar panel so the
 * questions live with the rest of the booking setup. Same form-per-row idiom
 * as DirectivesPanel; each row is a BookingFieldForm, which now also carries
 * the "Only ask when…" condition and the new field types.
 *
 * Questions are grouped by their `screen` number — fields sharing one are
 * asked together on one screen — with a "Screen N" divider counting groups in
 * the order they first appear, not the raw stored screen number (which can
 * skip around as questions are added and removed).
 */
export function QuestionsPanel({ config }: { config: BookingConfig }) {
  const groups = groupByScreen(config.fields);

  return (
    <section>
      <div data-fill="surface" style={panel}>
        <SectionTitle>Questions</SectionTitle>
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13 }}>
          Asked in this order, exactly as shown. Questions on the same screen are asked together. Use
          &ldquo;Only ask when…&rdquo; to show a question only after a certain earlier answer.
        </p>
      </div>

      {groups.map((group, gi) => (
        <div key={group.screen}>
          <div style={screenDivider}>Screen {gi + 1}</div>
          {group.rows.map(({ field: f, index: i }) => (
            <div key={f.key} data-fill="surface" style={panel}>
              {f.role !== "none" ? <span style={roleBadge}>{FIELD_ROLE_LABELS[f.role]}</span> : null}
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

/** Fields in catalog order, bucketed by `screen`; a screen's bucket starts
 *  wherever that screen number is first seen, so a non-contiguous form (two
 *  questions on screen 3 with something else in between) still reads as one
 *  group instead of two. */
function groupByScreen(
  fields: AppointmentFieldRow[],
): { screen: number; rows: { field: AppointmentFieldRow; index: number }[] }[] {
  const groups: { screen: number; rows: { field: AppointmentFieldRow; index: number }[] }[] = [];
  const byScreen = new Map<number, { field: AppointmentFieldRow; index: number }[]>();
  fields.forEach((field, index) => {
    let rows = byScreen.get(field.screen);
    if (!rows) {
      rows = [];
      byScreen.set(field.screen, rows);
      groups.push({ screen: field.screen, rows });
    }
    rows.push({ field, index });
  });
  return groups;
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

const screenDivider: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--on-surface)",
  opacity: 0.7,
  margin: "18px 2px 8px",
};

const roleBadge: React.CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  fontWeight: 600,
  padding: "2px 8px",
  borderRadius: 999,
  background: "var(--bg-soft)",
  color: "var(--on-bg-soft)",
  marginBottom: 10,
};
