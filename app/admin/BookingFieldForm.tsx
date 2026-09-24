"use client";

import { useState } from "react";
import { saveAppointmentFieldAction } from "./actions";
import { PendingButton } from "./PendingButton";
import { field as fieldStyle, btn, Label } from "./ui";
import { FIELD_TYPES, isChoiceType, type AppointmentFieldRow } from "@/lib/appointmentTypes";
import { RowsEditor, SelectField, type RowColumn, type RowValues } from "./booking/RowsEditor";

/**
 * One booking question's editor — also the "new question" form when `field`
 * is left out. A client component for one reason: what a question needs
 * depends on its type, so choosing "Pick one" has to bring up the choices
 * without a save in between. It still posts to the same server action as a
 * plain form.
 *
 * A menu's choices are rows — section, option, price, a length dropdown, a
 * note — written back into the "# Section" / "name | price | duration" lines
 * the server has always parsed (lib/appointmentTypes.ts parseOptionLines).
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

const OPTION_COLUMNS: RowColumn[] = [
  { key: "section", label: "Section", placeholder: "Manicures", width: 130 },
  { key: "label", label: "Option", placeholder: "Gel manicure", required: true },
  { key: "price", label: "Price", placeholder: "$35", width: 90 },
  { key: "duration", label: "Length", kind: "minutes", placeholder: "—" },
  { key: "description", label: "Note", placeholder: "Optional" },
];

/** Rows → the "# Section" / "name | price | duration | note" lines parseOptionLines reads. */
function optionLines(rows: RowValues[]): string {
  const lines: string[] = [];
  let section: string | null = null;
  for (const r of rows) {
    const g = (r.section ?? "").trim();
    if (g !== section) {
      lines.push(`# ${g}`);
      section = g;
    }
    const parts = [r.label.trim(), (r.price ?? "").trim(), r.duration ? `${r.duration} min` : "", (r.description ?? "").trim()];
    while (parts.length > 1 && !parts[parts.length - 1]) parts.pop();
    lines.push(parts.join(" | "));
  }
  return lines.join("\n");
}

/** A stored option's duration text ("45 min", "1 hr 30 min") as the minutes the dropdown holds. */
function minutesOf(duration: string | undefined): string {
  const t = (duration ?? "").toLowerCase();
  if (!t) return "";
  const h = t.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)/);
  const m = t.match(/(\d+)\s*(?:minutes?|mins?)/);
  const total = Math.round((h ? Number.parseFloat(h[1]) * 60 : 0) + (m ? Number.parseInt(m[1], 10) : 0));
  return total > 0 ? String(total) : "";
}

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
        <div style={{ flex: "1 1 220px" }}>
          <Label>{field ? "Question" : "New question"}</Label>
          <input
            name="label"
            defaultValue={field?.label}
            placeholder={field ? undefined : "e.g. Which services would you like?"}
            style={fieldStyle}
          />
        </div>
        <SelectField
          name="type"
          label="Type"
          value={type}
          onChange={setType}
          options={FIELD_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] ?? t }))}
          width="auto"
        />
        <SelectField
          name="required"
          label="Answer"
          defaultValue={field?.required ? "on" : "off"}
          options={[
            { value: "off", label: "Optional" },
            { value: "on", label: "Required" },
          ]}
          width="auto"
        />
        <PendingButton pendingLabel={field ? "Saving…" : "Adding…"} style={btn as React.CSSProperties}>
          {field ? "Save" : "Add question"}
        </PendingButton>
      </div>

      {isChoiceType(type) ? (
        <div>
          <RowsEditor
            name="options"
            label="The choices"
            columns={OPTION_COLUMNS}
            initial={(config.options ?? []).map((o) => ({
              section: o.group ?? "",
              label: o.label,
              price: o.price ?? "",
              duration: minutesOf(o.duration),
              description: o.description ?? "",
            }))}
            addLabel="+ Add a choice"
            serialize={optionLines}
            hint={`Only the option is needed. Prices and lengths show beside each choice${type === "multi_select" ? " and add up to a running total as visitors pick" : ""}; a section groups the choices under a heading.`}
          />
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
