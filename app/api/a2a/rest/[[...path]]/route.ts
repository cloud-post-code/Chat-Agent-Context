import { authorize, clientIp, underRateLimit } from "@/lib/a2a/guard";
import { dispatch, negotiateVersion } from "@/lib/a2a/rpc";
import { foundingUser } from "@/lib/users";
import {
  httpError,
  renderResult,
  sseResponse,
  unauthorized,
  versionHeaders,
} from "@/lib/a2a/transport";
import { A2A_ERRORS } from "@/lib/a2a/types";

/**
 * The HTTP+JSON (REST) binding — the same agent as the JSON-RPC endpoint,
 * reached the way agents that don't want a JSON-RPC envelope prefer.
 *
 * §5.1 requires every binding an agent offers to be functionally equivalent,
 * which here is structural rather than a promise: this file only translates a
 * path into a method name and hands it to the same `dispatch()`. The paths are
 * the v1.0 ones from §11.3 — custom-verb suffixes like `/message:send`, and no
 * `/v1` prefix, which 1.0 removed.
 */

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path?: string[] }> };

/** Path segments → an A2A method plus the params implied by the URL. */
function route(
  segments: string[],
  method: "GET" | "POST" | "DELETE",
): { rpc: string; params: Record<string, unknown> } | null {
  const path = segments.join("/");

  if (method === "POST" && path === "message:send") return { rpc: "SendMessage", params: {} };
  if (method === "POST" && path === "message:stream") {
    return { rpc: "SendStreamingMessage", params: {} };
  }
  if (method === "GET" && path === "tasks") return { rpc: "ListTasks", params: {} };
  if (method === "GET" && path === "extendedAgentCard") {
    return { rpc: "GetExtendedAgentCard", params: {} };
  }

  if (segments[0] === "tasks" && segments[1]) {
    const [id, verb] = segments[1].split(":");
    if (method === "GET" && !verb && segments.length === 2) return { rpc: "GetTask", params: { id } };
    if (method === "POST" && verb === "cancel") return { rpc: "CancelTask", params: { id } };
    if (method === "POST" && verb === "subscribe") return { rpc: "SubscribeToTask", params: { id } };
    // Push notification configs live under the task; the dispatcher answers
    // them with PushNotificationNotSupportedError, which is the correct reply
    // for a card that declares pushNotifications: false.
    if (segments[2] === "pushNotificationConfigs") {
      const rpc =
        method === "DELETE"
          ? "DeleteTaskPushNotificationConfig"
          : method === "POST"
            ? "CreateTaskPushNotificationConfig"
            : segments[3]
              ? "GetTaskPushNotificationConfig"
              : "ListTaskPushNotificationConfigs";
      return { rpc, params: { id } };
    }
  }
  return null;
}

async function handle(req: Request, ctx: Ctx, httpMethod: "GET" | "POST" | "DELETE") {
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

  const segments = (await ctx.params).path ?? [];
  const matched = route(segments, httpMethod);
  if (!matched) return httpError(404, `No A2A method at /${segments.join("/")}`);

  const version = negotiateVersion(req.headers, matched.rpc);
  if (version === "unsupported") {
    return Response.json(
      { error: A2A_ERRORS.versionNotSupported.message, supported: ["1.0", "0.3"] },
      { status: 400 },
    );
  }

  // REST bodies are the bare protocol objects — no envelope. Query parameters
  // carry the filters for the collection reads.
  const body = httpMethod === "GET" ? {} : await req.json().catch(() => ({}));
  const query = Object.fromEntries(new URL(req.url).searchParams);
  const params = { ...matched.params, ...query, ...(body as Record<string, unknown>) };

  const founder = await foundingUser();
  if (!founder) {
    return Response.json({ error: "No agent is set up yet." }, { status: 503 });
  }

  const outcome = await dispatch(matched.rpc, params, {
    version,
    userId: founder.id,
  }).catch((e: unknown) => ({
    type: "error" as const,
    code: A2A_ERRORS.internal.code,
    message: e instanceof Error ? e.message : A2A_ERRORS.internal.message,
  }));

  if (outcome.type === "error") {
    return Response.json(
      { code: outcome.code, message: outcome.message },
      { status: httpStatusFor(outcome.code), headers: versionHeaders(version) },
    );
  }

  if (outcome.type === "stream") {
    // The REST binding streams the bare StreamResponse, without the JSON-RPC
    // envelope the other binding adds.
    return sseResponse(outcome.events, version, (event) => event);
  }

  return new Response(JSON.stringify(renderResult(outcome.value, version)), {
    headers: {
      // §11.3 (v1.0.1): the REST binding SHOULD use this media type.
      "Content-Type": "application/a2a+json; charset=utf-8",
      ...versionHeaders(version),
    },
  });
}

/** A2A error codes onto the HTTP status a REST client expects (§5.4). */
function httpStatusFor(code: number): number {
  if (code === A2A_ERRORS.taskNotFound.code) return 404;
  if (code === A2A_ERRORS.invalidParams.code) return 400;
  if (code === A2A_ERRORS.methodNotFound.code) return 404;
  if (
    code === A2A_ERRORS.unsupportedOperation.code ||
    code === A2A_ERRORS.pushNotificationNotSupported.code
  ) {
    return 501;
  }
  if (code === A2A_ERRORS.taskNotCancelable.code) return 409;
  return 500;
}

export const GET = (req: Request, ctx: Ctx) => handle(req, ctx, "GET");
export const POST = (req: Request, ctx: Ctx) => handle(req, ctx, "POST");
export const DELETE = (req: Request, ctx: Ctx) => handle(req, ctx, "DELETE");
