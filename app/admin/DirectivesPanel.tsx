import { saveDirectiveAction, deleteDirectiveAction } from "./actions";
import { PendingButton } from "./PendingButton";
import { panel, field, btn, btnDanger, SectionTitle, Label } from "./ui";
import type { DirectiveKind, DirectiveRow } from "@/lib/directives";

/**
 * The Goals and Rules sub-tabs of the Agent Behavior section — the same
 * editor twice, differing only in kind and copy. Existing rows each get a
 * form (edit text, toggle Live, Save, Delete); a blank form at the bottom
 * adds one at a time, the ExperienceEditor / AnswersPanel pattern.
 */

const COPY: Record<
  DirectiveKind,
  { title: string; blurb: string; placeholder: string; addLabel: string }
> = {
  goal: {
    title: "Goals",
    blurb:
      "What the chatbot should steer conversations toward — the outcomes you " +
      "want from a visitor chat. Live goals go into the chatbot's prompt as a " +
      "GOALS section it pursues naturally, never pushily.",
    placeholder: "e.g. Get interested visitors to book a call with me.",
    addLabel: "New goal",
  },
  rule: {
    title: "Rules",
    blurb:
      "Hard rules the chatbot must follow — things it should always or never " +
      "do, regardless of what a visitor asks. Live rules are added to the " +
      "RULES list in the chatbot's prompt.",
    placeholder: "e.g. Never share my phone number.",
    addLabel: "New rule",
  },
};

export function DirectivesPanel({ kind, rows }: { kind: DirectiveKind; rows: DirectiveRow[] }) {
  const copy = COPY[kind];
  const live = rows.filter((r) => r.enabled).length;

  return (
    <section>
      <div data-fill="surface" style={panel}>
        <SectionTitle>{copy.title}</SectionTitle>
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13, marginBottom: 10 }}>
          {copy.blurb}
        </p>
        <p style={{ fontSize: 13 }}>
          <strong>{live}</strong> live of <strong>{rows.length}</strong>
        </p>
      </div>

      {rows.map((r) => (
        <DirectiveForm key={r.id} kind={kind} row={r} />
      ))}

      <DirectiveForm kind={kind} />
    </section>
  );
}

/** One goal/rule editor (or the blank add form); also the element the copilot reveals alone. */
export function DirectiveForm({ kind, row }: { kind: DirectiveKind; row?: DirectiveRow }) {
  const copy = COPY[kind];
  const isNew = !row;

  return (
    <form action={saveDirectiveAction} data-fill="surface" data-element={row?.id} style={panel}>
      {row ? <input type="hidden" name="id" value={row.id} /> : null}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="order" value={row?.order ?? 0} />

      <Label>{isNew ? copy.addLabel : copy.title.replace(/s$/, "")}</Label>
      <textarea
        name="text"
        rows={2}
        defaultValue={row?.text ?? ""}
        placeholder={copy.placeholder}
        style={{ ...field, resize: "vertical", fontFamily: "inherit" }}
      />

      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" name="enabled" defaultChecked={row?.enabled ?? true} />
          Live
        </label>
        <PendingButton pendingLabel={isNew ? "Adding…" : "Saving…"} style={btn}>
          {isNew ? "Add" : "Save"}
        </PendingButton>
        {row ? (
          <PendingButton pendingLabel="Deleting…" formAction={deleteDirectiveAction} style={btnDanger}>
            Delete
          </PendingButton>
        ) : null}
      </div>
    </form>
  );
}
