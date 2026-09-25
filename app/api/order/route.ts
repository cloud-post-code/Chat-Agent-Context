import { tenantBySlug } from "@/lib/tenant";
import { createOrder } from "@/lib/orders";

export const runtime = "nodejs";

/**
 * Transport for the cart's checkout. The rules live in lib/orders.ts; this
 * file only names the tenant and passes the body through. `slug` says whose
 * menu the order is against, as every public route here does.
 */
export async function POST(req: Request) {
  let body: { slug?: string; lines?: unknown; contact?: unknown; fulfillment?: unknown; startsAt?: unknown; notes?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const user = await tenantBySlug(slug);
  if (!user) return Response.json({ ok: false, error: "No such agent." }, { status: 404 });

  const result = await createOrder(user.id, {
    lines: Array.isArray(body.lines) ? (body.lines as never[]) : [],
    contact: body.contact && typeof body.contact === "object" ? (body.contact as Record<string, string>) : {},
    fulfillment: typeof body.fulfillment === "string" ? body.fulfillment : undefined,
    startsAt: typeof body.startsAt === "string" ? body.startsAt : undefined,
    notes: typeof body.notes === "string" ? body.notes : undefined,
  });
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
