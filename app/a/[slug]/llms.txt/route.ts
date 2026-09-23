import { prisma } from "@/lib/db";
import { siteOrigin } from "@/lib/util";
import { gatherLlmsFacts, markdownResponse, renderLlmsIndex } from "@/lib/llms";

/** One tenant's llms.txt — the index an LLM reads first (lib/llms.ts). */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function GET(req: Request, { params }: Params) {
  const { slug } = await params;
  const user = await prisma.user.findUnique({ where: { slug } });
  if (!user) return new Response("No such agent.", { status: 404 });
  const facts = await gatherLlmsFacts(user);
  return markdownResponse(renderLlmsIndex(facts, siteOrigin(req.headers)));
}
