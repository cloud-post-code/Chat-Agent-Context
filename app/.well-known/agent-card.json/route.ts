import { agentCardV1, siteOrigin } from "@/lib/a2a/card";
import { foundingUser } from "@/lib/users";

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
  // The legacy discovery surface describes the founding user's agent.
  const founder = await foundingUser();
  if (!founder) return new Response("No agent is set up yet.", { status: 404 });
  const card = await agentCardV1(founder.id, siteOrigin(req.headers));
  const body = JSON.stringify(card, null, 2);

  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // §8.6 SHOULD: let clients cache and revalidate the card. The content is
      // profile-derived, so the hash changes exactly when the agent does.
      "Cache-Control": "public, max-age=300, must-revalidate",
      ETag: `W/"${hash(body)}"`,
      // The card is meant to be fetched by other people's agents from other
      // origins; without this, browser-based clients can't read it.
      "Access-Control-Allow-Origin": "*",
    },
  });
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
