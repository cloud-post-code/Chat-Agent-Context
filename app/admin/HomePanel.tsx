import Link from "next/link";
import { panel, SectionTitle, Label, Stat } from "./ui";
import type { AttentionItem, ChecklistItem } from "./homeItems";

/**
 * The Home tab: what needs the owner's attention right now, and what setup
 * is still missing. Every row is a deep link into the panel that resolves
 * it (`?tab=`), so this tab is a launchpad, not a place to work.
 */
export function HomePanel({
  attention,
  checklist,
}: {
  attention: AttentionItem[];
  checklist: ChecklistItem[];
}) {
  const remaining = checklist.filter((c) => !c.done);
  return (
    <>
      <section data-fill="surface" style={panel}>
        <SectionTitle>Needs your attention</SectionTitle>
        {attention.length === 0 ? (
          <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 14 }}>
            All clear. New chats will show up here.
          </p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            {attention.map((a) => (
              <Link key={`${a.tab}-${a.label}`} href={`/admin/dashboard?tab=${a.tab}`} style={{ textDecoration: "none", color: "inherit" }}>
                <Stat label={a.label} value={a.count} detail={a.detail} />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section data-fill="surface" style={panel}>
        <SectionTitle>Set up your agent</SectionTitle>
        <Label>
          {remaining.length === 0
            ? "Everything is set up."
            : `${remaining.length} of ${checklist.length} steps left`}
        </Label>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {checklist.map((c) => (
            <li key={`${c.tab}-${c.label}`}>
              <Link
                href={`/admin/dashboard?tab=${c.tab}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  textDecoration: "none",
                  color: "inherit",
                  fontSize: 13,
                  opacity: c.done ? 0.6 : 1,
                }}
              >
                <span aria-hidden style={{ width: 18, textAlign: "center" }}>{c.done ? "✓" : "○"}</span>
                <span style={{ textDecoration: c.done ? "line-through" : "none" }}>{c.label}</span>
                {!c.done && <span style={{ marginLeft: "auto", fontStyle: "italic" }}>Open →</span>}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
