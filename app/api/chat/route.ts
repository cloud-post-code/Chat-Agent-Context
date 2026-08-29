import { prisma } from "@/lib/db";
import { answer, type Msg } from "@/lib/brain";

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

export async function POST(req: Request) {
  let body: { messages?: Msg[]; sessionId?: string; slug?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!slug) return new Response("Missing agent slug", { status: 400 });
  const user = await prisma.user.findUnique({ where: { slug } });
  if (!user) return new Response("No such agent", { status: 404 });

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const incoming = (body.messages ?? [])
    .filter(
      (m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
    )
    .slice(-20);

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
