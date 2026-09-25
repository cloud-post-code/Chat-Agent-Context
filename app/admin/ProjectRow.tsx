"use client";

import { useState } from "react";
import { updateProject, deleteProject } from "@/app/admin/actions/content";
import { PendingButton } from "./PendingButton";
import { field, btn, btnGhost, btnDanger, Label } from "./ui";

export type ProjectRowData = {
  id: string;
  name: string;
  blurb: string;
  detail: string | null;
  tags: string[];
  githubUrl: string | null;
  liveUrl: string | null;
  order: number;
  /** Preformatted "ingested …" stamp (client component — dates arrive as text). */
  ingestedAt?: string;
};

/**
 * One saved project in the admin list. Reads as a summary card until "Edit"
 * flips it into an inline form over the same fields the GitHub import fills,
 * so an AI-written blurb, detail, or tag set can be corrected by hand.
 */
export function ProjectRow({ project }: { project: ProjectRowData }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <form
        action={updateProject}
        onSubmit={() => setEditing(false)}
        style={{
          border: "1px solid var(--primary)",
          borderRadius: "var(--radius-sm)",
          padding: "12px 14px",
        }}
      >
        <input type="hidden" name="id" value={project.id} />
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
          <div>
            <Label>Name</Label>
            <input name="name" defaultValue={project.name} required style={field} />
          </div>
          <div>
            <Label>Order (0 = first)</Label>
            <input name="order" type="number" defaultValue={project.order} style={field} />
          </div>
        </div>

        <Label>Short description (the card blurb)</Label>
        <textarea
          name="blurb"
          defaultValue={project.blurb}
          rows={2}
          style={{ ...field, resize: "vertical" }}
        />

        <Label>Detail (shown when a visitor expands &ldquo;Learn more&rdquo;)</Label>
        <textarea
          name="detail"
          defaultValue={project.detail ?? ""}
          rows={4}
          style={{ ...field, resize: "vertical" }}
        />

        <Label>Tags (comma-separated)</Label>
        <input name="tags" defaultValue={project.tags.join(", ")} style={field} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <Label>GitHub URL</Label>
            <input name="githubUrl" defaultValue={project.githubUrl ?? ""} style={field} />
          </div>
          <div>
            <Label>Live URL</Label>
            <input name="liveUrl" defaultValue={project.liveUrl ?? ""} style={field} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <PendingButton pendingLabel="Saving…" style={btn}>
            Save changes
          </PendingButton>
          <button type="button" onClick={() => setEditing(false)} style={btnGhost}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        padding: "10px 14px",
        gap: 10,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <strong style={{ fontSize: 14 }}>{project.name}</strong>
          {project.ingestedAt && (
            <span style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 11 }}>
              ingested {project.ingestedAt}
            </span>
          )}
        </div>
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13 }}>
          {project.blurb}
        </p>
        {project.detail && (
          <details style={{ marginTop: 4 }}>
            <summary
              style={{
                fontSize: 12,
                color: "var(--on-surface)",
                fontStyle: "italic",
                cursor: "pointer",
              }}
            >
              Learn more
            </summary>
            <p
              style={{
                color: "var(--on-surface)",
                fontStyle: "italic",
                fontSize: 13,
                marginTop: 4,
              }}
            >
              {project.detail}
            </p>
          </details>
        )}
        {project.tags.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            {project.tags.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: "var(--radius-pill)",
                  border: "1px solid var(--border)",
                  color: "var(--on-surface)",
                  fontStyle: "italic",
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          {project.githubUrl && (
            <a href={project.githubUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
              GitHub
            </a>
          )}
          {project.liveUrl && (
            <a href={project.liveUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
              Live
            </a>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <button type="button" onClick={() => setEditing(true)} style={btnGhost}>
          Edit
        </button>
        <form action={deleteProject}>
          <input type="hidden" name="id" value={project.id} />
          <PendingButton pendingLabel="Deleting…" style={btnDanger as React.CSSProperties}>
            Delete
          </PendingButton>
        </form>
      </div>
    </div>
  );
}
