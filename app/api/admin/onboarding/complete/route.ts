import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { personalizeStarterQuestions } from "@/lib/starterQuestions";
import { finishOnboardingIndex } from "@/lib/onboarding/graphIndex";

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

  // Index everything onboarding just saved. The save route writes Profile,
  // hours, brand voice and photos straight to their tables without touching
  // the retrieval index, so without this the chatbot cannot answer from the
  // details the user just confirmed. Best-effort: completion must not fail
  // because indexing did, and the data is on the page either way.
  try {
    await finishOnboardingIndex(user.id);
  } catch (e) {
    console.error(`finishOnboardingIndex(${user.id}) failed:`, e);
  }

  // Rewrite the generic seeded starter questions into business-specific ones,
  // now that the profile/goals/knowledge exist to generate from. Bounded and
  // best-effort inside: a failure or timeout leaves the generic seeds and
  // never blocks completion.
  await personalizeStarterQuestions(user.id);

  return Response.json({ ok: true, mode });
}
