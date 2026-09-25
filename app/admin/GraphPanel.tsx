import { ORIGIN_LABELS } from "@/lib/retrieval/origins";
import type { GraphEntity, GraphEdge, GraphStats, MergeSuggestion } from "@/lib/retrieval/graph";
import { GraphCanvas } from "./GraphCanvas";
import { Count, EntitiesPane, RelationsPane } from "./GraphView";
import { RetrievalPlayground } from "./RetrievalPlayground";
import { SubTabs } from "./SubTabs";
import { backfillEmbeddings, rebuildOverviews } from "@/app/admin/actions/graph";
import { PendingButton } from "./PendingButton";
import { SectionTitle, Label, btnGhost } from "./ui";

/**
 * The Graph section: a sub-tab strip above the panels, same layout as the
 * Content section — Graph (index health + the node-link picture), Test
 * (retrieval playground), Entities and Relationships (the editing panes,
 * counts in the tab labels), and Overviews. Each tab is its own titled panel.
 * A wrong or duplicated entity here shows up as a worse chatbot answer, so
 * this is where it gets corrected.
 */
export function GraphPanel({
  stats,
  entities,
  edges,
  suggestions,
  overviews,
}: {
  stats: GraphStats;
  entities: GraphEntity[];
  edges: GraphEdge[];
  suggestions: MergeSuggestion[];
  overviews: { id: string; originLabel: string; text: string }[];
}) {
  return (
    <SubTabs
      ariaLabel="Graph sections"
      tabs={[
        {
          key: "graph",
          label: "Graph",
          content: (
            <Panel title="Knowledge graph">
              <p style={hint}>
                Everything you curate — your profile, persona, projects, photos, saved sources,
                and the answers you approve on Activity — is split into chunks and read for the
                people, orgs, projects and topics it names, plus how they relate. The chatbot
                follows those relations to find facts a plain keyword match would miss.
              </p>
              <GraphTab stats={stats} entities={entities} edges={edges} />
            </Panel>
          ),
        },
        {
          key: "test",
          label: "Test",
          content: (
            <Panel title="Test retrieval">
              <RetrievalPlayground />
            </Panel>
          ),
        },
        {
          key: "entities",
          label: (
            <>
              Entities <Count n={entities.length} />
              {suggestions.length > 0 && <Count n={suggestions.length} danger />}
            </>
          ),
          content: (
            <Panel title="Entities">
              <EntitiesPane entities={entities} suggestions={suggestions} />
            </Panel>
          ),
        },
        {
          key: "relations",
          label: (
            <>
              Relationships <Count n={edges.length} />
            </>
          ),
          content: (
            <Panel title="Relationships">
              <RelationsPane entities={entities} edges={edges} />
            </Panel>
          ),
        },
        {
          key: "overviews",
          label: "Overviews",
          content: (
            <Panel title="Overviews">
              <OverviewsTab overviews={overviews} />
            </Panel>
          ),
        },
      ]}
    />
  );
}

/** One sub-tab's surface: the same titled maroon panel the Content tabs use. */
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section data-fill="surface" style={panel}>
      <SectionTitle>{title}</SectionTitle>
      {children}
    </section>
  );
}

/** Index health up top, then the graph itself as a picture. */
function GraphTab({
  stats,
  entities,
  edges,
}: {
  stats: GraphStats;
  entities: GraphEntity[];
  edges: GraphEdge[];
}) {
  const mixedIndex = stats.embedModels.length > 1;

  return (
    <div>
      <div style={statGrid}>
        <Stat label="Sources" value={stats.sources} />
        <Stat label="Chunks" value={stats.chunks} />
        <Stat label="Entities" value={stats.entities} />
        <Stat label="Relations" value={stats.edges} />
        <Stat label="Orphans" value={stats.orphanEntities} />
      </div>

      {/* Where the knowledge actually comes from. A graph fed by one origin
          describes that origin, not the person. */}
      {stats.origins.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <Label>Indexed from</Label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {stats.origins.map((o) => (
              <span key={o.kind} style={originPill}>
                {ORIGIN_LABELS[o.kind] ?? o.kind}
                <strong style={{ marginLeft: 6 }}>{o.count}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Index health — both of these silently degrade retrieval. */}
      {stats.chunksWithoutEmbedding > 0 && (
        <Notice>
          {stats.chunksWithoutEmbedding} chunk(s) have no embedding, so only keyword matching can
          find them. Embedding just those chunks costs one provider call per batch — no
          re-scanning, no Claude calls, and the entities and relations stay exactly as they are.
          <form action={backfillEmbeddings} style={{ marginTop: 8 }}>
            <PendingButton
              pendingLabel="Embedding…"
              style={{ ...btnGhost, padding: "6px 14px" }}
            >
              Embed {stats.chunksWithoutEmbedding} missing chunk(s)
            </PendingButton>
          </form>
        </Notice>
      )}
      {mixedIndex && (
        <Notice>
          Chunks are split across {stats.embedModels.length} embedding models (
          {stats.embedModels.map((m) => `${m.model}: ${m.count}`).join(", ")}). Similarity is only
          compared within one model, so part of your knowledge is keyword-only. Re-index
          everything to put it all on one model.
        </Notice>
      )}
      {!mixedIndex && stats.embedModels[0] && (
        <p style={hint}>
          All {stats.embedModels[0].count} chunks embedded with{" "}
          <strong>{stats.embedModels[0].model}</strong>.
        </p>
      )}

      <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 16 }}>
        <GraphCanvas entities={entities} edges={edges} />
      </div>
    </div>
  );
}

/**
 * Neighborhood overviews — what broad questions are served instead of chunks.
 * Rebuilding is explicit: up to 6 Claude calls per press.
 */
function OverviewsTab({
  overviews,
}: {
  overviews: { id: string; originLabel: string; text: string }[];
}) {
  return (
    <div>
      <p style={hint}>
        One paragraph per neighborhood of the graph, served for broad questions like &ldquo;tell
        me about Blake&rdquo;.
      </p>
      {overviews.length === 0 ? (
        <p style={hint}>
          None yet. Rebuild after the graph has some content — each rebuild summarizes up to 6
          neighborhoods with one Claude call apiece.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          {overviews.map((o) => (
            <div key={o.id} style={overviewBox}>
              <strong style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                {o.originLabel}
              </strong>
              <span style={{ fontSize: 13 }}>{o.text}</span>
            </div>
          ))}
        </div>
      )}
      <form action={rebuildOverviews}>
        <PendingButton pendingLabel="Rebuilding…" style={{ ...btnGhost, padding: "6px 14px" }}>
          Rebuild overviews
        </PendingButton>
      </form>
    </div>
  );
}

/** A `div`, not a `p` — the missing-embedding notice carries a repair form. */
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 13,
        color: "var(--danger-on-surface)",
        border: "1px solid color-mix(in srgb, var(--danger-on-surface) 45%, transparent)",
        borderRadius: "var(--radius-sm)",
        padding: "8px 12px",
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div data-fill="bg-soft" style={statTile}>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-heading)", lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={statLabel}>{label}</div>
    </div>
  );
}

const panel: React.CSSProperties = {
  background: "var(--surface)",
  color: "var(--on-surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: 20,
  marginBottom: 20,
};
const hint: React.CSSProperties = {
  color: "var(--on-surface)",
  fontStyle: "italic",
  fontSize: 13,
  marginBottom: 14,
};
const statGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
  gap: 10,
  marginBottom: 14,
};
const statTile: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "10px 12px",
  background: "var(--bg-soft)",
  color: "var(--on-bg-soft)",
};
const statLabel: React.CSSProperties = {
  fontSize: 11,
  fontStyle: "italic",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginTop: 2,
};
const overviewBox: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "8px 12px",
};
const originPill: React.CSSProperties = {
  fontSize: 12,
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-pill)",
  padding: "3px 11px",
  background: "var(--bg-soft)",
  color: "var(--on-bg-soft)",
};
