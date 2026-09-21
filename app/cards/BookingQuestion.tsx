"use client";

import { useState } from "react";
import {
  isChoiceType,
  optionFacts,
  pickedOptions,
  selectionTotal,
  type FieldConfig,
  type FieldOption,
  type FieldType,
} from "@/lib/appointmentTypes";

/**
 * The booking wizard's question controls: one A2UI element per question type,
 * chosen by the field's `type` and shaped by its `config` — the card is handed
 * data, never markup. Text questions get an input; a choice question gets its
 * options as tappable rows (a menu, when they carry prices: name, price,
 * duration, a line of description, grouped by section, with a running total),
 * or a dropdown once a plain list grows too long to scan; a count gets a
 * stepper; yes/no gets two buttons.
 *
 * Everything here is convenience. What an answer may be is decided by
 * resolveAnswer on the server; these controls just make the allowed answers
 * the easy ones to give.
 */

export type BookingField = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  /** Absent on a block drawn from an old stored sample; read as empty. */
  config?: FieldConfig;
};

/** A choice question answers with its picks; every other type with text. */
export type Answer = string | string[];
export type Answers = Record<string, Answer>;

/** A plain list longer than this is a dropdown; rows that long stop being scannable. */
const DROPDOWN_OVER = 8;
/** Rows past this many scroll inside the card instead of stretching the chat. */
const SCROLL_OVER = 6;

/** Picks from either answer shape — a prefilled service arrives as bare text. */
export function picksOf(a: Answer | undefined): string[] {
  if (Array.isArray(a)) return a;
  return a && a.trim() ? [a.trim()] : [];
}

export function hasAnswer(f: BookingField, a: Answer | undefined): boolean {
  return isChoiceType(f.type) ? picksOf(a).length > 0 : String(a ?? "").trim().length > 0;
}

/** An answer as the review step lists it: one line per pick, facts beside each. */
export function answerLines(f: BookingField, a: Answer | undefined): string[] {
  if (!isChoiceType(f.type)) return hasAnswer(f, a) ? [String(a)] : [];
  return pickedOptions(f.config ?? {}, picksOf(a)).map((o) =>
    optionFacts(o) ? `${o.label} — ${optionFacts(o)}` : o.label,
  );
}

/** "$40 · 1 hr 15 min" for a choice answer with anything to add up; else "". */
export function answerTotal(f: BookingField, a: Answer | undefined): string {
  if (!isChoiceType(f.type)) return "";
  const total = selectionTotal(pickedOptions(f.config ?? {}, picksOf(a)));
  return [total.price, total.duration].filter(Boolean).join(" · ");
}

type InputProps = {
  field: BookingField;
  value: Answer | undefined;
  onChange: (next: Answer) => void;
  /** Enter in a single-line input advances, as it always has. */
  onEnter: () => void;
  /** The card's text-input style, passed in so this file copies none of it. */
  inputStyle: React.CSSProperties;
};

export function QuestionInput(props: InputProps) {
  const { field } = props;
  if (isChoiceType(field.type)) return <ChoiceInput {...props} />;
  if (field.type === "number") return <NumberInput {...props} />;
  if (field.type === "yes_no") return <YesNoInput {...props} />;
  return <TextInput {...props} />;
}

function TextInput({ field, value, onChange, onEnter, inputStyle }: InputProps) {
  const shared = {
    value: String(value ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    placeholder: field.required ? "Required" : "Optional",
    "aria-label": field.label,
    autoFocus: true,
  };
  return field.type === "long_text" ? (
    <textarea {...shared} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
  ) : (
    <input
      {...shared}
      style={inputStyle}
      type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
      onKeyDown={(e) => e.key === "Enter" && onEnter()}
    />
  );
}

function ChoiceInput({ field, value, onChange, onEnter, inputStyle }: InputProps) {
  const config = field.config ?? {};
  const options = config.options ?? [];
  const multi = field.type === "multi_select";
  const picks = picksOf(value);
  const isListed = (p: string) => options.some((o) => o.label.toLowerCase() === p.toLowerCase());
  const other = picks.find((p) => !isListed(p)) ?? "";
  // Open when the visitor asks for it — or already typed something, e.g. on Back.
  const [otherOpen, setOtherOpen] = useState(other !== "");

  const emit = (next: string[]) => onChange(next);
  const toggle = (label: string) => {
    if (!multi) return emit([label]);
    const on = picks.some((p) => p.toLowerCase() === label.toLowerCase());
    emit(on ? picks.filter((p) => p.toLowerCase() !== label.toLowerCase()) : [...picks, label]);
  };
  const setOther = (text: string) => {
    const listed = multi ? picks.filter(isListed) : [];
    emit(text.trim() ? [...listed, text] : listed);
  };
  const toggleOther = () => {
    const open = !otherOpen;
    setOtherOpen(open);
    // Single choice: "something else" replaces the pick. Closing it drops the text.
    if (!multi && open) emit([]);
    if (!open) emit(picks.filter(isListed));
  };

  const plain = options.every((o) => !o.price && !o.duration && !o.description);
  if (!multi && plain && options.length > DROPDOWN_OVER) {
    const OTHER = "__other__";
    return (
      <div>
        <select
          aria-label={field.label}
          value={otherOpen ? OTHER : (picks.find(isListed) ?? "")}
          onChange={(e) => {
            const v = e.target.value;
            setOtherOpen(v === OTHER);
            emit(v && v !== OTHER ? [v] : []);
          }}
          style={inputStyle}
        >
          <option value="">Choose…</option>
          <GroupedOptions options={options} />
          {config.allowOther ? <option value={OTHER}>Something else…</option> : null}
        </select>
        {otherOpen ? (
          <OtherText value={other} onChange={setOther} onEnter={onEnter} inputStyle={inputStyle} />
        ) : null}
      </div>
    );
  }

  const total = multi ? answerTotal(field, picks) : "";
  const count = picks.filter(isListed).length + (other ? 1 : 0);
  return (
    <div>
      <div
        role={multi ? "group" : "radiogroup"}
        aria-label={field.label}
        style={options.length > SCROLL_OVER ? { maxHeight: 300, overflowY: "auto", paddingRight: 4 } : undefined}
      >
        {options.map((o, i) => (
          <div key={o.label}>
            {o.group && o.group !== options[i - 1]?.group ? <div style={groupHead}>{o.group}</div> : null}
            <OptionRow
              option={o}
              name={field.key}
              multi={multi}
              checked={picks.some((p) => p.toLowerCase() === o.label.toLowerCase())}
              onToggle={() => {
                if (!multi) setOtherOpen(false);
                toggle(o.label);
              }}
            />
          </div>
        ))}
        {config.allowOther ? (
          <OptionRow
            option={{ label: "Something else" }}
            name={field.key}
            multi={multi}
            checked={otherOpen}
            onToggle={toggleOther}
          />
        ) : null}
      </div>
      {otherOpen ? (
        <OtherText value={other} onChange={setOther} onEnter={onEnter} inputStyle={inputStyle} />
      ) : null}
      {multi ? (
        <p aria-live="polite" style={{ fontSize: 13, color: "var(--on-bg-soft)", margin: "8px 0 10px" }}>
          {count === 0 ? "Pick as many as you like." : `${count} selected${total ? ` · ${total}` : ""}`}
        </p>
      ) : (
        <div style={{ height: 4 }} />
      )}
    </div>
  );
}

/** <option>s, under <optgroup>s when the menu has sections. */
function GroupedOptions({ options }: { options: FieldOption[] }) {
  const groups: { name: string; items: FieldOption[] }[] = [];
  for (const o of options) {
    const name = o.group ?? "";
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.items.push(o);
    else groups.push({ name, items: [o] });
  }
  const item = (o: FieldOption) => (
    <option key={o.label} value={o.label}>
      {o.label}
    </option>
  );
  return (
    <>
      {groups.map((g, i) =>
        g.name ? (
          <optgroup key={`${g.name}:${i}`} label={g.name}>
            {g.items.map(item)}
          </optgroup>
        ) : (
          g.items.map(item)
        ),
      )}
    </>
  );
}

/**
 * One pickable row. A real checkbox/radio inside a <label>, so the whole row
 * is the tap target and keyboard and screen readers get native semantics.
 */
function OptionRow({
  option,
  name,
  multi,
  checked,
  onToggle,
}: {
  option: FieldOption;
  name: string;
  multi: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  const detail = [option.duration, option.description].filter(Boolean).join(" · ");
  return (
    <label style={{ ...row, ...(checked ? picked : {}) }}>
      <input
        type={multi ? "checkbox" : "radio"}
        name={name}
        checked={checked}
        onChange={onToggle}
        // A radio can't be un-picked by onChange; "Something else" needs to close.
        onClick={() => !multi && checked && onToggle()}
        style={{ accentColor: "var(--on-surface)", marginTop: 3, flex: "0 0 auto" }}
      />
      <span style={{ flex: "1 1 auto", minWidth: 0 }}>
        <span style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{option.label}</span>
          {option.price ? <span style={{ fontSize: 14, whiteSpace: "nowrap" }}>{option.price}</span> : null}
        </span>
        {detail ? (
          <span style={{ display: "block", fontSize: 12, opacity: 0.8, lineHeight: 1.45, marginTop: 2 }}>
            {detail}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function OtherText({
  value,
  onChange,
  onEnter,
  inputStyle,
}: {
  value: string;
  onChange: (text: string) => void;
  onEnter: () => void;
  inputStyle: React.CSSProperties;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && onEnter()}
      placeholder="Tell us what you're after"
      aria-label="Something else"
      maxLength={200}
      autoFocus
      style={{ ...inputStyle, marginTop: 2 }}
    />
  );
}

function NumberInput({ field, value, onChange, onEnter, inputStyle }: InputProps) {
  const { min = 0, max } = field.config ?? {};
  const text = String(value ?? "");
  const n = Number.parseInt(text, 10);
  const clamp = (v: number) => Math.max(min, max === undefined ? v : Math.min(max, v));
  // The first tap lands on the smallest sensible answer, not on zero guests.
  const step = (d: number) => onChange(String(Number.isNaN(n) ? Math.max(min, 1) : clamp(n + d)));
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <button type="button" onClick={() => step(-1)} aria-label="One fewer" style={stepBtn}>
        −
      </button>
      <input
        value={text}
        onChange={(e) => onChange(e.target.value.replace(/[^\d-]/g, ""))}
        onKeyDown={(e) => e.key === "Enter" && onEnter()}
        inputMode="numeric"
        aria-label={field.label}
        placeholder={field.required ? "Required" : "Optional"}
        autoFocus
        style={{ ...inputStyle, width: 96, textAlign: "center" }}
      />
      <button type="button" onClick={() => step(1)} aria-label="One more" style={stepBtn}>
        +
      </button>
    </div>
  );
}

function YesNoInput({ field, value, onChange }: InputProps) {
  return (
    <div role="radiogroup" aria-label={field.label} style={{ display: "flex", gap: 8, marginBottom: 10 }}>
      {["Yes", "No"].map((v) => {
        const on = value === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            // Tapping the chosen one again clears it, so an optional question can be un-answered.
            onClick={() => onChange(on ? "" : v)}
            style={{
              ...row,
              flex: "1 1 0",
              justifyContent: "center",
              marginBottom: 0,
              fontWeight: 600,
              // Inverted, for the same reason as `picked` below.
              ...(on ? { background: "var(--on-surface)", color: "var(--surface)", borderColor: "var(--on-surface)" } : {}),
            }}
          >
            {v}
          </button>
        );
      })}
    </div>
  );
}

const row: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  padding: "10px 12px",
  marginBottom: 6,
  background: "var(--surface)",
  color: "var(--on-surface)",
  // Longhand on purpose: `picked` toggles borderColor, and React can't cleanly
  // remove a longhand that a `border` shorthand also sets.
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontSize: 14,
};
// A picked row is marked in the row's own text color, not --primary: a tenant's
// primary can be the very color of the surface (it is, on a tan-on-tan theme),
// while --on-surface is by construction the color that reads against it.
const picked: React.CSSProperties = {
  borderColor: "var(--on-surface)",
  boxShadow: "inset 0 0 0 1px var(--on-surface)",
};
const groupHead: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--on-bg-soft)",
  opacity: 0.75,
  margin: "10px 0 6px",
};
const stepBtn: React.CSSProperties = {
  width: 40,
  height: 40,
  flex: "0 0 auto",
  fontSize: 18,
  lineHeight: 1,
  background: "var(--surface)",
  color: "var(--on-surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};
