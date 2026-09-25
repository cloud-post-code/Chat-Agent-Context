"use client";

import { useRef, useState } from "react";
import { deleteAppointmentFieldAction, moveAppointmentFieldAction, saveBookingFlowAction, setFieldScreenAction } from "@/app/admin/actions/booking";
import { BookingFieldForm } from "../BookingFieldForm";
import { PendingButton } from "../PendingButton";
import { panel, btnGhost, btnDanger, field as fieldStyle, SectionTitle } from "../ui";
import { FIELD_ROLE_LABELS, type AppointmentFieldRow, type BookingConfig } from "@/lib/appointmentTypes";
import {
  sanitizeFlow,
  type BookingSettings,
  type FlowStep,
  type LocationRow,
  type ServiceRow,
  type StaffRow,
} from "@/lib/booking/types";
import { contactFields, screenFields } from "@/lib/booking/flowSteps";
import { flowIds, moveFlowStep, stepId } from "@/lib/booking/flowEdit";

/**
 * The booking form as the visitor meets it: every step of the business's own
 * flow (BookingSettings.flow, resolved by `sanitizeFlow` exactly as the card
 * resolves it), top to bottom, with the order editable in place. Engine
 * steps (service, provider, location, time) are one row each with ↑/↓; a
 * screen of questions is one group — its heading, each question's editor
 * (BookingFieldForm, as before), the question's own ↑/↓ through the whole
 * order, the screen split/join buttons, Remove — with ↑/↓ that move the whole
 * screen among the steps; review is always last and never moves.
 *
 * A client component for one reason: the screen heading saves on blur/Enter
 * without a Save button, which needs a ref to the form. Every ↑/↓ posts the
 * full reordered id list (computed here from the current flow by
 * `moveFlowStep`) to `saveBookingFlowAction`, so the server never guesses
 * what the owner saw.
 *
 * A step the card would skip (no services, no providers, one location) still
 * shows, dimmed, with a note — the order is the owner's to set before the
 * data is on file.
 */
export function FormPanel({
  config,
  settings,
  services = [],
  staff = [],
  locations = [],
}: {
  config: BookingConfig;
  settings: BookingSettings;
  services?: ServiceRow[];
  staff?: StaffRow[];
  locations?: LocationRow[];
}) {
  const fields = config.fields;
  const flow = sanitizeFlow(settings.flow, fields);
  const ids = flowIds(flow);
  const noContact = contactFields(fields).length === 0;
  let screenOrdinal = 0;

  return (
    <section>
      <div data-fill="surface" style={panel}>
        <SectionTitle>Form</SectionTitle>
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13, margin: 0 }}>
          Asked in this order, exactly as shown. Questions on the same screen are asked together; use
          &ldquo;Start a new screen here&rdquo; to split a screen and &ldquo;Join previous screen&rdquo; to
          merge one. Use &ldquo;Only ask when…&rdquo; to show a question only after a certain earlier answer.
        </p>
        {noContact ? (
          <p style={banner}>
            No customer details are asked yet — add a question with a role (name, email or phone).
          </p>
        ) : null}
      </div>

      {flow.map((step, i) => {
        const id = stepId(step);
        const canUp = i > 0 && step.kind !== "review";
        const canDown = i < flow.length - 1 && step.kind !== "review" && flow[i + 1].kind !== "review";
        const controls =
          step.kind === "review" ? null : (
            <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
              <FlowMoveButton flow={flow} id={id} dir="up" disabled={!canUp} />
              <FlowMoveButton flow={flow} id={id} dir="down" disabled={!canDown} />
            </div>
          );

        if (step.kind === "questions") {
          screenOrdinal += 1;
          const screen = step.screen ?? -1;
          const onScreen = screenFields(fields, screen);
          return (
            <div key={id} data-fill="surface" style={{ ...panel, padding: 16 }}>
              <div style={header}>
                <span style={numeral}>{i + 1}</span>
                <span style={screenLabel}>Screen {screenOrdinal}</span>
                <ScreenTitle id={id} ids={ids} title={step.title ?? ""} />
                {controls}
              </div>
              {onScreen.map((f) => {
                const index = fields.findIndex((x) => x.key === f.key);
                const before = index > 0 ? fields[index - 1] : null;
                return (
                  <div key={f.key} style={questionBox}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      {f.role !== "none" ? <span style={roleBadge}>{FIELD_ROLE_LABELS[f.role]}</span> : null}
                      {f.required ? (
                        <span style={{ fontSize: 11, color: "var(--on-surface)", opacity: 0.7 }}>required</span>
                      ) : null}
                    </div>
                    <BookingFieldForm field={f} catalog={fields} />
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                      {index > 0 ? <FieldMoveButton fieldKey={f.key} dir="up" /> : null}
                      {index < fields.length - 1 ? <FieldMoveButton fieldKey={f.key} dir="down" /> : null}
                      {before && before.screen === f.screen ? (
                        <ScreenButton fieldKey={f.key} mode="new" label="Start a new screen here" />
                      ) : null}
                      {before && before.screen !== f.screen ? (
                        <ScreenButton fieldKey={f.key} mode="previous" label="Join previous screen" />
                      ) : null}
                      <form action={deleteAppointmentFieldAction} style={{ marginLeft: "auto" }}>
                        <input type="hidden" name="key" value={f.key} />
                        <PendingButton pendingLabel="Removing…" style={btnDanger as React.CSSProperties}>
                          Remove
                        </PendingButton>
                      </form>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        }

        const row = engineRow(step, { settings, services, staff, locations, fields });
        return (
          <div key={id} data-fill="surface" style={{ ...panel, padding: 16, opacity: row.note ? 0.6 : 1 }}>
            <div style={header}>
              <span style={numeral}>{i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{row.title}</div>
                <div style={{ fontSize: 12, color: "var(--on-surface)", opacity: 0.8 }}>
                  {row.note ? <em>{row.note}</em> : row.detail}
                </div>
              </div>
              {controls}
            </div>
          </div>
        );
      })}

      {/* Keyed by the catalog's size so a successful Add remounts the form
          and its type picker falls back to the default. A new question gets
          a screen of its own (saveAppointmentField), asked before review. */}
      <div data-fill="surface" style={panel}>
        <BookingFieldForm key={fields.length} catalog={fields} />
      </div>
    </section>
  );
}

// ── Engine rows ────────────────────────────────────────────────────────────

const ENGINE_TITLES: Record<Exclude<FlowStep["kind"], "questions">, string> = {
  service: "Pick a service",
  provider: "Choose who you'd like to see",
  location: "Where",
  time: "Date and time",
  review: "Review and confirm",
};

const NOTHING = "(not asked — nothing on file)";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The title, the one-line detail and — when the card would skip the step — the note saying why. */
function engineRow(
  step: FlowStep,
  ctx: {
    settings: BookingSettings;
    services: ServiceRow[];
    staff: StaffRow[];
    locations: LocationRow[];
    fields: AppointmentFieldRow[];
  },
): { title: string; detail: string; note?: string } {
  const title = step.kind === "questions" ? "" : ENGINE_TITLES[step.kind];
  switch (step.kind) {
    case "service": {
      if (!ctx.services.length) return { title, detail: "", note: NOTHING };
      const withOptions = ctx.services.filter(
        (s) => s.variants.length || s.addons.length || ["per_person", "per_unit", "hourly"].includes(s.pricing.kind),
      );
      return {
        title,
        detail:
          `${plural(ctx.services.length, "service")}, with prices and durations` +
          (withOptions.length ? ` — options and add-ons follow for ${plural(withOptions.length, "service")}` : ""),
      };
    }
    case "provider": {
      if (ctx.settings.staffSelection === "hidden") {
        return { title, detail: "", note: "(not asked — provider choice is hidden under Hours)" };
      }
      const enabled = ctx.staff.filter((s) => s.enabled);
      if (!enabled.length) return { title, detail: "", note: NOTHING };
      return {
        title,
        detail: `${plural(enabled.length, "provider")}${ctx.settings.staffSelection === "optional" ? ", or anyone available" : " — one must be chosen"}`,
      };
    }
    case "location": {
      const enabled = ctx.locations.filter((l) => l.enabled);
      const remote = ctx.services.some((s) => s.modes.includes("online") || s.modes.includes("mobile"));
      if (enabled.length < 2 && !remote) {
        return { title, detail: "", note: enabled.length === 1 ? "(not asked — only one place on file)" : NOTHING };
      }
      return { title, detail: enabled.map((l) => l.name).filter(Boolean).join(", ") || plural(enabled.length, "location") };
    }
    case "time":
      return { title, detail: "live availability from your hours" };
    case "review":
      return {
        title,
        detail: `always last — ${ctx.settings.confirmation === "request" ? "sent as a request you confirm" : "booked on the spot"}`,
      };
    default:
      return { title, detail: "" };
  }
}

// ── Controls ───────────────────────────────────────────────────────────────

/** ↑/↓ for a flow step: posts the whole reordered id list. */
function FlowMoveButton({
  flow,
  id,
  dir,
  disabled,
}: {
  flow: FlowStep[];
  id: string;
  dir: "up" | "down";
  disabled: boolean;
}) {
  const next = flowIds(moveFlowStep(flow, id, dir));
  const style: React.CSSProperties = { ...btnGhost, padding: "5px 10px", opacity: disabled ? 0.4 : 1 };
  if (disabled) {
    return (
      <button type="button" disabled style={style} aria-label={dir === "up" ? "Earlier" : "Later"}>
        {dir === "up" ? "↑" : "↓"}
      </button>
    );
  }
  return (
    <form action={saveBookingFlowAction}>
      <input type="hidden" name="steps" value={JSON.stringify(next)} />
      <PendingButton pendingLabel="…" style={style} title={dir === "up" ? "Ask earlier" : "Ask later"}>
        {dir === "up" ? "↑" : "↓"}
      </PendingButton>
    </form>
  );
}

/**
 * The screen's heading, saved on blur or Enter — no Save button, because a
 * heading is one field and the owner expects it to just stick. The current
 * order rides along so the save never reorders anything.
 */
function ScreenTitle({ id, ids, title }: { id: string; ids: string[]; title: string }) {
  const form = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState(title);
  const saved = useRef(title);
  const submit = () => {
    if (value.trim() === saved.current.trim()) return;
    saved.current = value;
    form.current?.requestSubmit();
  };
  return (
    <form ref={form} action={saveBookingFlowAction} style={{ flex: "1 1 200px", minWidth: 0 }}>
      <input type="hidden" name="steps" value={JSON.stringify(ids)} />
      <input
        name={`title:${id}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Heading shown above these questions (optional)"
        aria-label="Screen heading"
        style={{ ...fieldStyle, marginBottom: 0, padding: "7px 10px", fontSize: 13 }}
      />
    </form>
  );
}

/** ↑/↓ for one question through the whole order. */
function FieldMoveButton({ fieldKey, dir }: { fieldKey: string; dir: "up" | "down" }) {
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

/** Split the screen at this question, or join it to the screen before. */
function ScreenButton({ fieldKey, mode, label }: { fieldKey: string; mode: "new" | "previous"; label: string }) {
  return (
    <form action={setFieldScreenAction}>
      <input type="hidden" name="key" value={fieldKey} />
      <input type="hidden" name="mode" value={mode} />
      <PendingButton pendingLabel="…" style={btnGhost as React.CSSProperties}>
        {label}
      </PendingButton>
    </form>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const numeral: React.CSSProperties = {
  flex: "0 0 auto",
  width: 26,
  height: 26,
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  fontWeight: 700,
  background: "var(--bg-soft)",
  color: "var(--on-bg-soft)",
};

const screenLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--on-surface)",
  opacity: 0.7,
  whiteSpace: "nowrap",
};

const questionBox: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: 14,
  marginTop: 12,
};

const roleBadge: React.CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  fontWeight: 600,
  padding: "2px 8px",
  borderRadius: 999,
  background: "var(--bg-soft)",
  color: "var(--on-bg-soft)",
};

const banner: React.CSSProperties = {
  marginTop: 12,
  marginBottom: 0,
  padding: "10px 12px",
  borderRadius: "var(--radius-sm)",
  background: "var(--bg-soft)",
  color: "var(--on-bg-soft)",
  fontSize: 13,
  fontWeight: 600,
};
