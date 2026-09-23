import { siteOrigin } from "@/lib/util";
import { markdownResponse, renderPlatformFull } from "@/lib/llms";

/** Every agent's full document in one fetch (lib/llms.ts). */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return markdownResponse(await renderPlatformFull(siteOrigin(req.headers)));
}
