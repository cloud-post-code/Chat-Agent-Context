import { tenantBySlug } from "@/lib/tenant";
import { siteOrigin } from "@/lib/util";
import { gatherLlmsFacts, markdownResponse, renderLlmsFull } from "@/lib/llms";

/** One tenant's llms-full.txt — everything the agent knows, in Markdown. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function GET(req: Request, { params }: Params) {
  const { slug } = await params;
  const user = await tenantBySlug(slug);
  if (!user) return new Response("No such agent.", { status: 404 });
  const facts = await gatherLlmsFacts(user);
  return markdownResponse(renderLlmsFull(facts, siteOrigin(req.headers)));
}
