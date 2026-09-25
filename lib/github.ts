/**
 * Import a GitHub user's public repositories as project cards. Given a profile
 * URL (or bare username), fetch their repos via the public GitHub API and shape
 * each into the fields the Project model needs. No auth token required for
 * public repos (rate-limited to 60 req/hr/IP, which is plenty for one import).
 */
import type Anthropic from "@anthropic-ai/sdk";
import { claude, claudeModel } from "./claude";

export type RepoProject = {
  name: string;
  blurb: string;
  githubUrl: string;
  liveUrl: string | null;
  stars: number;
  /** Raw repo language/topics, used as extra context when enriching. */
  language: string | null;
  topics: string[];
  /** When the repo last received a push, ISO string — drives re-sync of stale imports. */
  pushedAt: string | null;
};

/** The AI-enriched fields Haiku produces for a single project. */
export type ProjectEnrichment = {
  blurb: string;
  detail: string;
  tags: string[];
};

/** Pull the username out of a github.com profile URL, or accept a bare handle. */
function githubUsername(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  // github.com/<user>  (optionally with protocol / trailing path)
  const m = s.match(/github\.com\/([A-Za-z0-9-]+)/i);
  if (m) return m[1];
  // Bare username (no slashes, valid handle chars).
  if (/^[A-Za-z0-9-]+$/.test(s)) return s;
  return null;
}

type GhRepo = {
  name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  fork: boolean;
  archived: boolean;
  stargazers_count: number;
  language: string | null;
  topics?: string[];
  pushed_at: string | null;
};

/**
 * Fetch a user's public, non-fork, non-archived repos, most-starred first,
 * capped at `limit`. Throws with a clear message on a bad user / rate limit.
 */
export async function fetchGithubProjects(
  usernameOrUrl: string,
  limit = 12,
): Promise<RepoProject[]> {
  const user = githubUsername(usernameOrUrl);
  if (!user) throw new Error("Couldn't read a GitHub username from that link.");

  const res = await fetch(
    `https://api.github.com/users/${user}/repos?per_page=100&sort=updated`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "blake-personal-site",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (res.status === 404) throw new Error(`No GitHub user "${user}".`);
  if (res.status === 403) throw new Error("GitHub rate limit hit — try again in a bit.");
  if (!res.ok) throw new Error(`GitHub request failed: ${res.status}`);

  const repos = (await res.json()) as GhRepo[];
  if (!Array.isArray(repos)) return [];

  return repos
    .filter((r) => !r.fork && !r.archived)
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, limit)
    .map((r) => ({
      name: r.name,
      blurb: (r.description ?? "").trim() || `${r.name} — a project on GitHub.`,
      githubUrl: r.html_url,
      liveUrl: r.homepage && r.homepage.trim() ? r.homepage.trim() : null,
      stars: r.stargazers_count,
      language: r.language ?? null,
      topics: Array.isArray(r.topics) ? r.topics.slice(0, 8) : [],
      pushedAt: r.pushed_at ?? null,
    }));
}

/**
 * Ask Haiku to turn a repo's thin metadata into a polished card blurb, a longer
 * "Learn more" detail paragraph, and a few topic tags. Grounded strictly in the
 * repo's own name/description/language/topics — no invented features. Falls back
 * to the raw repo blurb (and no detail/tags) if the model call or JSON parse
 * fails, so an import never breaks on one bad project.
 */
export async function enrichProject(repo: RepoProject): Promise<ProjectEnrichment> {
  const fallback: ProjectEnrichment = { blurb: repo.blurb, detail: "", tags: [] };

  const context =
    `Repository name: ${repo.name}\n` +
    `GitHub description: ${repo.blurb || "(none)"}\n` +
    `Primary language: ${repo.language ?? "(unknown)"}\n` +
    `Topics: ${repo.topics.length ? repo.topics.join(", ") : "(none)"}\n` +
    `Stars: ${repo.stars}`;

  const prompt =
    `You are writing project cards for Blake's personal portfolio site. Using ONLY ` +
    `the repository facts below, write an appealing description of this project. Do ` +
    `not invent features, users, or results that aren't implied by the facts. If the ` +
    `facts are thin, keep it short and honest rather than padding.\n\n` +
    `Return STRICT JSON with keys:\n` +
    `  "blurb"  — one punchy sentence (max ~140 chars) for the card.\n` +
    `  "detail" — 2-4 sentences expanding on what it is, the tech, and why it's ` +
    `interesting, shown when the visitor clicks "Learn more".\n` +
    `  "tags"   — array of 3-5 short lowercase topic tags (tech or theme).\n` +
    `No prose outside the JSON.\n\n${context}`;

  try {
    const msg = await claude().messages.create({
      model: claudeModel(),
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    return {
      blurb: String(json.blurb ?? "").trim() || repo.blurb,
      detail: String(json.detail ?? "").trim(),
      tags: Array.isArray(json.tags) ? json.tags.map(String).slice(0, 5) : [],
    };
  } catch {
    return fallback;
  }
}
