"use client";

import { useState, useTransition } from "react";
import type { RetrievalPreview } from "@/lib/retrieval/graph";
import { previewRetrieval } from "@/app/admin/actions/graph";
import { field, btn, Label } from "./ui";

/**
 * The Test retrieval box: type a question, see exactly what the chatbot would
 * be given for it — which chunks (and whether they ranked or arrived through
 * a graph hop), which relations, and which entities the question matched.
 * Read-only; exists so graph edits are driven by observation, not guesswork.
 */
export function RetrievalPlayground() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<RetrievalPreview | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () => {
    const q = query.trim();
    if (!q || pending) return;
    startTransition(async () => {
      setResult(await previewRetrieval(q));
    });
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <Label>Type a question and see exactly what the chatbot would be given for it</Label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Where has Blake worked?"
          style={{ ...field, marginBottom: 0, flex: 1, minWidth: 220 }}
        />
        <button style={btn} disabled={pending}>
          {pending ? "Retrieving…" : "Retrieve"}
        </button>
      </form>

      {result && (
        <div style={{ marginTop: 12 }}>
          {result.queryEntities.length > 0 && (
            <p style={meta}>
              Recognized in the question:{" "}
              {result.queryEntities.map((n) => (
                <span key={n} style={pill}>{n}</span>
              ))}
            </p>
          )}

          {result.chunks.length === 0 ? (
            <p style={meta}>
              {result.indexEmpty
                ? "Nothing is indexed yet — add content on the Knowledge tab."
                : "Nothing in the knowledge base matched this question — exactly what the chatbot would be told."}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {result.chunks.map((c, i) => (
                <div key={i} style={chunkBox}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                    <strong style={{ fontSize: 12 }}>{c.ref}</strong>
                    <span style={pill}>{c.via === "graph" ? "via graph" : "ranked"}</span>
                    <span style={{ ...meta, marginBottom: 0 }}>score {c.score.toFixed(3)}</span>
                  </div>
                  <div style={chunkText}>{c.text}</div>
                </div>
              ))}
            </div>
          )}

          {result.relations.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <Label>Relations attached to the prompt</Label>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {result.relations.map((r) => (
                  <li key={r} style={{ fontSize: 13 }}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const meta: React.CSSProperties = {
  fontSize: 12,
  fontStyle: "italic",
  color: "var(--on-surface)",
  marginBottom: 8,
};
const pill: React.CSSProperties = {
  fontSize: 11,
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-pill)",
  padding: "2px 9px",
  background: "var(--bg-soft)",
  color: "var(--on-bg-soft)",
  marginRight: 4,
};
const chunkBox: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "8px 12px",
};
const chunkText: React.CSSProperties = {
  fontSize: 12,
  whiteSpace: "pre-wrap",
  maxHeight: 130,
  overflowY: "auto",
};
