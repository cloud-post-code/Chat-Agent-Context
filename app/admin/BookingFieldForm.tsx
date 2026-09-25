"use client";

import { useState } from "react";
import { saveAppointmentFieldAction } from "./actions";
import { PendingButton } from "./PendingButton";
import { field as fieldStyle, btn, Label } from "./ui";
import {
  FIELD_ROLES,
  FIELD_ROLE_LABELS,
  FIELD_TYPES,
  formatOptionLines,
  isChoiceType,
  type AppointmentFieldRow,
} from "@/lib/appointmentTypes";

/**
 * One booking question's editor — also the "new question" form when `field`
 * is left out. A client component for one reason: what a question needs
 * depends on its type, so choosing "Pick one" has to bring up the options box
 * without a save in between. It still posts to the same server action as a
 * plain form.
 *
 * A menu is typed the way a price list reads — one option per line, parts
 * split by "|", a "# Section" line above a group — because the people editing
 * this are salon and shop owners, not form builders.
 *
 * `catalog` is the full question list (this one included), so the "Only ask
 * when…" picker can offer every OTHER question as the condition.
 */

const TYPE_LABELS: Record<string, string> = {
  short_text: "Short text",
  long_text: "Long text",
  email: "Email",
  phone: "Phone",
  select: "Pick one (menu)",
  multi_select: "Pick any (menu)",
  number: "Number",
  yes_no: "Yes / No",
  date: "Date",
  address: "Address",
  file: "File upload",
  photo: "Photo upload",
  signature: "Signature",
  waiver: "Waiver / consent",
};

const OPTIONS_PLACEHOLDER = `# Manicures
Basic Manicure | $25 | 30 min
Gel Manicure | $35 | 45 min | Includes removal
# Add-ons
French tips | $5`;

export function BookingFieldForm({
  field,
  catalog = [],
}: {
  field?: AppointmentFieldRow;
  catalog?: AppointmentFieldRow[];
}) {
  const [type, setType] = useState<string>(field?.type ?? "short_text");
  const config = field?.config ?? {};
  const small: React.CSSProperties = { ...fieldStyle, width: 110 };
  const others = catalog.filter((f) => f.key !== field?.key);

  return (
    <form action={saveAppointmentFieldAction}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
        {field ? <input type="hidden" name="key" value={field.key} /> : null}
        {field ? <input type="hidden" name="screen" value={field.screen} /> : null}
        <div style={{ flex: "1 1 220px" }}>
          <Label>{field ? "Question" : "New question"}</Label>
          <input
            name="label"
            defaultValue={field?.label}
            placeholder={field ? undefined : "e.g. Which services would you like?"}
            style={fieldStyle}
          />
        </div>
        <div>
          <Label>Type</Label>
          <select
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            style={{ ...fieldStyle, width: "auto" }}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>What this answer is</Label>
          <select
            name="role"
            defaultValue={field?.role ?? "none"}
            style={{ ...fieldStyle, width: "auto" }}
          >
            {FIELD_ROLES.map((r) => (
              <option key={r} value={r}>
                {FIELD_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, paddingBottom: 8 }}>
          <input type="checkbox" name="required" defaultChecked={field?.required} /> Required
        </label>
        <PendingButton pendingLabel={field ? "Saving…" : "Adding…"} style={btn as React.CSSProperties}>
          {field ? "Save" : "Add question"}
        </PendingButton>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <div style={{ flex: "1 1 200px" }}>
          <Label>Placeholder</Label>
          <input
            name="placeholder"
            defaultValue={config.placeholder}
            placeholder="Shown greyed out inside the empty answer box"
            style={fieldStyle}
          />
        </div>
        <div style={{ flex: "1 1 200px" }}>
          <Label>Help text</Label>
          <input
            name="help"
            defaultValue={config.help}
            placeholder="One line shown under the question"
            style={fieldStyle}
          />
        </div>
      </div>

      {isChoiceType(type) ? (
        <div>
          <Label>Options — one per line: name | price | duration | description</Label>
          <textarea
            name="options"
            required
            rows={Math.min(14, Math.max(5, (config.options?.length ?? 0) + 2))}
            defaultValue={formatOptionLines(config.options)}
            placeholder={OPTIONS_PLACEHOLDER}
            style={{ ...fieldStyle, fontFamily: "ui-monospace, monospace", fontSize: 13, resize: "vertical" }}
          />
          <p style={{ fontSize: 12, fontStyle: "italic", margin: "-4px 0 8px", color: "var(--on-surface)" }}>
            Only the name is needed. Prices and durations show beside each option
            {type === "multi_select" ? " and add up to a running total as visitors pick" : ""}; a
            line starting with # begins a section.
          </p>
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" name="allowOther" defaultChecked={config.allowOther} /> Let visitors
            type something that isn&apos;t listed
          </label>
        </div>
      ) : null}

      {type === "number" ? (
        <div style={{ display: "flex", gap: 10 }}>
          <div>
            <Label>Smallest</Label>
            <input name="min" type="number" step={1} defaultValue={config.min} placeholder="0" style={small} />
          </div>
          <div>
            <Label>Largest</Label>
            <input name="max" type="number" step={1} defaultValue={config.max} placeholder="No limit" style={small} />
          </div>
        </div>
      ) : null}

      {type === "waiver" ? (
        <div>
          <Label>Waiver text (what the visitor agrees to)</Label>
          <textarea
            name="waiverText"
            defaultValue={config.text}
            rows={5}
            placeholder="I understand and agree to…"
            style={{ ...fieldStyle, resize: "vertical" }}
          />
        </div>
      ) : null}

      {others.length > 0 ? (
        <div style={{ marginTop: 4 }}>
          <Label>Only ask when…</Label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <select
              name="showIfKey"
              defaultValue={config.showIf?.key ?? ""}
              style={{ ...fieldStyle, width: "auto", flex: "0 0 auto" }}
            >
              <option value="">Always ask</option>
              {others.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label || f.key}
                </option>
              ))}
            </select>
            <input
              name="showIfValues"
              defaultValue={(config.showIf?.values ?? []).join(", ")}
              placeholder="comma-separated; leave empty for &quot;when answered at all&quot;"
              style={{ ...fieldStyle, flex: "1 1 240px" }}
            />
          </div>
        </div>
      ) : null}
    </form>
  );
}
