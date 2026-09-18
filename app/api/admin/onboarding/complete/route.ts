import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { personalizeStarterQuestions } from "@/lib/starterQuestions";
import { finishOnboardingIndex } from "@/lib/onboarding/graphIndex";
import { generateOnboardingCards } from "@/lib/onboarding/cards";

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

  // Index everything onboarding just saved, then rewrite the generic seeded
  // starter questions into business-specific ones.
  //
  // The "site" path does NOT do this here. That path calls /complete the
  // instant the knowledge stage is kicked off — the extraction is still
  // crawling, so there would be no sources, no graph and no goals to read,
  // and the questions would fall back to the generic seeds. runKnowledge
  // (lib/onboarding/jobs.ts) runs both steps itself once extraction really
  // finishes. Here we cover only the paths where extraction never runs at
  // all: "Set up manually", and "Skip this" on the extraction step.
  //
  // Fire-and-forget: indexing paces itself at ~21s per origin (EMBED_PACE_MS),
  // which is far longer than this request may block. Awaiting it timed the
  // request out, so starter questions never ran. Best-effort either way — the
  // data is saved and on the page regardless.
  if (mode === "manual") {
    void (async () => {
      try {
        await finishOnboardingIndex(user.id);
      } catch (e) {
        console.error(`finishOnboardingIndex(${user.id}) failed:`, e);
      }
      await personalizeStarterQuestions(user.id);
      // Then the cards the agent can show, planned from the profile and
      // whatever knowledge exists — there is no site to read on this path.
      // Never throws by contract; logged inside on failure.
      await generateOnboardingCards([], user.id, { categories: [] }, () => {});
    })();
  }

  return Response.json({ ok: true, mode });
}
