import { agentCardV1 } from "@/lib/a2a/card";
import { founderDocument } from "@/lib/a2a/wellKnown";

/**
 * The Agent Card, at the path A2A reserves for it.
 *
 * §8.1: "A2A Servers MUST make an Agent Card available." This one URL is the
 * whole discovery story — an agent that knows only the domain finds everything
 * else from here. The suffix `agent-card.json` is IANA-registered (§14.3);
 * `/.well-known/agent.json` was the v0.2 name and is served separately for
 * clients still looking there.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // The ETag is a cache validator, not a signature: it changes exactly when the agent does.
  return founderDocument(req, agentCardV1, (body) => ({ ETag: `W/"${hash(body)}"` }));
}

/** Small non-cryptographic digest — this is a cache validator, not a signature. */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
