import React from "react";
import { UPLOAD_METHODS, STORAGE_KINDS } from "@/lib/ingestionSources";
import { createIngestionSourceAction } from "./actions";
import { SourceBuilder } from "./SourceBuilder";
import { PendingButton } from "./PendingButton";
import { ClassificationSelect } from "./ClassificationSelect";
import { panel, field, btn, Label } from "./ui";

/**
 * Create a new ingestion source by conversation: the builder chat on the
 * left, the draft's sample page — test mode only — on the right. The manual
 * form survives below, collapsed, for when the fields are already known.
 * Rendered as the Content section's "+ New ingestion source" sub-tab;
 * `error` echoes a failed create back above the builder.
 */
export function NewSourcePanel({ error }: { error?: string }) {
  return (
    <>
      {error ? (
        <p role="alert" style={{ color: "var(--danger, #b00020)", marginBottom: 14 }}>
          {error}
        </p>
      ) : null}

      <SourceBuilder />

      <details style={{ marginTop: 24 }}>
        <summary style={{ cursor: "pointer", fontSize: 14, marginBottom: 10 }}>
          Manual setup (skip the chat)
        </summary>
        <section data-fill="surface" style={panel}>
          <form action={createIngestionSourceAction} style={{ display: "grid", gap: 10 }}>
            <Label>Name</Label>
            <input name="label" required placeholder="e.g. Press mentions" style={field as React.CSSProperties} />
            <Label>Code (optional — derived from the name when blank)</Label>
            <input name="key" placeholder="press-mentions" style={field as React.CSSProperties} />
            <Label>Description</Label>
            <input
              name="description"
              placeholder="One line on what this source ingests"
              style={field as React.CSSProperties}
            />
            <Label>System prompt</Label>
            <textarea
              name="systemPrompt"
              rows={4}
              placeholder="How ingested content should be read, extracted, and summarized…"
              style={field as React.CSSProperties}
            />
            <Label>Upload method</Label>
            <select name="uploadMethod" defaultValue="generic" style={field as React.CSSProperties}>
              {UPLOAD_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <Label>Stores</Label>
            {/* Text-only by default; pick image or text+image when needed. */}
            <select name="storageKinds" defaultValue="text" style={field as React.CSSProperties}>
              {STORAGE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <Label>Items per upload</Label>
            <select name="splitMode" defaultValue={"split"} style={field as React.CSSProperties}>
              <option value="split">split — one item per point (default)</option>
              <option value="single">single — keep each upload as one item</option>
            </select>
            <Label>Page code (advanced, optional — HTML with a {"{{items}}"} placeholder)</Label>
            <textarea
              name="panelHtml"
              rows={6}
              defaultValue=""
              placeholder="Custom HTML for this tab; leave empty for the default page."
              style={field as React.CSSProperties}
            />
            <Label>Output (where ingested data lands)</Label>
            <input
              name="outputMethod"
              placeholder="Source/Photo rows, read back as unified text/image items"
              style={field as React.CSSProperties}
            />
            <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
              <ClassificationSelect />
              <PendingButton pendingLabel="Creating…" style={btn as React.CSSProperties}>
                Create ingestion source
              </PendingButton>
            </div>
          </form>
        </section>
      </details>
    </>
  );
}
