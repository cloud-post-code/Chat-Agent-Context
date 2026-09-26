import { tenantBySlug } from "@/lib/tenant";
import { answer, type Msg, type ShownCard } from "@/lib/brain";

export const runtime = "nodejs";

/**
 * Transport for the chatbot. The chatbot itself lives in lib/brain.ts; this
 * file only parses the request and writes the brain's events to the wire as a
 * tiny line protocol, one JSON object per line:
 *   {"t":"text","v":"..."}      incremental assistant text
 *   {"t":"card","v":{...}}      a hydrated UI block to render
 * The frontend splits on newlines and interprets each.
 *
 * `slug` names whose agent is being asked — every tenant's public page chats
 * through this one route, and the brain answers only from that tenant's data.
 */

const MAX_CARDS_PER_MESSAGE = 4;
const MAX_IDS_PER_CARD = 12;
const MAX_TYPE_CHARS = 20;
const MAX_ID_CHARS = 64;
const MAX_TITLE_CHARS = 80;

/** A trusted string array: strings only, each cut to `max`, capped at `cap` entries. */
function sanitizeStrings(v: unknown, max: number, cap: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string").map((s) => s.slice(0, max)).slice(0, cap);
  return out.length ? out : undefined;
}

/**
 * `Msg.shown` as the client reports it, cut down to the wire shape brain.ts
 * trusts: capped card count, capped ids per card, capped string lengths. A
 * visitor's own client is the only source of this field, but it still folds
 * into the model's history, so nothing past these caps reaches it.
 */
function sanitizeShown(raw: unknown): ShownCard[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ShownCard[] = [];
  for (const item of raw.slice(0, MAX_CARDS_PER_MESSAGE)) {
    if (!item || typeof item !== "object") continue;
    const r = item as { type?: unknown; ids?: unknown; tags?: unknown; title?: unknown };
    if (typeof r.type !== "string" || !r.type.trim()) continue;
    out.push({
      type: r.type.slice(0, MAX_TYPE_CHARS),
      ids: sanitizeStrings(r.ids, MAX_ID_CHARS, MAX_IDS_PER_CARD),
      tags: sanitizeStrings(r.tags, MAX_ID_CHARS, MAX_IDS_PER_CARD),
      title: typeof r.title === "string" ? r.title.slice(0, MAX_TITLE_CHARS) : undefined,
    });
  }
  return out.length ? out : undefined;
}

export async function POST(req: Request) {
  let body: { messages?: Msg[]; sessionId?: string; slug?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!slug) return new Response("Missing agent slug", { status: 400 });
  const user = await tenantBySlug(slug);
  if (!user) return new Response("No such agent", { status: 404 });

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const incoming = (body.messages ?? [])
    .filter(
      (m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
    )
    .slice(-20)
    .map((m) => ({ ...m, shown: sanitizeShown(m.shown) }));

  const lastUser = [...incoming].reverse().find((m) => m.role === "user");
  if (!lastUser) return new Response("No messages", { status: 400 });

  // Everything before the visitor's latest question is context for the brain.
  const history = incoming.slice(0, incoming.lastIndexOf(lastUser));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for await (const event of answer({
        userId: user.id,
        message: lastUser.content,
        history,
        sessionId,
        channel: "web",
      })) {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
