import { NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { isOperator } from "@/lib/accountAdmin";
import { adminAnswer } from "@/lib/adminBrain";
import type { Msg } from "@/lib/brain";

export const runtime = "nodejs";

/**
 * Transport for the admin copilot, mirroring /api/chat: the logic lives in
 * lib/adminBrain.ts; this route only authenticates and writes NDJSON lines.
 */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    message?: string;
    history?: Msg[];
  };
  const message = String(body.message ?? "").trim();
  if (!message) return new Response("Bad request", { status: 400 });
  const history = Array.isArray(body.history) ? body.history.slice(-20) : [];
  const operator = await isOperator(user);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of adminAnswer({ userId: user.id, message, history, operator })) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
