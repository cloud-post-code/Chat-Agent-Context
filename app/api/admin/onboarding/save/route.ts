import { currentUser } from "@/lib/auth";
import { saveOnboardingReview, type ReviewSave } from "@/lib/onboarding/save";

export const runtime = "nodejs";

/**
 * Persist the reviewed values into their real tables. The actual write logic
 * lives in lib/onboarding/save.ts (saveOnboardingReview), shared with the
 * bulk site builder's unattended auto-approve path.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: ReviewSave;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  await saveOnboardingReview(user.id, body);
  return Response.json({ ok: true });
}
