import { agentCardV03, siteOrigin } from "@/lib/a2a/card";
import { foundingUser } from "@/lib/users";

/**
 * The legacy discovery path. A2A v0.2.x published the card at
 * `/.well-known/agent.json` before v0.3 renamed it to `agent-card.json`, and
 * plenty of clients — plus the NANDA AgentFacts paper — still point here.
 * Serving the 0.3-vocabulary card at the old address costs nothing and is the
 * difference between being discovered by those clients and not.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const founder = await foundingUser();
  if (!founder) return new Response("No agent is set up yet.", { status: 404 });
  const card = await agentCardV03(founder.id, siteOrigin(req.headers));
  return new Response(JSON.stringify(card, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
