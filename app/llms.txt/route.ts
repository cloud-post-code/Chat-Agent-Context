import { siteOrigin } from "@/lib/util";
import { markdownResponse, renderPlatformIndex } from "@/lib/llms";

/** The directory's llms.txt: every agent on this deployment (lib/llms.ts). */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return markdownResponse(await renderPlatformIndex(siteOrigin(req.headers)));
}
