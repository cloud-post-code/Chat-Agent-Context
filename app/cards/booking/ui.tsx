"use client";

/**
 * Shared A2UI bits for the booking flow card: the same idiom as
 * app/cards/Cards.tsx (inline styles, CSS variables, the `card`/`picked`
 * conventions) duplicated here rather than imported, so this directory never
 * has to import from Cards.tsx (which imports BookingFlowCard — importing
 * back would be a cycle).
 */

import type React from "react";

export const card: React.CSSProperties = {
  background: "var(--bg-soft)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border)",
  borderRadius: "var(--radius-md)",
  color: "var(--on-bg-soft)",
  padding: 16,
};

export const headingStyle: React.CSSProperties = {
  fontSize: 16,
  fontFamily: "var(--font-heading)",
  display: "block",
};

export const progressStyle: React.CSSProperties = {
  color: "var(--on-bg-soft)",
  fontStyle: "italic",
  fontSize: 12,
  margin: "0 0 10px",
};

export const sectionLabel: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--on-bg-soft)",
  opacity: 0.75,
  margin: "14px 0 6px",
};

export const linkBtn: React.CSSProperties = {
  fontSize: 13,
  padding: "7px 12px",
  borderRadius: "var(--radius-sm)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border)",
  color: "var(--on-surface)",
  background: "var(--surface)",
  textDecoration: "none",
  cursor: "pointer",
  minHeight: 40,
};

export const liveBtn: React.CSSProperties = {
  background: "var(--primary)",
  color: "var(--on-primary)",
  border: "none",
};

export const textBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  fontSize: 13,
  color: "var(--accent-on-bg-soft)",
  textDecoration: "underline",
  cursor: "pointer",
};

export const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "var(--surface)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border)",
  borderRadius: "var(--radius-sm)",
  marginBottom: 10,
  outline: "none",
  fontSize: 14,
  color: "var(--on-surface)",
};

/**
 * A selected row or tile is marked in the row's own text color, not
 * --primary: a tenant's primary can be the very color of the surface, while
 * --on-surface is by construction the color that reads against it (the
 * `picked` idiom from BookingQuestion.tsx).
 */
export const picked: React.CSSProperties = {
  borderColor: "var(--on-surface)",
  boxShadow: "inset 0 0 0 1px var(--on-surface)",
};

export const optionRow: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  padding: "10px 12px",
  marginBottom: 6,
  background: "var(--surface)",
  color: "var(--on-surface)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontSize: 14,
  minHeight: 40,
};

export const stepBtn: React.CSSProperties = {
  width: 40,
  height: 40,
  flex: "0 0 auto",
  fontSize: 18,
  lineHeight: 1,
  background: "var(--surface)",
  color: "var(--on-surface)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};

export const tileGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
  gap: 10,
};

export const chipRow: React.CSSProperties = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
  marginBottom: 10,
};

export function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      style={{
        fontSize: 12,
        padding: "6px 10px",
        borderRadius: "var(--radius-pill)",
        borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border)",
        background: selected ? "var(--on-surface)" : "var(--surface)",
        color: selected ? "var(--surface)" : "var(--on-surface)",
        cursor: "pointer",
        minHeight: 32,
      }}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "accent" }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 11,
        padding: "3px 8px",
        borderRadius: "var(--radius-pill)",
        borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border)",
        color: tone === "accent" ? "var(--accent-on-bg-soft)" : "var(--on-bg-soft)",
        marginRight: 6,
        marginBottom: 4,
      }}
    >
      {children}
    </span>
  );
}

/** A themed placeholder for a missing image: the item's first letter over a primary-tinted gradient. */
export function PlaceholderImage({ letter, radius = "var(--radius-sm)" }: { letter: string; radius?: string }) {
  return (
    <div
      data-testid="placeholder-image"
      aria-hidden
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, var(--primary), var(--bg-soft))",
        color: "var(--on-primary)",
        fontSize: 24,
        fontWeight: 700,
        fontFamily: "var(--font-heading)",
        borderRadius: radius,
      }}
    >
      {letter}
    </div>
  );
}

/**
 * A tappable card used for services / providers / locations. `role="radio"`
 * inside a `role="radiogroup"` wrapper for a single-choice list;
 * `role="button"` for the services grid, where a tap opens a detail view
 * rather than directly selecting.
 */
export function Tile({
  selected,
  onClick,
  children,
  ariaLabel,
  role = "radio",
  disabled,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  ariaLabel: string;
  role?: "radio" | "button";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === "radio" ? selected : undefined}
      aria-pressed={role === "button" ? selected : undefined}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled ? "true" : undefined}
      style={{
        textAlign: "left",
        display: "block",
        width: "100%",
        padding: 0,
        background: "var(--surface)",
        color: "var(--on-surface)",
        borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border)",
        borderRadius: "var(--radius-sm)",
        cursor: disabled ? "default" : "pointer",
        minHeight: 40,
        opacity: disabled ? 0.5 : 1,
        ...(selected ? picked : {}),
      }}
    >
      {children}
    </button>
  );
}
