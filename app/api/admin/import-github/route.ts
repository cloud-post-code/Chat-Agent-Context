import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fetchGithubProjects, enrichProject } from "@/lib/github";

export const runtime = "nodejs";

/**
 * Streaming GitHub import. Same newline-delimited JSON protocol as /api/chat —
 * one object per line, so the admin panel can show each project the moment it
 * is enriched and saved instead of waiting for the whole batch:
 *   {"t":"start","total":n,"added":n,"updated":n,"skipped":n}
 *   {"t":"project","v":{...,"status":"new"|"updated"}}   enriched + saved
 *   {"t":"done"}                          all projects imported
 *   {"t":"error","v":"message"}           import stopped (bad user, rate limit)
 *
 * Re-running is safe: repos already imported are skipped unless GitHub shows a
 * push newer than the project's last sync (updatedAt) — those are re-enriched
 * and updated in place.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { profile?: string };
  const input = String(body.profile ?? "").trim();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const line = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      try {
        const repos = await fetchGithubProjects(input);

        // Split repos into: new, stale (already imported but pushed to on
        // GitHub since we last synced them), and unchanged (skipped).
        const existing = await prisma.project.findMany({
          where: { userId: user.id },
          select: { id: true, githubUrl: true, updatedAt: true },
        });
        const byUrl = new Map(
          existing.filter((p) => p.githubUrl).map((p) => [p.githubUrl as string, p]),
        );
        const fresh: typeof repos = [];
        const stale: { repo: (typeof repos)[number]; id: string }[] = [];
        for (const repo of repos) {
          const current = byUrl.get(repo.githubUrl);
          if (!current) fresh.push(repo);
          else if (repo.pushedAt && new Date(repo.pushedAt) > current.updatedAt)
            stale.push({ repo, id: current.id });
        }

        line({
          t: "start",
          total: fresh.length + stale.length,
          added: fresh.length,
          updated: stale.length,
          skipped: repos.length - fresh.length - stale.length,
        });

        const emit = (
          project: { id: string; name: string; blurb: string; detail: string | null; githubUrl: string | null; liveUrl: string | null },
          tags: string[],
          stars: number,
          status: "new" | "updated",
        ) =>
          line({
            t: "project",
            v: {
              id: project.id,
              name: project.name,
              blurb: project.blurb,
              detail: project.detail ?? "",
              tags,
              githubUrl: project.githubUrl,
              liveUrl: project.liveUrl,
              stars,
              status,
            },
          });

        // Sequential on purpose: enrich → save → emit, one project at a time,
        // so cards appear in the admin panel as each one completes.
        let order = await prisma.project.count({ where: { userId: user.id } });
        for (const repo of fresh) {
          const enriched = await enrichProject(repo);
          const project = await prisma.project.create({
            data: {
              userId: user.id,
              name: repo.name,
              blurb: enriched.blurb,
              detail: enriched.detail || null,
              tags: JSON.stringify(enriched.tags),
              githubUrl: repo.githubUrl,
              liveUrl: repo.liveUrl,
              order: order++,
            },
          });
          emit(project, enriched.tags, repo.stars, "new");
        }

        // Re-enrich stale imports in place (updatedAt bumps automatically, so
        // the next run skips them until the repo is pushed to again).
        for (const { repo, id } of stale) {
          const enriched = await enrichProject(repo);
          const project = await prisma.project.update({
            where: { id },
            data: {
              name: repo.name,
              blurb: enriched.blurb,
              detail: enriched.detail || null,
              tags: JSON.stringify(enriched.tags),
              liveUrl: repo.liveUrl,
            },
          });
          emit(project, enriched.tags, repo.stars, "updated");
        }

        revalidatePath("/admin/dashboard");
              revalidatePath("/");
        line({ t: "done" });
      } catch (err) {
        line({ t: "error", v: err instanceof Error ? err.message : "Import failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
