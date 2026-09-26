import { flat } from "@/lib/util/text";
import type { User } from "@prisma/client";
import { prisma, getProfile, getPersonaConfig } from "./db";
import { listServices, type ServiceCard } from "./cards";
import { listMenu } from "./menu";
import { displayPrice, type MenuItemData } from "./menuTypes";
import { getBookingConfig } from "./appointments";
import { personaPromptBlock } from "./persona";
import { parseSocialLinks, type SocialLink } from "./socialLinks";
import { foundingUser } from "./users";
import { safeJson } from "./util";

/**
 * The site as an LLM wants to read it: `llms.txt` (https://llmstxt.org), an
 * index a model can skim, and `llms-full.txt`, the whole curated knowledge in
 * one Markdown fetch. ChatGPT and Claude fetch pages on a user's behalf and
 * their crawlers index ahead of time; both land on a chat box that renders
 * nothing without JavaScript. These documents are what they find instead.
 *
 * Everything here is what the chatbot would tell a visitor anyway: profile,
 * persona, services, menu, projects, approved answers, source summaries and
 * the booking questions. Nothing admin-only (directives, corrections,
 * activity, orders) and nothing invented — an empty section is left
 * out rather than padded.
 */

export type LlmsFacts = {
  slug: string;
  name: string;
  owner: string;
  tagline: string;
  brandValues: string[];
  persona: string;
  contact: { address: string; phone: string; email: string; hours: string; social: SocialLink[] };
  services: ServiceCard[];
  menu: MenuItemData[];
  projects: { name: string; blurb: string; detail: string; githubUrl: string; liveUrl: string; tags: string[] }[];
  faq: { question: string; answer: string }[];
  sources: { title: string; url: string; summary: string }[];
  booking: { enabled: boolean; questions: { label: string; required: boolean }[] };
  isFounder: boolean;
};

/** Every public fact about one tenant, read once. */
export async function gatherLlmsFacts(user: User): Promise<LlmsFacts> {
  const userId = user.id;
  const [profile, persona, services, menu, projects, canned, sources, booking, founder] =
    await Promise.all([
      getProfile(userId),
      getPersonaConfig(userId),
      listServices(userId),
      listMenu(userId),
      prisma.project.findMany({ where: { userId }, orderBy: { order: "asc" } }),
      prisma.cannedAnswer.findMany({
        where: { userId, enabled: true, NOT: { answer: "" } },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { question: true, answer: true },
      }),
      // Summaries only: raw text can be a whole PDF, and the summary is what
      // the chatbot's own knowledge dump serves.
      prisma.source.findMany({
        where: { userId, status: "scanned", NOT: { kind: { startsWith: "ingest:" } } },
        orderBy: { createdAt: "desc" },
        take: 60,
        select: { title: true, url: true, filename: true, summary: true },
      }),
      getBookingConfig(userId),
      foundingUser(),
    ]);
  return {
    slug: user.slug,
    name: profile.company_name.trim() || profile.owner_name.trim() || user.name,
    owner: profile.owner_name.trim(),
    tagline: persona.tagline.trim(),
    brandValues: safeJson<unknown[]>(persona.brandValues, []).filter((v): v is string => typeof v === "string"),
    persona: personaPromptBlock(persona.personaSections),
    contact: {
      address: profile.company_address.trim(),
      phone: profile.company_phone_number.trim(),
      email: profile.company_email.trim(),
      hours: profile.company_hours.trim(),
      social: parseSocialLinks(profile.social_links),
    },
    services,
    menu,
    projects: projects.map((p) => ({
      name: p.name,
      blurb: p.blurb,
      detail: p.detail ?? "",
      githubUrl: p.githubUrl ?? "",
      liveUrl: p.liveUrl ?? "",
      tags: safeJson<unknown[]>(p.tags, []).filter((t): t is string => typeof t === "string"),
    })),
    faq: canned.map((c) => ({ question: c.question.trim(), answer: c.answer.trim() })),
    sources: sources.map((s) => ({
      title: (s.title ?? s.url ?? s.filename ?? "Source").trim(),
      url: s.url ?? "",
      summary: (s.summary ?? "").trim(),
    })),
    booking: {
      enabled: booking.enabled,
      questions: booking.fields.map((f) => ({ label: f.label, required: f.required })),
    },
    isFounder: founder?.id === userId,
  };
}

/** The one-line summary the blockquote carries. */
function summaryLine(f: LlmsFacts): string {
  if (f.tagline) return flat(f.tagline);
  const who = f.owner ? `${f.name}, run by ${f.owner}` : f.name;
  return `${who}. Ask its AI agent anything about the business; answers come only from what the owner published.`;
}

/**
 * `llms.txt`: H1, blockquote, a short paragraph, then H2 sections of
 * `- [title](url): note` lines — the exact shape the spec describes, so a
 * model that knows the format finds what it expects.
 */
export function renderLlmsIndex(f: LlmsFacts, origin: string): string {
  const page = `${origin}/a/${f.slug}`;
  const what = [
    f.owner ? `${f.name} is run by ${f.owner}.` : "",
    f.brandValues.length ? `Values: ${f.brandValues.join(", ")}.` : "",
    "Its website is a conversation with an AI agent that answers from the owner's curated knowledge only.",
    "The full document below holds everything that agent knows, in Markdown.",
  ].filter(Boolean);
  const sections = [
    `## Read`,
    `- [Everything about ${f.name}](${page}/llms-full.txt): services, menu, projects, answers to common questions, contact details and hours, in one Markdown file`,
    ``,
    `## Talk to the agent`,
    `- [Chat page](${page}): the conversation, for people`,
    `- [Chat API](${origin}/api/chat): POST JSON {"slug":"${f.slug}","messages":[{"role":"user","content":"..."}]}; the reply streams as NDJSON lines {"t":"text","v":"..."}`,
  ];
  if (f.isFounder) {
    sections.push(
      `- [A2A Agent Card](${origin}/.well-known/agent-card.json): call this agent over the A2A protocol (JSON-RPC at ${origin}/api/a2a, bearer token required)`,
    );
  }
  sections.push(``, `## Optional`, `- [All agents on this site](${origin}/llms.txt): the directory index`);
  return [`# ${f.name}`, ``, `> ${summaryLine(f)}`, ``, what.join(" "), ``, ...sections].join("\n") + "\n";
}

/** `llms-full.txt`: every section with content, in a fixed order. */
export function renderLlmsFull(f: LlmsFacts, origin: string): string {
  const sections: [string, string][] = [
    ["About", aboutSection(f)],
    ["Contact and hours", contactSection(f)],
    ["Services", servicesSection(f)],
    ["Menu", menuSection(f)],
    ["Projects", projectsSection(f)],
    ["Frequently asked questions", faqSection(f)],
    ["Sources", sourcesSection(f)],
    ["Booking", bookingSection(f)],
    ["How to talk to this agent", talkSection(f, origin)],
  ];
  const body = sections
    .filter(([, text]) => text.trim())
    .map(([title, text]) => `## ${title}\n\n${text.trim()}`)
    .join("\n\n");
  return `# ${f.name}\n\n> ${summaryLine(f)}\n\n${body}\n`;
}

function aboutSection(f: LlmsFacts): string {
  const lines = [
    f.owner ? `${f.name} is owned and run by ${f.owner}.` : "",
    f.persona,
    f.brandValues.length ? `What the business stands for: ${f.brandValues.join(", ")}.` : "",
  ];
  return lines.filter(Boolean).join("\n\n");
}

function contactSection(f: LlmsFacts): string {
  const c = f.contact;
  const lines = [
    c.address ? `- Address: ${c.address}` : "",
    c.phone ? `- Phone: ${c.phone}` : "",
    c.email ? `- Email: ${c.email}` : "",
    c.hours ? `- Hours: ${c.hours}` : "",
    ...c.social.map((s) => `- ${s.platform}: ${s.url}`),
  ];
  return lines.filter(Boolean).join("\n");
}

function servicesSection(f: LlmsFacts): string {
  return f.services
    .map((s) => (s.description ? `### ${s.name}\n\n${s.description}` : `### ${s.name}`))
    .join("\n\n");
}

function menuSection(f: LlmsFacts): string {
  // Menu rows fall back to the services catalog; when both would say the same
  // thing, the Services section already said it.
  if (!f.menu.length || menuMirrorsServices(f)) return "";
  const groups = new Map<string, MenuItemData[]>();
  for (const item of f.menu) {
    const key = item.category || "Menu";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()]
    .map(([category, items]) => `### ${category}\n\n${items.map(menuLine).join("\n")}`)
    .join("\n\n");
}

function menuMirrorsServices(f: LlmsFacts): boolean {
  if (f.menu.length !== f.services.length) return false;
  return f.menu.every((m, i) => m.name === f.services[i]?.name);
}

function menuLine(item: MenuItemData): string {
  const price = displayPrice(item);
  const facts = [
    item.shortDescription,
    item.dietaryTags.length ? `dietary: ${item.dietaryTags.join(", ")}` : "",
    item.availability === "unavailable" ? "currently unavailable" : "",
  ].filter(Boolean);
  return `- ${item.name}${price ? ` — ${price}` : ""}${facts.length ? `. ${facts.join("; ")}` : ""}`;
}

function projectsSection(f: LlmsFacts): string {
  return f.projects
    .map((p) => {
      const links = [
        p.githubUrl ? `- Source: ${p.githubUrl}` : "",
        p.liveUrl ? `- Live: ${p.liveUrl}` : "",
        p.tags.length ? `- Tags: ${p.tags.join(", ")}` : "",
      ].filter(Boolean);
      return [`### ${p.name}`, p.blurb, p.detail, links.join("\n")].filter(Boolean).join("\n\n");
    })
    .join("\n\n");
}

function faqSection(f: LlmsFacts): string {
  return f.faq.map((q) => `### ${q.question}\n\n${q.answer}`).join("\n\n");
}

function sourcesSection(f: LlmsFacts): string {
  return f.sources
    .filter((s) => s.summary || s.url)
    .map((s) => [`### ${s.title}`, s.url ? `${s.url}` : "", s.summary].filter(Boolean).join("\n\n"))
    .join("\n\n");
}

function bookingSection(f: LlmsFacts): string {
  if (!f.booking.enabled) return "";
  const asks = f.booking.questions.map((q) => `- ${q.label}${q.required ? " (required)" : ""}`);
  return `Appointments can be booked in the chat. The booking form asks:\n\n${asks.join("\n")}`;
}

function talkSection(f: LlmsFacts, origin: string): string {
  const page = `${origin}/a/${f.slug}`;
  const lines = [
    `- Chat page (for people): ${page}`,
    `- Chat API: POST ${origin}/api/chat with JSON {"slug":"${f.slug}","messages":[{"role":"user","content":"your question"}]}. The reply streams as NDJSON, one {"t":"text","v":"..."} object per line; {"t":"card"} lines carry structured UI data.`,
    `- Index of this document: ${page}/llms.txt`,
  ];
  if (f.isFounder) {
    lines.push(`- A2A Agent Card: ${origin}/.well-known/agent-card.json (JSON-RPC at ${origin}/api/a2a; a bearer token is required)`);
  }
  return lines.join("\n");
}

/** The directory's `llms.txt`: every agent, with a link to each one's files. */
export async function renderPlatformIndex(origin: string): Promise<string> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { slug: true, name: true, profile: { select: { company_name: true, owner_name: true } }, personaConfig: { select: { tagline: true } } },
  });
  const rows = users.map((u) => {
    const name = u.profile?.company_name?.trim() || u.profile?.owner_name?.trim() || u.name;
    const note = u.personaConfig?.tagline?.trim() || `chat with ${name}'s agent`;
    return `- [${name}](${origin}/a/${u.slug}/llms.txt): ${flat(note)}; full text at ${origin}/a/${u.slug}/llms-full.txt`;
  });
  return [
    `# Main Street`,
    ``,
    `> A directory of businesses, each with its own AI agent that answers from what the owner published.`,
    ``,
    `Every agent below has an llms.txt index and an llms-full.txt document with everything it knows, in Markdown. Ask a question through the chat API at ${origin}/api/chat.`,
    ``,
    `## Agents`,
    ...(rows.length ? rows : ["- No agents are set up yet."]),
    ``,
    `## Optional`,
    `- [Everything, in one file](${origin}/llms-full.txt): every agent's full document concatenated`,
    `- [Agent Card](${origin}/.well-known/agent-card.json): the A2A card of the site's founding agent`,
  ].join("\n") + "\n";
}

/** The directory's `llms-full.txt`: every tenant's full document, in order. */
export async function renderPlatformFull(origin: string): Promise<string> {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  const docs: string[] = [];
  for (const user of users) docs.push(renderLlmsFull(await gatherLlmsFacts(user), origin));
  return docs.join("\n---\n\n") || "# Main Street\n\n> No agents are set up yet.\n";
}

/** The response every llms file is served as. */
export function markdownResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300, must-revalidate",
      ETag: `W/"${hash(body)}"`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/** Small non-cryptographic digest — a cache validator, not a signature. */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
