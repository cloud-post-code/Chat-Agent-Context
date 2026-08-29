import { draftUiCard, type BuildEvent, type CardDraft } from "@/lib/cardBuilder";
import { IMAGE_INTENTS, type PromptImage } from "@/lib/imageGen";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
// A coded card with a thinking budget can run past a minute.
export const maxDuration = 300;

/**
 * Streaming transport for the card builder. The builder itself lives in
 * lib/cardBuilder.ts; this file only checks auth and writes the builder's
 * events to the wire as one JSON object per line (same line protocol as the
 * chat route):
 *   {"t":"thinking","v":"..."}            incremental reasoning
 *   {"t":"search","query":"..."}          a knowledge search starting
 *   {"t":"searched","query":"…","hits":n} that search's result count
 *   {"t":"status","v":"..."}              a validation retry, etc.
 *   {"t":"draft","draft":{...}}           the finished card
 *   {"t":"error","v":"..."}               failure, as data
 *
 * Admin-only: the builder spends real tokens, so an unauthenticated request is
 * refused before any model call.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: {
    instructions?: string;
    current?: CardDraft;
    feedback?: string;
    attachments?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const instructions = String(body.instructions ?? "").trim();
  if (!instructions) return new Response("Describe the card you want first.", { status: 400 });

  // Attachments arrive as descriptors, not bytes — the attach endpoint already
  // stored the file. Only paths it could have produced are accepted, so a
  // crafted body cannot point the builder at an arbitrary file.
  const attachments: PromptImage[] = (Array.isArray(body.attachments) ? body.attachments : [])
    .flatMap((a) => {
      const src = String((a as { src?: unknown })?.src ?? "");
      if (!/^\/api\/uploads\/[a-f0-9-]+\.(jpg|png|webp|gif)$/i.test(src)) return [];
      const raw = String((a as { intent?: unknown })?.intent ?? "auto");
      const intent = (IMAGE_INTENTS as readonly string[]).includes(raw)
        ? (raw as PromptImage["intent"])
        : "auto";
      return [{ src, intent }];
    })
    .slice(0, 4);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (e: BuildEvent) => {
        // The admin can navigate away mid-build; writing to a closed
        // controller would throw and mask the real outcome.
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          open = false;
        }
      };
      try {
        await draftUiCard(
          user.id,
          { instructions, current: body.current, feedback: body.feedback, attachments },
          { onEvent: send },
        );
      } catch (e) {
        send({ t: "error", v: e instanceof Error ? e.message : "The builder failed — try again." });
      } finally {
        open = false;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
