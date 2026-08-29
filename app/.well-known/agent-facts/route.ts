import { siteOrigin } from "@/lib/a2a/card";
import { agentFacts } from "@/lib/a2a/facts";
import { foundingUser } from "@/lib/users";

/** Extension-less alias of ../agent-facts.json — see that file for why both. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const founder = await foundingUser();
  if (!founder) return new Response("No agent is set up yet.", { status: 404 });
  const facts = await agentFacts(founder.id, siteOrigin(req.headers));
  return new Response(JSON.stringify(facts, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
