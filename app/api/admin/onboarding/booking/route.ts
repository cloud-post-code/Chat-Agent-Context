import { currentUser } from "@/lib/auth";
import { readBookingReview, saveBookingReview, type BookingReviewSave } from "@/lib/onboarding/bookingReview";

export const runtime = "nodejs";

/**
 * The onboarding chat's booking review: GET the services, providers and
 * rules the extraction seeded; POST the owner's corrections. The logic lives
 * in lib/onboarding/bookingReview.ts, which writes through the same store the
 * Booking tab uses.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  return Response.json(await readBookingReview(user.id));
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  let body: BookingReviewSave;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const saved = await saveBookingReview(user.id, body);
  return Response.json({ ok: true, ...saved });
}
