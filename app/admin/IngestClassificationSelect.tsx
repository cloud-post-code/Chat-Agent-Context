import React from "react";
import {
  ENABLED_CLASSIFICATIONS,
  CLASSIFICATION_LABELS,
  type Classification,
} from "@/lib/ingestionSources.shared";
import { field, Label } from "./ui";

/**
 * The "who is this for?" picker that sits on every ingest form. It differs
 * from ClassificationSelect (which sets a SOURCE's classification) in what it
 * means: this one classifies the ONE document being ingested, and its first
 * option is the source's own classification — so the default is chosen by
 * doing nothing, and an override is a deliberate act.
 *
 * The inherit option posts an empty value, which the server reads as "no
 * override": the item keeps following the source, including when the source's
 * classification later changes.
 */
export function IngestClassificationSelect({
  sourceDefault,
  label = "Who is this for?",
}: {
  sourceDefault: string;
  label?: string;
}) {
  const fallback = (CLASSIFICATION_LABELS as Record<string, string>)[sourceDefault] ??
    CLASSIFICATION_LABELS.public;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <Label>{label}</Label>
      <select name="classification" defaultValue="" style={field as React.CSSProperties}>
        <option value="">Same as this source ({fallback})</option>
        {ENABLED_CLASSIFICATIONS.map((c: Classification) => (
          <option key={c} value={c}>
            {CLASSIFICATION_LABELS[c]}
          </option>
        ))}
      </select>
    </div>
  );
}
