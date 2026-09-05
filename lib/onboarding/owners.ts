import { claude, claudeModel } from "@/lib/claude";
import type { Crawler, Page } from "./crawl";

/**
 * The owner-name extraction step of the core stage. Owner names rarely sit
 * under an explicit "Owner:" label — they live in prose and bio headings on
 * About, Team, Our Story, Staff, and Contact pages — so this module does its
 * own page discovery and, when a model key is configured, its own extraction
 * prompt. Without a key it falls back to pattern parsing. Either way: never
 * invent; a business can have several owners and every distinct one is kept.
 */

export type Owner = { name: string; role: string };

export const OWNERS_SYSTEM_PROMPT = `You find the names of a business's owners in text extracted from its website. The text below contains multiple pages, each preceded by "=== <url>". Owner names most often appear on About, Team, Our Story, Staff, Meet the Owner, and Contact pages — read every page provided, not just the first.

Who counts as an owner:
- Anyone the text identifies as owner, co-owner, founder, co-founder, proprietor, or principal — whether stated as a label ("Owner: Jane Smith"), in prose ("The shop was founded by Jane Smith and her brother Tom"), in a bio heading ("Jane Smith, Co-Owner"), or in a caption.
- A business can have MANY owners. Return every distinct person the text identifies as one — never stop at the first match.
- Do NOT include employees, managers, or staff unless the text also identifies them as an owner or founder.

Rules:
- Report ONLY names that literally appear in the text. Never guess, infer from an email address or domain name, or fill gaps. If the text names no owner, return an empty list.
- Use the person's full name exactly as written. The same person mentioned on several pages is ONE entry.
- "role" is the ownership title the text uses for that person (e.g. "Owner", "Co-Founder"), copied as written.

Respond with ONLY this JSON, no other text:
{"owners":[{"name":"","role":""}]}`;

/**
 * Pages worth reading for owner names: nav links that sound like about/team
 * pages, plus the common paths sites use for them even when unlinked.
 */
export async function discoverOwnerPages(
  crawler: Crawler,
  home: Page,
  preloaded: Page[],
): Promise<Page[]> {
  const seen = new Set<string>([home.url, ...preloaded.map((p) => p.url)]);
  const pages: Page[] = [home, ...preloaded];

  const candidates = crawler
    .navLinks(home)
    .filter((l) => /about|team|our\s?story|staff|meet|founders?|who we are|contact/i.test(l.text))
    .map((l) => l.url);
  for (const p of [
    "/about", "/about-us", "/team", "/our-team", "/our-story",
    "/staff", "/meet-the-team", "/founders", "/contact",
  ]) {
    const abs = crawler.resolve(p);
    if (abs) candidates.push(abs);
  }

  for (const url of [...new Set(candidates)].slice(0, 10)) {
    if (seen.has(url)) continue;
    seen.add(url);
    const page = await crawler.load(url);
    if (page) pages.push(page);
  }
  return pages;
}

function pageText(page: Page): string {
  const clone = page.$("body").clone();
  clone.find("script, style").remove();
  return clone.text().replace(/\s+/g, " ").trim();
}

// A person's name as sites write it: 2–4 capitalized words.
const NAME = "[A-Z][a-zA-Z'-]+(?:\\s[A-Z][a-zA-Z'-]+){1,3}";
const TITLE = "(?:[Cc]o-)?[Oo]wner|(?:[Cc]o-)?[Ff]ounder|[Pp]roprietor|[Pp]rincipal";

/**
 * Deterministic fallback: explicit ownership statements only — a label, an
 * "owned/founded by" sentence, or a "Name, Title" bio heading. Prose that
 * doesn't literally claim ownership yields nothing.
 */
export function parsePageOwners(text: string): Owner[] {
  const found: Owner[] = [];
  for (const m of text.matchAll(new RegExp(`(${TITLE})s?\\s*:\\s*(${NAME})`, "g"))) {
    found.push({ name: m[2], role: m[1] });
  }
  for (const m of text.matchAll(
    new RegExp(`[Oo]wned(?:\\s+and\\s+operated)?\\s+by\\s+(${NAME})(?:\\s+and\\s+(${NAME}))?`, "g"),
  )) {
    found.push({ name: m[1], role: "Owner" });
    if (m[2]) found.push({ name: m[2], role: "Owner" });
  }
  for (const m of text.matchAll(
    new RegExp(`[Ff]ounded\\s+by\\s+(${NAME})(?:\\s+and\\s+(${NAME}))?`, "g"),
  )) {
    found.push({ name: m[1], role: "Founder" });
    if (m[2]) found.push({ name: m[2], role: "Founder" });
  }
  for (const m of text.matchAll(new RegExp(`(${NAME}),\\s*(${TITLE})\\b`, "g"))) {
    found.push({ name: m[1], role: m[2] });
  }
  return mergeOwners(found);
}

/** Distinct people (case-insensitive by name), first mention's spelling wins. */
function mergeOwners(owners: Owner[]): Owner[] {
  const out: Owner[] = [];
  for (const o of owners) {
    const existing = out.find((e) => e.name.toLowerCase() === o.name.toLowerCase());
    if (!existing) out.push(o);
    else if (!existing.role && o.role) existing.role = o.role;
  }
  return out;
}

/** Model output → clean bounded Owner[]. Anything malformed is dropped. */
export function sanitizeOwners(raw: unknown): Owner[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { owners?: unknown }).owners)) {
    return [];
  }
  const out: Owner[] = [];
  for (const o of (raw as { owners: unknown[] }).owners) {
    const owner = (o ?? {}) as Record<string, unknown>;
    const name = typeof owner.name === "string" ? owner.name.trim() : "";
    if (!name) continue;
    out.push({ name, role: typeof owner.role === "string" ? owner.role.trim() : "" });
  }
  return mergeOwners(out).slice(0, 12);
}

async function promptExtract(pages: Page[], log: (m: string) => void): Promise<Owner[] | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const corpus = pages
    .map((p) => `=== ${p.url}\n${pageText(p).slice(0, 3500)}`)
    .join("\n\n")
    .slice(0, 40_000);
  try {
    const res = await claude().messages.create({
      model: claudeModel(),
      max_tokens: 1000,
      system: OWNERS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: corpus }],
    });
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    return json ? sanitizeOwners(JSON.parse(json)) : null;
  } catch (err) {
    log(`Model extraction unavailable (${err instanceof Error ? err.message.slice(0, 60) : "error"}) — using the pattern parser`);
    return null;
  }
}

/** Every distinct owner from the discovered pages. The prompt reads prose the
 *  patterns can't; when it finds nobody (or can't run) the patterns stand. */
export async function extractOwners(
  pages: Page[],
  log: (m: string) => void,
): Promise<Owner[]> {
  const fromPrompt = (await promptExtract(pages, log)) ?? [];
  if (fromPrompt.length) return fromPrompt;
  return mergeOwners(pages.flatMap((p) => parsePageOwners(pageText(p))));
}

/** The single profile field: distinct names, comma-joined. */
export function ownersToOwnerName(owners: Owner[]): string {
  return owners.map((o) => o.name).join(", ");
}
