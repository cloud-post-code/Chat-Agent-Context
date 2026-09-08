import { prisma } from "@/lib/db";
import { createAppointment, getBookingConfig } from "@/lib/appointments";

export const runtime = "nodejs";

/**
 * The booking wizard's transport. `slug` names whose agent page the card was
 * on, exactly like /api/contact. All real validation — enabled, required
 * fields, future time, the slot race — lives in lib/appointments.ts; this
 * route only translates it onto HTTP.
 */

async function userFromSlug(slug: unknown) {
  const s = String(slug ?? "").trim();
  return s ? prisma.user.findUnique({ where: { slug: s } }) : null;
}

/** The live flow config, for a card that wants to re-check before submitting. */
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug");
  const user = await userFromSlug(slug);
  if (!user) {
    return Response.json({ ok: false, error: "No such agent." }, { status: 404 });
  }
  const { enabled, fields } = await getBookingConfig(user.id);
  return Response.json({ ok: true, enabled, fields });
}

export async function POST(req: Request) {
  let body: { slug?: string; startsAt?: string; answers?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  const user = await userFromSlug(body.slug);
  if (!user) {
    return Response.json({ ok: false, error: "No such agent." }, { status: 404 });
  }

  const result = await createAppointment(user.id, {
    startsAt: String(body.startsAt ?? ""),
    answers: body.answers && typeof body.answers === "object" ? body.answers : {},
  });
  if (!result.ok) {
    return Response.json(result, { status: 400 });
  }
  return Response.json({ ok: true });
}
