import { agentCardV1, siteOrigin } from "@/lib/a2a/card";
import { authorize, clientIp, underRateLimit } from "@/lib/a2a/guard";
import { canonicalMethod, dispatch, negotiateVersion } from "@/lib/a2a/rpc";
import {
  httpError,
  jsonRpcError,
  jsonRpcResult,
  renderResult,
  sseResponse,
  unauthorized,
  versionHeaders,
  versionNotSupported,
} from "@/lib/a2a/transport";
import { A2A_ERRORS } from "@/lib/a2a/types";
import { foundingUser } from "@/lib/users";

/**
 * The A2A JSON-RPC endpoint — the address in the Agent Card, and the thing
 * that makes this site callable by another agent rather than only readable by
 * a person.
 *
 * It speaks both live generations of the protocol (see lib/a2a/rpc.ts): 1.0
 * when the caller asks for it, 0.3 otherwise, because §3.6.2 defines a missing
 * A2A-Version header as 0.3 and most deployed clients are still there.
 */

export const runtime = "nodejs";
// Answers stream from the model; the default budget cuts long ones off.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Credentials are checked at the HTTP layer, never in the JSON-RPC payload
  // (§7). A caller that fails here learns nothing about the agent's methods.
  const auth = authorize(req.headers);
  if (auth === "locked-out") {
    return httpError(429, "Too many failed authentication attempts. Try again later.");
  }
  if (auth === "unauthorized") {
    return unauthorized("This agent requires a bearer token. See /agent.");
  }
  if (!underRateLimit(clientIp(req.headers))) {
    return httpError(429, "Too many requests — this agent is rate limited.");
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonRpcError(null, A2A_ERRORS.parse, "1.0");
  }

  const id = body.id ?? null;
  const method = typeof body.method === "string" ? body.method : "";
  if (body.jsonrpc !== "2.0" || !method) {
    return jsonRpcError(id, A2A_ERRORS.invalidRequest, "1.0");
  }

  const version = negotiateVersion(req.headers, method);
  if (version === "unsupported") return versionNotSupported(id);

  // The legacy A2A surface answers as the founding user's agent.
  const founder = await foundingUser();
  if (!founder) return httpError(503, "No agent is set up yet.");

  // A 0.3 caller naming a 1.0 method (or the reverse) is answered rather than
  // rejected — the two namespaces don't collide, so the intent is unambiguous.
  if (!canonicalMethod(method)) {
    return jsonRpcError(id, { ...A2A_ERRORS.methodNotFound, data: { method } }, version);
  }

  const params = (body.params ?? {}) as Record<string, unknown>;
  const outcome = await dispatch(method, params, { version, userId: founder.id }).catch((e: unknown) => ({
    type: "error" as const,
    code: A2A_ERRORS.internal.code,
    message: e instanceof Error ? e.message : A2A_ERRORS.internal.message,
  }));

  if (outcome.type === "error") {
    return jsonRpcError(id, outcome, version);
  }

  if (outcome.type === "stream") {
    return sseResponse(outcome.events, version, (event) => ({
      jsonrpc: "2.0",
      id,
      result: event,
    }));
  }

  return jsonRpcResult(id, renderResult(outcome.value, version), version);
}

/**
 * A convenience for humans and crawlers that hit the endpoint with a browser:
 * hand back the Agent Card rather than a bare 405, so the endpoint is
 * self-describing at the address the card itself advertises.
 */
export async function GET(req: Request) {
  const founder = await foundingUser();
  if (!founder) return httpError(404, "No agent is set up yet.");
  const card = await agentCardV1(founder.id, siteOrigin(req.headers));
  return Response.json(card, { headers: versionHeaders("1.0") });
}
