import { prisma, getProfile, getPersonaConfig } from "@/lib/db";
import { a2aApiKey } from "./guard";
import type { AgentCardV1, AgentSkill } from "./types";

/**
 * Builds this site's Agent Card — the document another agent fetches to learn
 * that this site is an agent at all, and how to talk to it.
 *
 * §8.1 of the spec makes it the one hard requirement: "A2A Servers MUST make an
 * Agent Card available." Everything else in A2A is discovered from here, so the
 * card is generated from the live Profile rather than hardcoded: any site built
 * from this template describes its own owner, with its own skills, without
 * anyone editing JSON.
 */

/** The version of THIS agent (not of the protocol). Bump on behavior changes. */
const AGENT_VERSION = "1.0.0";

/** Where the JSON-RPC endpoint lives, relative to the site root. */
export const A2A_RPC_PATH = "/api/a2a";
/** Where the equivalent HTTP+JSON (REST) binding lives. */
export const A2A_REST_PATH = "/api/a2a/rest";

// Shared with the Google OAuth callback, which needs the same answer; re-exported
// so the several .well-known routes that import it from here keep working.
export { siteOrigin } from "@/lib/util";

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";
}

/**
 * Skills are descriptive, not callable (§4.4.1) — they tell a calling agent
 * what this one is worth asking. So they're derived from what the site
 * actually holds: no projects, no project skill.
 */
async function buildSkills(userId: string, name: string): Promise<AgentSkill[]> {
  const [projectCount, photoCount, sourceCount] = await Promise.all([
    prisma.project.count({ where: { userId } }),
    prisma.photo.count({ where: { userId } }),
    prisma.source.count({ where: { userId } }),
  ]);
  const who = name || "the site owner";
  const key = slug(name);

  const skills: AgentSkill[] = [
    {
      id: `ask-about-${key}`,
      name: `Ask about ${who}`,
      description:
        `Answers questions about ${who} — background, work history, projects, writing, ` +
        `interests and point of view — from a curated knowledge base. Answers are grounded ` +
        `in material ${who} published; the agent declines rather than inventing facts.`,
      tags: ["biography", "portfolio", "question-answering", "person"],
      examples: [
        `What is ${who} working on right now?`,
        `Summarize ${who}'s professional background.`,
        `Has ${who} worked with AI agents before?`,
        `How should I get in touch with ${who}?`,
      ],
      inputModes: ["text/plain"],
      outputModes: ["text/plain", "application/json"],
    },
  ];

  if (projectCount > 0) {
    skills.push({
      id: "list-projects",
      name: "List projects",
      description:
        `Returns ${who}'s projects as structured JSON — name, blurb, description, tags, ` +
        `source repository and live URL — so a calling agent can read them as data ` +
        `rather than parsing prose.`,
      tags: ["projects", "portfolio", "structured-data"],
      examples: ["List every project.", "Which projects are open source?"],
      inputModes: ["text/plain"],
      outputModes: ["application/json", "text/plain"],
    });
  }

  if (photoCount > 0) {
    skills.push({
      id: "browse-photos",
      name: "Browse photos",
      description: `Returns ${who}'s photos with captions as structured JSON, including image URLs.`,
      tags: ["photos", "media", "structured-data"],
      examples: ["Show me some photos.", "What do the photos say about his life?"],
      inputModes: ["text/plain"],
      outputModes: ["application/json", "text/plain"],
    });
  }

  if (sourceCount > 0) {
    skills.push({
      id: "cite-sources",
      name: "Answer from published writing",
      description:
        `Answers using ${who}'s uploaded documents, articles and links, retrieved per ` +
        `question from an embedded knowledge index.`,
      tags: ["retrieval", "documents", "research"],
      examples: [`What has ${who} written about their field?`],
      inputModes: ["text/plain"],
      outputModes: ["text/plain"],
    });
  }

  return skills;
}

/**
 * The endpoint is closed, so the card always declares the bearer scheme. This
 * is the honest thing to publish and also the useful one: a calling agent reads
 * it and knows to ask for a token instead of retrying a 401 forever.
 */
function securityBlock(): Pick<AgentCardV1, "securitySchemes" | "securityRequirements"> {
  return {
    // v1.0 wraps each scheme in its oneof member name; 0.3 used a `type` field.
    securitySchemes: {
      bearer: {
        httpAuthSecurityScheme: {
          scheme: "Bearer",
          description:
            "A token issued by the agent's owner. This agent does not accept anonymous requests.",
        },
      },
    },
    securityRequirements: [{ schemes: { bearer: { list: [] } } }],
  };
}

/** The current-spec (v1.0) card. This is what /.well-known/agent-card.json serves. */
export async function agentCardV1(userId: string, origin: string): Promise<AgentCardV1> {
  const [profile, persona] = await Promise.all([
    getProfile(userId),
    getPersonaConfig(userId),
  ]);
  const name = profile.company_name || profile.owner_name || "Agent";
  const skills = await buildSkills(userId, name);

  return {
    name: `${name} — personal agent`,
    description:
      persona.tagline?.trim() ||
      `The personal agent for ${name}. Ask it anything about ${name}'s background, ` +
        `projects and published work.`,
    // Ordered: first entry is preferred (§8.3.1). Both bindings are the same
    // agent, so a caller can pick whichever it already speaks.
    supportedInterfaces: [
      { url: `${origin}${A2A_RPC_PATH}`, protocolBinding: "JSONRPC", protocolVersion: "1.0" },
      { url: `${origin}${A2A_REST_PATH}`, protocolBinding: "HTTP+JSON", protocolVersion: "1.0" },
      // The same JSON-RPC URL also answers 0.3 requests, which §3.6.2 allows to
      // be advertised as a separate interface. Most deployed clients are still
      // on 0.3, and this is what tells them they're welcome.
      { url: `${origin}${A2A_RPC_PATH}`, protocolBinding: "JSONRPC", protocolVersion: "0.3" },
    ],
    provider: { organization: name, url: origin },
    version: AGENT_VERSION,
    documentationUrl: `${origin}/agent`,
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extendedAgentCard: false,
      extensions: [],
    },
    ...securityBlock(),
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills,
    ...(persona.company_logo ? { iconUrl: absolute(origin, persona.company_logo) } : {}),
  };
}

function absolute(origin: string, path: string): string {
  return path.startsWith("http") ? path : `${origin}${path}`;
}

/**
 * The same agent described in v0.3.x vocabulary, for the many clients written
 * against that generation: `url` + `preferredTransport` instead of
 * `supportedInterfaces`, `security` instead of `securityRequirements`, and a
 * `type`-discriminated security scheme.
 */
export async function agentCardV03(userId: string, origin: string): Promise<Record<string, unknown>> {
  const v1 = await agentCardV1(userId, origin);
  const legacySecurity = {
    securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
    security: [{ bearer: [] }],
  };

  return {
    protocolVersion: "0.3.0",
    name: v1.name,
    description: v1.description,
    url: `${origin}${A2A_RPC_PATH}`,
    preferredTransport: "JSONRPC",
    additionalInterfaces: [
      { url: `${origin}${A2A_RPC_PATH}`, transport: "JSONRPC" },
      { url: `${origin}${A2A_REST_PATH}`, transport: "HTTP+JSON" },
    ],
    provider: v1.provider,
    ...(v1.iconUrl ? { iconUrl: v1.iconUrl } : {}),
    version: v1.version,
    documentationUrl: v1.documentationUrl,
    capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: false },
    ...legacySecurity,
    defaultInputModes: v1.defaultInputModes,
    defaultOutputModes: v1.defaultOutputModes,
    skills: v1.skills,
    supportsAuthenticatedExtendedCard: false,
  };
}
