"use client";

import { field, btn, Label } from "../ui";

/**
 * The one editable review card the onboarding chat uses for every stage —
 * contact info and theme are the same component with different field specs.
 * Values are a flat string map; the caller owns state and translates to its
 * API shape on save.
 */

export type FieldSpec =
  | { kind: "text"; key: string; label: string; placeholder?: string }
  | { kind: "select"; key: string; label: string; options: { value: string; label: string }[] };

export function FormCard({
  fields,
  values,
  onChange,
  onDone,
  doneLabel = "Done",
  busy = false,
  children,
}: {
  fields: FieldSpec[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onDone: () => void;
  doneLabel?: string;
  busy?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div>
      {children}
      {fields.map((f) => (
        <div key={f.key}>
          <Label>{f.label}</Label>
          {f.kind === "select" ? (
            <select
              style={field}
              disabled={busy}
              value={values[f.key] ?? ""}
              onChange={(e) => onChange(f.key, e.target.value)}
            >
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          ) : (
            <input
              style={field}
              disabled={busy}
              placeholder={f.placeholder ?? ""}
              value={values[f.key] ?? ""}
              onChange={(e) => onChange(f.key, e.target.value)}
            />
          )}
        </div>
      ))}
      <button style={{ ...btn, marginTop: 6 }} onClick={onDone} disabled={busy}>
        {busy ? "Saving…" : doneLabel}
      </button>
    </div>
  );
}
