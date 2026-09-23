"use client";

import { useState } from "react";
import type { BookingSelection, CustomerFieldConfig, CustomerFieldKey } from "@/lib/booking/types";
import { CUSTOMER_FIELD_LABELS } from "@/lib/booking/types";
import { Chip, chipRow, inputStyle, linkBtn, liveBtn } from "./ui";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_MIN_DIGITS = 7;
const CORE: readonly CustomerFieldKey[] = ["firstName", "lastName", "email", "phone", "smsConsent"];

export function DetailsStep({
  customerFields,
  selection,
  setSelection,
  onNext,
  onBack,
}: {
  customerFields: CustomerFieldConfig[];
  selection: BookingSelection;
  setSelection: (s: BookingSelection) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const enabled = customerFields.filter((f) => f.enabled);
  const core = enabled.filter((f) => CORE.includes(f.key));
  const rest = enabled.filter((f) => !CORE.includes(f.key));
  const ordered = [...core, ...rest];

  function set(key: CustomerFieldKey, value: string) {
    setSelection({ ...selection, customer: { ...selection.customer, [key]: value } });
  }

  function errorFor(f: CustomerFieldConfig): string | null {
    const v = (selection.customer[f.key] ?? "").trim();
    if (f.required && !v) return "Required.";
    if (f.key === "email" && v && !EMAIL_RE.test(v)) return "Needs a valid email.";
    if (f.key === "phone" && v && v.replace(/\D/g, "").length < PHONE_MIN_DIGITS) return "Needs a valid phone number.";
    return null;
  }

  const errors = ordered.map(errorFor);
  const canNext = errors.every((e) => !e);

  return (
    <div>
      {ordered.map((f, i) => (
        <CustomerField key={f.key} field={f} value={selection.customer[f.key] ?? ""} onChange={(v) => set(f.key, v)} error={touched ? errors[i] : null} />
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="button" onClick={onBack} style={linkBtn}>
          Back
        </button>
        <button
          type="button"
          onClick={() => {
            setTouched(true);
            if (canNext) onNext();
          }}
          style={{ ...linkBtn, ...liveBtn }}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function CustomerField({
  field,
  value,
  onChange,
  error,
}: {
  field: CustomerFieldConfig;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
}) {
  const label = field.label || CUSTOMER_FIELD_LABELS[field.key];

  if (field.key === "smsConsent") {
    return (
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, marginBottom: 10, minHeight: 40 }}>
        <input type="checkbox" checked={value === "yes"} onChange={(e) => onChange(e.target.checked ? "yes" : "no")} />
        {label}
      </label>
    );
  }

  if (field.key === "customerStatus") {
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 13, marginBottom: 4 }}>{label}</div>
        <div role="radiogroup" aria-label={label} style={{ display: "flex", gap: 8 }}>
          {["New customer", "Returning"].map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={value === v}
              onClick={() => onChange(v)}
              style={{
                ...linkBtn,
                flex: 1,
                textAlign: "center",
                ...(value === v ? { background: "var(--on-surface)", color: "var(--surface)", borderColor: "var(--on-surface)" } : {}),
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (field.key === "preferredContact") {
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 13, marginBottom: 4 }}>{label}</div>
        <div style={chipRow}>
          {["Email", "Phone", "Text"].map((v) => (
            <Chip key={v} selected={value === v} onClick={() => onChange(v)}>
              {v}
            </Chip>
          ))}
        </div>
      </div>
    );
  }

  if (field.key === "birthday") {
    return (
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 13, display: "block", marginBottom: 4 }} htmlFor={`cf-${field.key}`}>
          {label}
        </label>
        <input id={`cf-${field.key}`} type="date" value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
      </div>
    );
  }

  if (field.key === "notes") {
    return (
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 13, display: "block", marginBottom: 4 }} htmlFor={`cf-${field.key}`}>
          {label}
        </label>
        <textarea id={`cf-${field.key}`} value={value} onChange={(e) => onChange(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
      </div>
    );
  }

  const type = field.key === "email" ? "email" : field.key === "phone" ? "tel" : "text";
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 13, display: "block", marginBottom: 4 }} htmlFor={`cf-${field.key}`}>
        {label}
        {field.required ? " *" : ""}
      </label>
      <input
        id={`cf-${field.key}`}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, marginBottom: error ? 2 : 10 }}
      />
      {error && <p style={{ color: "var(--danger-on-bg-soft)", fontSize: 12, marginBottom: 8 }}>{error}</p>}
    </div>
  );
}
