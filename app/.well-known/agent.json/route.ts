import { agentCardV03 } from "@/lib/a2a/card";
import { founderDocument } from "@/lib/a2a/wellKnown";

/** The v0.2/v0.3 Agent Card name, kept for clients that still look here. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return founderDocument(req, agentCardV03);
}
