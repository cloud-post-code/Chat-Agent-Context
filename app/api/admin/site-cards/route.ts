import { currentUser } from "@/lib/auth";
import { buildCardsFromSite, type SiteCardsEvent, type SiteCardsReport } from "@/lib/siteCards";

export const runtime = "nodejs";
// Up to three designed cards drafted by the builder, each a minute or two.
export const maxDuration = 300;

type WireEvent =
  | SiteCardsEvent
  | { t: "done"; report: SiteCardsReport }
  | { t: "error"; v: string };

/**
 * Streaming transport for the site-cards agent (lib/siteCards.ts) — the A2UI
 * tab's "Build cards from my site" button. One JSON object per line, the
 * build-card route's protocol:
 *   {"t":"status","v":"..."}                          progress, in words
 *   {"t":"need","need":"…","evidence":"…","label":"…"} a need the agent found
 *   {"t":"card","key":"…","label":"…","tool":"…"}      a card written
 *   {"t":"done","report":{...}}                        the run's outcome
 *   {"t":"error","v":"..."}                            failure, as data
 *
 * Admin-only: the run spends real tokens, so an unauthenticated request is
 * refused before any model call.
 */
export async function POST() {
  let user: Awaited<ReturnType<typeof currentUser>> = null;
  try {
    user = await currentUser();
  } catch {
    // No readable session is no session.
  }
  if (!user) return new Response("Unauthorized", { status: 401 });
  const userId = user.id;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (e: WireEvent) => {
        // The admin can navigate away mid-run; the cards still get built.
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          open = false;
        }
      };
      try {
        const report = await buildCardsFromSite(userId, send);
        send(
          report.failed
            ? { t: "error", v: "Couldn't read your site into cards just now — try again." }
            : { t: "done", report },
        );
      } catch (e) {
        send({ t: "error", v: e instanceof Error ? e.message : "The run failed — try again." });
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
