import { agentFacts } from "@/lib/a2a/facts";
import { founderDocument } from "@/lib/a2a/wellKnown";

/** Agent Facts (NANDA-style capability description) for the founding user's agent. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return founderDocument(req, agentFacts);
}
