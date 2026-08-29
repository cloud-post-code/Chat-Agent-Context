import { getProfile } from "@/lib/db";
import { A2A_RPC_PATH, A2A_REST_PATH, agentCardV1 } from "./card";

/**
 * The agent's "facts card", in NANDA AgentFacts format.
 *
 * Honest framing, because the ecosystem here is young: AgentFacts is a research
 * proposal out of MIT (arXiv:2507.14263, marked "Work in Progress, Request for
 * Comments") with one published JSON Schema. It is not a ratified standard and
 * nobody validates it for you. What it is good for is being a single, stable,
 * human-and-machine-readable dossier — who runs this agent, what it can do, how
 * to reach it — that a person can link to and another agent can parse.
 *
 * So it is served from this domain rather than from a third-party registry:
 * self-hosted facts can't go stale behind your back, and a registry that shuts
 * down (as list39.org already has) takes its links with it.
 *
 * The fields we cannot honestly fill are left out. There is no `evaluations`
 * block because nothing here has been independently audited, and `certification`
 * says `self-declared` for the same reason — an unaudited agent claiming an
 * auditor is the failure mode this format exists to prevent.
 */

export type AgentFacts = Record<string, unknown>;

export async function agentFacts(userId: string, origin: string): Promise<AgentFacts> {
  const profile = await getProfile(userId);
  const card = await agentCardV1(userId, origin);
  const name = profile.company_name || profile.owner_name || "Agent";
  const host = safeHost(origin);
  const handle = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";

  return {
    // Namespaced by the domain that serves this file, which is the only
    // identifier here that is actually verifiable — you can fetch it.
    id: `urn:agent:${host}:${handle}`,
    agent_name: `urn:agent:${host}:${handle}`,
    label: name,
    description: card.description,
    version: card.version,
    documentationUrl: `${origin}/agent`,
    provider: {
      name: name,
      url: origin,
      // did:web resolves back to this same domain — it asserts control of the
      // host, and nothing more than that.
      did: `did:web:${host}`,
    },
    endpoints: {
      static: [`${origin}${A2A_RPC_PATH}`, `${origin}${A2A_REST_PATH}`],
    },
    capabilities: {
      modalities: ["text"],
      streaming: true,
      batch: false,
      // The endpoint is closed; anyone reading these facts should know a
      // token is required before they try.
      authentication: { methods: ["bearer"], requiredScopes: [] },
    },
    skills: card.skills.map((skill) => ({
      id: skill.id,
      description: skill.description,
      inputModes: skill.inputModes ?? card.defaultInputModes,
      outputModes: skill.outputModes ?? card.defaultOutputModes,
      supportedLanguages: ["en"],
    })),
    telemetry: { enabled: false },
    certification: {
      level: "self-declared",
      issuer: origin,
      issuanceDate: new Date().toISOString(),
    },
    // Not part of the AgentFacts schema, but the schema doesn't forbid extra
    // keys and the pointer back to the A2A card is the useful bit: AgentFacts
    // describes the agent, the Agent Card is how you actually call it.
    a2a: {
      agentCardUrl: `${origin}/.well-known/agent-card.json`,
      protocolVersions: ["1.0", "0.3"],
    },
  };
}

function safeHost(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return "localhost";
  }
}
