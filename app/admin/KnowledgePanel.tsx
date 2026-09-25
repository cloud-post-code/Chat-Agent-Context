import { safeTags } from "@/lib/knowledge";
import { rescanSource, updateSourceSummary, deleteSource } from "@/app/admin/actions/content";
import { Extractor } from "./Extractor";
import { PendingButton } from "./PendingButton";
import { panel, field, btnGhost, btnDanger, SectionTitle, Stamp } from "./ui";

/**
 * One Knowledge tab of the Content section. Knowledge comes in three kinds —
 * scanned links, uploaded PDFs/Word docs, and pasted text — and each kind gets
 * its own tab: the ingest form for that kind on top, then only the sources of
 * that kind below. Splitting it keeps a long mixed list from burying the one
 * kind you came to edit.
 */

/** The Source fields these panels render; a Prisma source row satisfies it. */
export type KnowledgeSource = {
  id: string;
  type: string;
  status: string;
  title: string | null;
  filename: string | null;
  url: string | null;
  error: string | null;
  summary: string | null;
  tags: string;
  /** When this piece of knowledge was ingested. */
  createdAt: Date;
};

/** PDFs and Word uploads are one kind to the reader, two types in the db. */
export const isDocSource = (type: string) => type === "pdf" || type === "doc";

export function KnowledgePanel({
  mode,
  title,
  blurb,
  rows,
  empty,
}: {
  mode: "link" | "pdf" | "text";
  title: string;
  blurb: string;
  rows: KnowledgeSource[];
  empty: string;
}) {
  return (
    <section data-fill="surface" style={panel}>
      <SectionTitle>{title}</SectionTitle>
      <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13, marginBottom: 14 }}>
        {blurb}
      </p>
      <Extractor mode={mode} />
      {rows.length === 0 ? (
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 14, marginTop: 18 }}>
          {empty}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 18 }}>
          {rows.map((s) => (
            <SourceRow key={s.id} source={s} />
          ))}
        </div>
      )}
    </section>
  );
}

/** One stored source: what it is, whether the scan worked, and its summary. */
function SourceRow({ source: s }: { source: KnowledgeSource }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
            <TypePill t={s.type} />
            <StatusPill status={s.status} />
            <strong style={{ fontSize: 14 }}>{s.title || s.filename || s.url || "(untitled)"}</strong>
            <Stamp date={s.createdAt} prefix="ingested" />
          </div>
          {s.url && (
            <a href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, wordBreak: "break-all" }}>{s.url}</a>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {s.type === "link" && (
            <form action={rescanSource}>
              <input type="hidden" name="id" value={s.id} />
              <PendingButton pendingLabel="Rescanning…" style={btnGhost as React.CSSProperties}>
                Rescan
              </PendingButton>
            </form>
          )}
          <form action={deleteSource}>
            <input type="hidden" name="id" value={s.id} />
            <PendingButton pendingLabel="Deleting…" style={btnDanger as React.CSSProperties}>
              Delete
            </PendingButton>
          </form>
        </div>
      </div>
      {s.error && <p style={{ color: "var(--danger-on-surface)", fontSize: 12, marginTop: 6 }}>{s.error}</p>}
      <form action={updateSourceSummary} style={{ marginTop: 10 }}>
        <input type="hidden" name="id" value={s.id} />
        <textarea name="summary" defaultValue={s.summary ?? ""} rows={2} placeholder="Summary the chatbot will use…" style={{ ...field, marginBottom: 8, resize: "vertical" }} />
        {safeTags(s.tags).length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {safeTags(s.tags).map((t) => (
              <span key={t} style={{ fontSize: 11, color: "var(--accent-on-surface)" }}>#{t}</span>
            ))}
          </div>
        )}
        <PendingButton pendingLabel="Saving…" style={btnGhost as React.CSSProperties}>
          Save summary
        </PendingButton>
      </form>
    </div>
  );
}

function TypePill({ t }: { t: string }) {
  const icon = t === "pdf" ? "PDF" : t === "doc" ? "DOC" : t === "text" ? "TXT" : "LINK";
  return (
    <span style={{ fontSize: 11, color: "var(--on-surface)", fontStyle: "italic", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", padding: "1px 7px" }}>{icon}</span>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { c: string; t: string }> = {
    scanned: { c: "var(--success-on-surface)", t: "scanned" },
    pending: { c: "var(--accent-on-surface)", t: "pending" },
    failed: { c: "var(--danger-on-surface)", t: "failed" },
  };
  const s = map[status] ?? map.pending;
  return (
    <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: s.c, border: `1px solid ${s.c}`, borderRadius: "var(--radius-pill)", padding: "1px 7px" }}>{s.t}</span>
  );
}
