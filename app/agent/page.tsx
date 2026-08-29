import Link from "next/link";
import { headers } from "next/headers";
import { getProfile } from "@/lib/db";
import { agentCardV1, siteOrigin } from "@/lib/a2a/card";
import { a2aApiKey } from "@/lib/a2a/guard";

/**
 * The human-readable side of the agent's identity: the page a person lands on
 * from a bio link or from the card's `documentationUrl`, and the one place that
 * names every machine-readable file in one list.
 *
 * The card and the facts document are for other agents; this is for whoever has
 * to decide whether to trust them.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const profile = await getProfile();
  const name = profile.company_name || profile.owner_name || "Agent";
  return {
    title: `${name} — agent card`,
    description: `How to reach ${name}'s agent over the A2A protocol.`,
  };
}

export default async function AgentPage() {
  const origin = siteOrigin(await headers());
  const [profile, card] = await Promise.all([getProfile(), agentCardV1(origin)]);
  const name = profile.company_name || profile.owner_name || "Agent";
  // Always closed now; this only decides which credential to name.
  const hasDedicatedKey = !!a2aApiKey();

  const files = [
    {
      href: "/.well-known/agent-card.json",
      label: "Agent Card",
      note: "A2A v1.0 — the file another agent fetches to learn how to call this one.",
    },
    {
      href: "/.well-known/agent-facts.json",
      label: "Agent Facts",
      note: "NANDA AgentFacts format — who runs this agent, what it does, where it lives.",
    },
    {
      href: "/.well-known/agent.json",
      label: "Agent Card (legacy path)",
      note: "The same agent described in A2A v0.3 vocabulary, for older clients.",
    },
  ];

  const curl = `curl -X POST ${origin}/api/a2a \\
  -H 'Content-Type: application/json' \\
  -H 'A2A-Version: 1.0' \\
  -H 'Authorization: Bearer <token>' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{
        "message":{"messageId":"1","role":"ROLE_USER",
                   "parts":[{"text":"What is ${name} working on?"}]}}}'`;

  return (
    <main style={s.page}>
      <div style={s.wrap}>
        <Link href="/" style={s.back}>
          ← Back to the conversation
        </Link>

        <h1 style={s.h1}>{name} has an agent.</h1>
        <p style={s.lede}>
          This site is not only readable by people. It publishes an{" "}
          <strong style={s.strong}>A2A agent card</strong>, so another AI agent can discover it,
          call it, and get answers about {name} — the same answers a visitor gets in the
          chat, delivered as protocol messages instead of pixels.
        </p>

        <section style={s.section}>
          <h2 style={s.h2}>Machine-readable files</h2>
          <div style={s.list}>
            {files.map((f) => (
              <a key={f.href} href={f.href} style={s.card}>
                <span style={s.cardLabel}>{f.label}</span>
                <code style={s.cardPath}>{f.href}</code>
                <span style={s.cardNote}>{f.note}</span>
              </a>
            ))}
          </div>
        </section>

        <section style={s.section}>
          <h2 style={s.h2}>Endpoints</h2>
          <ul style={s.ul}>
            {card.supportedInterfaces.map((i, n) => (
              <li key={`${i.url}-${i.protocolVersion}-${n}`} style={s.li}>
                <code style={s.code}>{i.url}</code>
                <span style={s.dim}>
                  {" "}
                  — {i.protocolBinding}, protocol {i.protocolVersion}
                </span>
              </li>
            ))}
          </ul>
          <p style={s.dim}>
            Streaming is supported (Server-Sent Events). Push notifications are not.
          </p>
          <p style={s.locked}>
            🔒 <strong>This agent does not accept anonymous requests.</strong> Every call must
            carry <code style={s.code}>Authorization: Bearer &lt;token&gt;</code>
            {hasDedicatedKey
              ? ", using a token issued by " + name + "."
              : ". Contact " + name + " if you need access."}{" "}
            Requests are also rate limited per caller, and repeated bad credentials lock an
            address out.
          </p>
        </section>

        <section style={s.section}>
          <h2 style={s.h2}>What it can do</h2>
          <div style={s.list}>
            {card.skills.map((skill) => (
              <div key={skill.id} style={s.skill}>
                <span style={s.cardLabel}>{skill.name}</span>
                <code style={s.cardPath}>{skill.id}</code>
                <span style={s.cardNote}>{skill.description}</span>
              </div>
            ))}
          </div>
        </section>

        <section style={s.section}>
          <h2 style={s.h2}>Try it</h2>
          <pre style={s.pre}>{curl}</pre>
        </section>

        <p style={s.footnote}>
          A2A is the Agent2Agent protocol (
          <a href="https://a2a-protocol.org" style={s.link}>
            a2a-protocol.org
          </a>
          ), now stewarded by the Linux Foundation. AgentFacts is an MIT research proposal
          (arXiv:2507.14263) and is published here as a self-declared document — nothing on this
          page has been audited by a third party.
        </p>
      </div>
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", background: "var(--bg)", padding: "48px 20px" },
  wrap: { maxWidth: 780, margin: "0 auto", display: "flex", flexDirection: "column", gap: 8 },
  back: { color: "var(--accent-on-bg)", textDecoration: "none", fontSize: 14, marginBottom: 12 },
  h1: { fontSize: 38, lineHeight: 1.15, margin: "0 0 12px" },
  lede: { fontSize: 17, lineHeight: 1.6, color: "var(--text)", opacity: 0.85, margin: "0 0 8px" },
  strong: { color: "var(--accent-on-bg)" },
  section: { marginTop: 34 },
  h2: { fontSize: 20, margin: "0 0 14px" },
  list: { display: "flex", flexDirection: "column", gap: 10 },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "14px 16px",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    textDecoration: "none",
    color: "var(--on-surface)",
  },
  skill: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "14px 16px",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    color: "var(--on-surface)",
  },
  cardLabel: { fontWeight: 600, fontSize: 15 },
  cardPath: { fontFamily: "var(--font-mono), monospace", fontSize: 13, opacity: 0.8 },
  cardNote: { fontSize: 14, opacity: 0.7, lineHeight: 1.5 },
  ul: { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 },
  li: { fontSize: 14, lineHeight: 1.6 },
  code: { fontFamily: "var(--font-mono), monospace", fontSize: 13, color: "var(--accent-on-bg)" },
  dim: { fontSize: 14, opacity: 0.7, lineHeight: 1.6 },
  pre: {
    background: "var(--bg-soft)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    padding: 16,
    overflowX: "auto",
    fontSize: 12.5,
    lineHeight: 1.6,
    fontFamily: "var(--font-mono), monospace",
    color: "var(--on-bg-soft)",
  },
  footnote: { marginTop: 40, fontSize: 13, opacity: 0.6, lineHeight: 1.6 },
  locked: {
    fontSize: 14,
    lineHeight: 1.6,
    marginTop: 12,
    padding: "12px 14px",
    background: "var(--bg-soft)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    color: "var(--on-bg-soft)",
  },
  link: { color: "var(--accent-on-bg)" },
};
