import { prisma } from "@/lib/db";
import { quoteBooking } from "@/lib/booking/store";
import { sanitizeSelection } from "@/lib/booking/types";

export const runtime = "nodejs";

/**
 * The review screen's figures. Never trusts a client-computed price: the
 * selection is re-resolved and re-priced server-side from scratch, exactly
 * as createBooking will when the visitor confirms.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  const slug = String(body.slug ?? "").trim();
  const user = slug ? await prisma.user.findUnique({ where: { slug } }) : null;
  if (!user) {
    return Response.json({ ok: false, error: "No such agent." }, { status: 404 });
  }

  const selection = sanitizeSelection(body);
  const result = await quoteBooking(user.id, selection);
  if (!result.ok) return Response.json(result, { status: 400 });
  return Response.json(result);
}
