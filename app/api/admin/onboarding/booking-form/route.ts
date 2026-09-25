import { currentUser } from "@/lib/auth";
import type { Msg } from "@/lib/brain";
import { bookingFormSummary, editBookingForm, enableBookingForm } from "@/lib/onboarding/bookingFormChat";

export const runtime = "nodejs";

/**
 * The onboarding chat's booking-form step. GET reads the form as it stands —
 * the live flow the card draws, the intake questions, and the step list —
 * so the step can show it and let the owner try it. POST with a `message`
 * runs one round of the form chat (lib/onboarding/bookingFormChat.ts): the
 * change is made for real and the re-read form comes back with the reply.
 * POST with `action: "enable"` turns booking on for a tenant who had it off.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  return Response.json({ ok: true, form: await bookingFormSummary(user.id) });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: { action?: unknown; message?: unknown; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  if (body.action === "enable") {
    return Response.json({ ok: true, form: await enableBookingForm(user.id) });
  }

  const message = String(body.message ?? "").trim().slice(0, 2000);
  if (!message) return new Response("Say what to change.", { status: 400 });
  const history: Msg[] = (Array.isArray(body.history) ? body.history : [])
    .map((m) => {
      const r = (m ?? {}) as Record<string, unknown>;
      const role = r.role === "assistant" ? "assistant" : "user";
      return { role, content: String(r.content ?? "").slice(0, 4000) } as Msg;
    })
    .filter((m) => m.content)
    .slice(-12);

  const result = await editBookingForm({ userId: user.id, message, history });
  return Response.json({ ok: true, ...result });
}
