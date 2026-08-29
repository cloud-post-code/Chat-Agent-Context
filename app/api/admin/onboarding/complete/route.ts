import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
  return Response.json({ ok: true, mode });
}
