"use client";

import { useState } from "react";
import { field as fieldStyle, btnGhost, Label } from "../ui";

/**
 * A small table the admin edits row by row — one input or dropdown per cell,
 * add and remove buttons — in place of the "Name | price | minutes" textareas
 * the booking tab used to ask owners to type by hand. The server actions are
 * unchanged: on every change the rows are written back into ONE hidden field
 * in exactly the line format the existing parsers (app/admin/booking/lines.ts,
 * lib/appointmentTypes.ts parseOptionLines) read, so what the editor shows
 * and what gets saved can never disagree.
 *
 * A "minutes" cell is a dropdown of the usual appointment lengths (a stored
 * value the list doesn't carry is added to it, so nothing is silently lost);
 * "date" is a date picker; "select" takes its own options; "money" and
 * "percent" are number inputs; the rest is text. A "|" typed into a cell is
 * dropped — it is the line format's separator.
 */

export type RowColumn = {
  key: string;
  label: string;
  kind?: "text" | "money" | "percent" | "minutes" | "date" | "select";
  options?: { value: string; label: string }[];
  placeholder?: string;
  /** Flex basis in px; text cells grow to fill the rest. */
  width?: number;
  /** The cell that names the row; a row without it is not written. */
  required?: boolean;
};

export type RowValues = Record<string, string>;

/** The appointment lengths offered wherever a duration is picked. */
export const DURATION_MINUTES = [5, 10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360, 480];

export function minutesLabel(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}

/** Dropdown options for a duration, with `current` kept even when it is not a preset. */
export function minuteOptions(current: string | number | undefined, blankLabel?: string): { value: string; label: string }[] {
  const cur = Number.parseInt(String(current ?? ""), 10);
  const values = [...DURATION_MINUTES];
  if (Number.isFinite(cur) && cur > 0 && !values.includes(cur)) values.push(cur);
  values.sort((a, b) => a - b);
  const out = values.map((m) => ({ value: String(m), label: minutesLabel(m) }));
  return blankLabel !== undefined ? [{ value: "", label: blankLabel }, ...out] : out;
}

const clean = (v: string) => v.replace(/\|/g, "").replace(/\r?\n/g, " ");

/** The default line format: cells joined by " | ", trailing blanks dropped. */
export function joinRow(columns: RowColumn[], row: RowValues): string {
  const cells = columns.map((c) => clean(row[c.key] ?? "").trim());
  while (cells.length > 1 && !cells[cells.length - 1]) cells.pop();
  return cells.join(" | ");
}

export function RowsEditor({
  name,
  label,
  columns,
  initial,
  addLabel = "+ Add a row",
  serialize,
  hint,
}: {
  /** The hidden field the server action reads. */
  name: string;
  label?: string;
  columns: RowColumn[];
  initial: RowValues[];
  addLabel?: string;
  /** Rows → the text the server parses; defaults to one joinRow line per row. */
  serialize?: (rows: RowValues[], columns: RowColumn[]) => string;
  hint?: string;
}) {
  const [rows, setRows] = useState<RowValues[]>(initial);
  const nameKey = columns.find((c) => c.required)?.key ?? columns[0].key;
  const kept = rows.filter((r) => (r[nameKey] ?? "").trim());
  const text = serialize ? serialize(kept, columns) : kept.map((r) => joinRow(columns, r)).join("\n");

  const set = (i: number, key: string, value: string) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [key]: clean(value) } : r)));
  const remove = (i: number) => setRows((prev) => prev.filter((_, j) => j !== i));
  const add = () => setRows((prev) => [...prev, Object.fromEntries(columns.map((c) => [c.key, ""]))]);

  return (
    <div style={{ marginBottom: 12 }}>
      {label ? <Label>{label}</Label> : null}
      <input type="hidden" name={name} value={text} readOnly />
      {rows.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {columns.map((c) => (
              <span key={c.key} style={{ ...cellStyle(c), fontSize: 11, fontStyle: "italic", opacity: 0.8 }}>
                {c.label}
              </span>
            ))}
            <span style={{ width: 34, flex: "0 0 auto" }} />
          </div>
          {rows.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {columns.map((c) => (
                <Cell key={c.key} column={c} value={row[c.key] ?? ""} onChange={(v) => set(i, c.key, v)} />
              ))}
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove row"
                style={{ ...(btnGhost as React.CSSProperties), padding: "6px 9px", fontSize: 12, flex: "0 0 auto" }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <button type="button" onClick={add} style={{ ...(btnGhost as React.CSSProperties), marginTop: rows.length ? 8 : 0 }}>
        {addLabel}
      </button>
      {hint ? (
        <p style={{ fontSize: 12, fontStyle: "italic", margin: "6px 0 0", opacity: 0.8 }}>{hint}</p>
      ) : null}
    </div>
  );
}

function cellStyle(c: RowColumn): React.CSSProperties {
  const fixed = c.width ?? (c.kind === "money" || c.kind === "percent" ? 96 : c.kind === "minutes" ? 120 : c.kind === "date" ? 150 : c.kind === "select" ? 150 : undefined);
  return fixed ? { flex: `0 0 ${fixed}px`, width: fixed } : { flex: "1 1 120px", minWidth: 100 };
}

function Cell({ column: c, value, onChange }: { column: RowColumn; value: string; onChange: (v: string) => void }) {
  const style: React.CSSProperties = { ...fieldStyle, marginBottom: 0, ...cellStyle(c) };
  if (c.kind === "minutes" || c.kind === "select") {
    const options = c.kind === "minutes" ? minuteOptions(value, c.placeholder ?? "—") : (c.options ?? []);
    const known = options.some((o) => o.value === value);
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={c.label} style={style}>
        {!known && value ? <option value={value}>{value}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  const type = c.kind === "money" || c.kind === "percent" ? "number" : c.kind === "date" ? "date" : "text";
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={c.placeholder}
      aria-label={c.label}
      min={type === "number" ? 0 : undefined}
      step={c.kind === "money" ? "0.01" : c.kind === "percent" ? "0.5" : undefined}
      style={style}
    />
  );
}

/** A `<Label>` + `<select>` pair for a single dropdown field. */
export function SelectField({
  name,
  label,
  value,
  defaultValue,
  options,
  onChange,
  width,
  style,
}: {
  name?: string;
  label?: string;
  value?: string;
  defaultValue?: string;
  options: { value: string; label: string }[];
  onChange?: (v: string) => void;
  width?: number | string;
  style?: React.CSSProperties;
}) {
  const current = value ?? defaultValue ?? "";
  const known = options.some((o) => o.value === current);
  return (
    <div>
      {label ? <Label>{label}</Label> : null}
      <select
        name={name}
        value={value}
        defaultValue={value === undefined ? defaultValue : undefined}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        aria-label={label}
        style={{ ...fieldStyle, width: width ?? "100%", ...style }}
      >
        {!known && current ? <option value={current}>{current}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
