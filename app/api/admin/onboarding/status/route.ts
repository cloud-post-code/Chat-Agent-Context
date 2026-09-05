import { currentUser } from "@/lib/auth";
import { getJob, jobPayload } from "@/lib/onboarding/jobs";

export const runtime = "nodejs";

async function respond(jobId: string | null) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const job = jobId ? getJob(jobId, user.id) : null;
  if (!job) return new Response("Unknown job", { status: 404 });
  // jobPayload strips the internal crawl state (live browser, cheerio pages)
  // — serializing those sent megabytes of HTML on every poll and could throw.
  return Response.json(jobPayload(job));
}

export async function GET(req: Request) {
  return respond(new URL(req.url).searchParams.get("jobId"));
}

export async function POST(req: Request) {
  let jobId: string | null = null;
  try {
    jobId = String(((await req.json()) as { jobId?: unknown }).jobId ?? "") || null;
  } catch {
    jobId = null;
  }
  return respond(jobId);
}
