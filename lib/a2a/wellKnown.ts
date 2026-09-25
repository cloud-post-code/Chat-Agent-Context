import { siteOrigin } from "@/lib/util";
import { foundingUser } from "@/lib/users";

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  // §8.6 SHOULD: let clients cache and revalidate; the content is profile-derived.
  "Cache-Control": "public, max-age=300, must-revalidate",
  // Fetched by other people's agents from other origins.
  "Access-Control-Allow-Origin": "*",
};

/**
 * The shape every /.well-known/* discovery document shares: the founding
 * user's agent (the legacy single-tenant discovery surface), serialized with
 * the caching and CORS headers A2A expects, or 404 while no agent exists.
 */
export async function founderDocument(
  req: Request,
  build: (userId: string, origin: string) => Promise<unknown>,
  extraHeaders: (body: string) => Record<string, string> = () => ({}),
): Promise<Response> {
  const founder = await foundingUser();
  if (!founder) return new Response("No agent is set up yet.", { status: 404 });
  const body = JSON.stringify(await build(founder.id, siteOrigin(req.headers)), null, 2);
  return new Response(body, { headers: { ...HEADERS, ...extraHeaders(body) } });
}
