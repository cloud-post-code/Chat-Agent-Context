import { currentUser } from "@/lib/auth";
import { getJob, type Job } from "@/lib/onboarding/jobs";

export const runtime = "nodejs";

function payload(job: Job) {
  const { userId: _userId, ...rest } = job;
  return rest;
}

async function respond(jobId: string | null) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const job = jobId ? getJob(jobId, user.id) : null;
  if (!job) return new Response("Unknown job", { status: 404 });
  return Response.json(payload(job));
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
