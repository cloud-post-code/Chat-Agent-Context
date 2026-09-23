import React from "react";

/** Shared admin styling primitives so sections look consistent. */

export const panel: React.CSSProperties = {
  background: "var(--surface)",
  color: "var(--on-surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: 20,
  marginBottom: 20,
};

export const field: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "var(--bg-soft)",
  color: "var(--on-bg-soft)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  marginBottom: 10,
  outline: "none",
  fontSize: 14,
};

export const btn: React.CSSProperties = {
  padding: "9px 16px",
  background: "var(--primary)",
  color: "var(--on-primary)",
  border: "none",
  borderRadius: "var(--radius-sm)",
  fontWeight: 600,
  fontSize: 14,
};

export const btnGhost: React.CSSProperties = {
  padding: "7px 12px",
  background: "transparent",
  // Ghost buttons appear both on panels and on the bare page background, so
  // they inherit whichever foreground their container established instead of
  // pinning one fill's text color, and read as secondary through italics.
  color: "inherit",
  fontStyle: "italic",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  fontSize: 13,
};

export const btnDanger: React.CSSProperties = {
  ...btnGhost,
  color: "var(--danger-on-surface)",
  fontStyle: "normal",
  borderColor: "color-mix(in srgb, var(--danger-on-surface) 45%, transparent)",
};

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 18, marginBottom: 14, fontFamily: "var(--font-heading)" }}>
      {children}
    </h2>
  );
}

/** Uniform timestamp text for ingested things: UTC, minute precision. */
export const stamp = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** Small italic date line — the one way ingested rows show when they landed. */
export function Stamp({ date, prefix }: { date: Date; prefix?: string }) {
  return (
    <span style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 11 }}>
      {prefix ? `${prefix} ` : ""}
      {stamp(date)}
    </span>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  // Labels appear on surface panels AND on bg-soft cards (onboarding review
  // forms), so like btnGhost they inherit the container's foreground instead
  // of pinning one fill's text color on every fill.
  return (
    <label style={{ display: "block", fontSize: 12, color: "inherit", fontStyle: "italic", marginBottom: 4 }}>
      {children}
    </label>
  );
}

/** A single metric tile: big number over a small label, optional detail line. */
export function Stat({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div
      data-fill="bg-soft"
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        padding: "12px 14px",
        background: "var(--bg-soft)",
        color: "var(--on-bg-soft)",
        height: "100%",
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--font-heading)", lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: "var(--on-bg-soft)", fontStyle: "italic", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>
        {label}
      </div>
      {detail ? <div style={{ fontSize: 12, marginTop: 6, color: "var(--on-bg-soft)" }}>{detail}</div> : null}
    </div>
  );
}
