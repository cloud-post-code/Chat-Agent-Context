import { currentUser } from "@/lib/auth";
import { startJob } from "@/lib/onboarding/jobs";
import { isPublicTarget } from "@/lib/onboarding/netGuard";

export const runtime = "nodejs";

/** Kick off one extraction run against the entered site. Returns {jobId}. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let url = "";
  try {
    const body = (await req.json()) as { url?: unknown };
    url = String(body.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    new URL(url);
  } catch {
    return new Response("Enter a valid site URL.", { status: 400 });
  }
  // The browser will click through whatever answers at this address for a
  // minute: only a host on the public internet (netGuard.ts).
  if (!(await isPublicTarget(url))) {
    return new Response("That address isn't a public website.", { status: 400 });
  }

  const job = startJob(user.id, url);
  return Response.json({ jobId: job.id });
}
