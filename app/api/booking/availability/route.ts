import { prisma } from "@/lib/db";
import { availability } from "@/lib/booking/store";

export const runtime = "nodejs";

/**
 * Open days for a month, or open slots for one day, for a (possibly partial)
 * selection — the card calls this as the visitor narrows service, provider
 * and location down to a time. Every id is re-checked server-side; an
 * unknown one draws nothing bookable rather than throwing (lib/booking/store.ts).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  const user = slug ? await prisma.user.findUnique({ where: { slug } }) : null;
  if (!user) {
    return Response.json({ ok: false, error: "No such agent." }, { status: 404 });
  }

  const addonIds = (url.searchParams.get("addonIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const result = await availability(user.id, {
    serviceId: url.searchParams.get("serviceId"),
    variantId: url.searchParams.get("variantId"),
    addonIds,
    staffId: url.searchParams.get("staffId"),
    locationId: url.searchParams.get("locationId"),
    month: url.searchParams.get("month") ?? undefined,
    date: url.searchParams.get("date") ?? undefined,
  });
  return Response.json({ ok: true, ...result });
}
