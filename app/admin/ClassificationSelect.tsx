import React from "react";
import {
  CLASSIFICATIONS,
  CLASSIFICATION_LABELS,
  ENABLED_CLASSIFICATIONS,
} from "@/lib/ingestionSources.shared";
import { field, Label } from "./ui";

/**
 * The classification picker that sits next to Save on every ingestion
 * source form. This sets the source's DEFAULT — the classification applied
 * to everything ingested through it, which a single document can override at
 * ingest time (IngestClassificationSelect).
 *
 * Server forms use `defaultValue` (posts as name="classification"); the
 * client-side builder passes `value` + `onChange` instead.
 */
export function ClassificationSelect({
  defaultValue = "public",
  value,
  onChange,
}: {
  defaultValue?: string;
  value?: string;
  onChange?: (v: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 6, flex: "1 1 200px" }}>
      <Label>Default classification</Label>
      <select
        name="classification"
        {...(onChange
          ? { value, onChange: (e) => onChange(e.target.value) }
          : { defaultValue })}
        style={field as React.CSSProperties}
      >
        {CLASSIFICATIONS.map((c) => {
          const enabled = (ENABLED_CLASSIFICATIONS as readonly string[]).includes(c);
          return (
            <option key={c} value={c} disabled={!enabled}>
              {CLASSIFICATION_LABELS[c]}
            </option>
          );
        })}
      </select>
      <p style={{ fontSize: 11, opacity: 0.7, margin: 0 }}>
        Applied to everything ingested here; each document can override it.
        Classification is recorded but not yet enforced — the chatbot still
        answers from every item regardless of tier.
      </p>
    </div>
  );
}
