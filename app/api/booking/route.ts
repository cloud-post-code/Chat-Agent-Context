import { tenantBySlug } from "@/lib/tenant";
import { getBookingFlow, createBooking } from "@/lib/booking/store";
import { sanitizeSelection } from "@/lib/booking/types";

export const runtime = "nodejs";

/**
 * The booking flow's transport. `slug` names whose agent page the card was
 * on, exactly like /api/order. All real validation lives in
 * lib/booking/store.ts; this route only translates it onto HTTP.
 */

async function userFromSlug(slug: unknown) {
  const s = String(slug ?? "").trim();
  return tenantBySlug(s);
}

/** The live flow, for a card that wants to (re)fetch before drawing itself —
 *  an old stored sample with no `flow`, or one that wants a fresh quote. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const user = await userFromSlug(url.searchParams.get("slug"));
  if (!user) {
    return Response.json({ ok: false, error: "No such agent." }, { status: 404 });
  }
  const preselect = url.searchParams.get("service");
  const flowResult = await getBookingFlow(user.id, { preselectServiceId: preselect });
  return Response.json({
    ok: true,
    enabled: flowResult !== null,
    fields: flowResult?.fields ?? [],
    flow: flowResult?.flow ?? null,
  });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  const user = await userFromSlug(body.slug);
  if (!user) {
    return Response.json({ ok: false, error: "No such agent." }, { status: 404 });
  }

  const selection = sanitizeSelection(body);
  const result = await createBooking(user.id, selection);
  if (!result.ok) return Response.json(result, { status: 400 });
  return Response.json(result);
}
