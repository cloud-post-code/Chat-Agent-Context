import { currentUser } from "@/lib/auth";
import { isOperator } from "@/lib/accountAdmin";
import {
  bulkBuildPayload, getBulkBuild, listBulkBuilds, parseLinks, startBulkBuild,
} from "@/lib/bulkBuild";

export const runtime = "nodejs";

/** The signed-in operator, or null with the response to send instead. */
async function requireOperator(): Promise<
  { user: Awaited<ReturnType<typeof currentUser>> & object } | { refusal: Response }
> {
  const user = await currentUser();
  if (!user) return { refusal: new Response("Unauthorized", { status: 401 }) };
  if (!(await isOperator(user))) {
    return { refusal: new Response("Operators only", { status: 403 }) };
  }
  return { user };
}

/** Start a build over a pasted link list. */
export async function POST(req: Request) {
  const gate = await requireOperator();
  if ("refusal" in gate) return gate.refusal;

  let body: { links?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const links = String(body.links ?? "");
  const { urls, dropped } = parseLinks(links);
  if (urls.length === 0) {
    return Response.json({ error: "No valid links found.", dropped }, { status: 400 });
  }

  const build = startBulkBuild(gate.user.id, links);
  return Response.json({ buildId: build.id, build: bulkBuildPayload(build) });
}

/** A single build's status (?buildId=), or the operator's build list. */
export async function GET(req: Request) {
  const gate = await requireOperator();
  if ("refusal" in gate) return gate.refusal;

  const buildId = new URL(req.url).searchParams.get("buildId");
  if (!buildId) {
    return Response.json({ builds: listBulkBuilds(gate.user.id).map(bulkBuildPayload) });
  }
  const build = getBulkBuild(buildId, gate.user.id);
  if (!build) return new Response("Unknown build", { status: 404 });
  return Response.json(bulkBuildPayload(build));
}
