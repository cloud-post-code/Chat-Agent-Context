import { currentUser } from "@/lib/auth";
import { advanceJob, getJob, jobPayload, type Extractor } from "@/lib/onboarding/jobs";

export const runtime = "nodejs";

/**
 * Move a staged onboarding job to its next stage: "locations" after the
 * contact review, "social" after the locations review, "images" after the
 * social review, "theme" after the gallery review, or "knowledge" (with the
 * extractors the user selected) after the theme review.
 * The stage runs in the background; poll /status as before.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: { jobId?: unknown; stage?: unknown; extractors?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const job = getJob(String(body.jobId ?? ""), user.id);
  if (!job) return new Response("Unknown job", { status: 404 });

  const stage =
    body.stage === "locations" || body.stage === "social" || body.stage === "images" ||
    body.stage === "theme" || body.stage === "knowledge"
      ? body.stage
      : null;
  if (!stage) return new Response("Unknown stage", { status: 400 });
  const extractors = Array.isArray(body.extractors)
    ? (body.extractors.map(String) as Extractor[])
    : undefined;

  if (!advanceJob(job, stage, extractors)) {
    return new Response(`Job is not ready for the ${stage} stage (phase: ${job.phase}).`, {
      status: 409,
    });
  }
  return Response.json(jobPayload(job));
}
