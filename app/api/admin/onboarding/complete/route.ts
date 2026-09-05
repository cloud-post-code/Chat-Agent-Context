import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { personalizeStarterQuestions } from "@/lib/starterQuestions";

export const runtime = "nodejs";

/**
 * Mark onboarding finished — reached from both paths: after saving the
 * extraction review, or straight from "Set up manually" once the (possibly
 * empty) forms are submitted. From here on the admin panel never routes this
 * user into the flow again.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let mode = "manual";
  try {
    mode = String(((await req.json()) as { mode?: unknown }).mode ?? "manual");
  } catch {
    /* body optional */
  }
  if (mode !== "site" && mode !== "manual") mode = "manual";

  await prisma.user.update({
    where: { id: user.id },
    data: { onboardedAt: new Date() },
  });

  // Rewrite the generic seeded starter questions into business-specific ones,
  // now that the profile/goals/knowledge exist to generate from. Bounded and
  // best-effort inside: a failure or timeout leaves the generic seeds and
  // never blocks completion.
  await personalizeStarterQuestions(user.id);

  return Response.json({ ok: true, mode });
}
