import { prisma } from "@/lib/db";
import { dropOrigin } from "@/lib/retrieval/indexer";
import { indexPersona } from "@/lib/retrieval/origins";
import {
  clearSourceClassifications,
  resolveClassifications,
} from "@/lib/itemClassification";
import type { Classification } from "@/lib/ingestionSources";

/**
 * The one uniform read path over everything the ingestion sources have
 * ingested. The tabs store into four different tables (Source, Project,
 * Photo, Profile), but every piece of ingested information is exactly one of
 * two kinds — text or image — and this module is where that rule is real:
 * `listIngestedItems(sourceKey)` returns the same item shape for every
 * source, with `kind === "image"` exactly when `imageUrl` is set.
 *
 * Custom sources (created from the admin) mark their rows with
 * `kind = "ingest:<sourceKey>"` on Source (text) and Photo (image); the
 * built-in readers exclude those marks so custom content never leaks into
 * the Links/Text/Photos tabs.
 *
 * Data only — rendering belongs to the admin pages.
 */

export type IngestedItem = {
  kind: "text" | "image";
  /** "<model>:<rowid>" — unique across the backing tables. */
  id: string;
  sourceKey: string;
  title: string;
  /** The text content, or the image's stored description. */
  text: string;
  /** Non-null exactly when kind === "image". */
  imageUrl: string | null;
  createdAt: Date;
};

/** An IngestedItem plus the classification it resolves to. */
export type ClassifiedItem = IngestedItem & {
  /** Who the item is for — its override, or the source's default. */
  classification: Classification;
  /** True when set on the item itself, false when inherited from the source. */
  classificationOverridden: boolean;
};

/** The mark custom sources put on Source.kind / Photo.kind rows they own. */
export const ingestMark = (sourceKey: string) => `ingest:${sourceKey}`;

const textItem = (
  sourceKey: string,
  id: string,
  title: string,
  text: string,
  createdAt: Date,
): IngestedItem => ({ kind: "text", id, sourceKey, title, text, imageUrl: null, createdAt });

const imageItem = (
  sourceKey: string,
  id: string,
  title: string,
  text: string,
  imageUrl: string,
  createdAt: Date,
): IngestedItem => ({ kind: "image", id, sourceKey, title, text, imageUrl, createdAt });

function parseSections(raw: string | null | undefined): Record<string, string> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function sourceRows(rows: Array<{ id: string; title: string | null; url: string | null; summary: string | null; rawText: string | null; createdAt: Date }>, sourceKey: string): IngestedItem[] {
  return rows.map((s) =>
    textItem(
      sourceKey,
      `source:${s.id}`,
      s.title || s.url || "Untitled",
      s.summary || s.rawText || "",
      s.createdAt,
    ),
  );
}

/**
 * Delete a source AND everything it ingested (rows, chunks, graph claims) —
 * the destructive path behind the edit page's Danger zone. Missing id is a
 * no-op so a double-submit can't crash. Data first, row last: if the purge
 * dies partway the tab survives to show what's left and be retried.
 *
 * Lives here, not in lib/ingestionSources.ts — that module is imported by
 * client components, and this one pulls in the retrieval stack (Node-only).
 */
export async function deleteIngestionSourceAndData(userId: string, id: string): Promise<void> {
  const row = await prisma.ingestionSource.findFirst({ where: { id, userId } });
  if (!row) return;
  await deleteIngestedData(userId, row.key);
  await prisma.ingestionSource.deleteMany({ where: { id, userId } }).catch(() => {});
}

/**
 * Delete everything a source has ingested — the destructive mirror of
 * `listIngestedItems`, keyed by the same ownership rules. Rows are deleted
 * first (the retraction the admin asked for must not be lost to an indexing
 * hiccup); chunk/graph retraction via dropOrigin is best-effort, like every
 * other admin save's indexing.
 *
 * Deliberately does NOT delete uploaded files from the upload volume —
 * `deletePhoto` keeps files too; rows and index entries are what retrieval
 * and the admin read.
 */
export async function deleteIngestedData(userId: string, sourceKey: string): Promise<void> {
  // Per-item classification overrides describe rows that are about to stop
  // existing; cleared up front so every branch's early return still leaves
  // none behind to be inherited by a later item reusing an id.
  await clearSourceClassifications(userId, sourceKey);
  const drop = async (kind: string, id: string) => {
    try {
      await dropOrigin(userId, kind, id);
    } catch (e) {
      console.error(`drop ${kind} ${id} failed:`, e);
    }
  };
  const reindex = async (label: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (e) {
      console.error(`reindex ${label} failed:`, e);
    }
  };

  switch (sourceKey) {
    case "persona": {
      await prisma.personaConfig.updateMany({
        where: { userId },
        data: { personaSections: "{}" },
      });
      // The persona sweep drops every origin the (now empty) persona no
      // longer asserts.
      await reindex("persona", () => indexPersona(userId));
      return;
    }
    case "projects": {
      const projects = await prisma.project.findMany({
        where: { userId },
        select: { id: true },
      });
      await prisma.project.deleteMany({ where: { userId } });
      for (const p of projects) await drop("project", p.id);
      return;
    }
    case "photos": {
      const photos = await prisma.photo.findMany({
        where: { userId, NOT: { kind: { startsWith: "ingest:" } } },
        select: { id: true },
      });
      await prisma.photo.deleteMany({
        where: { id: { in: photos.map((p) => p.id) } },
      });
      for (const p of photos) await drop("photo", p.id);
      return;
    }
    case "links":
    case "pdfs":
    case "text": {
      const typeFilter =
        sourceKey === "links"
          ? { type: "link" }
          : sourceKey === "text"
            ? { type: "text" }
            : { type: { in: ["pdf", "doc"] } };
      const where = { userId, ...typeFilter, NOT: { kind: { startsWith: "ingest:" } } };
      const rows = await prisma.source.findMany({ where, select: { id: true } });
      // Chunks cascade with the Source rows; dropOrigin retracts graph claims.
      await prisma.source.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
      for (const r of rows) await drop("source", r.id);
      return;
    }
    default: {
      // Custom sources own exactly the rows they marked.
      const mark = ingestMark(sourceKey);
      const [texts, photos] = await Promise.all([
        prisma.source.findMany({ where: { userId, kind: mark }, select: { id: true } }),
        prisma.photo.findMany({ where: { userId, kind: mark }, select: { id: true } }),
      ]);
      await prisma.source.deleteMany({ where: { userId, kind: mark } });
      await prisma.photo.deleteMany({ where: { userId, kind: mark } });
      for (const t of texts) await drop("source", t.id);
      for (const p of photos) await drop("photo", p.id);
      return;
    }
  }
}

/**
 * Everything a source has ingested, each item carrying the classification it
 * resolves to — its own override when one was set at ingest time, otherwise
 * the source's default.
 */
export async function listIngestedItemsClassified(
  userId: string,
  sourceKey: string,
): Promise<ClassifiedItem[]> {
  const items = await listIngestedItems(userId, sourceKey);
  const resolved = await resolveClassifications(
    userId,
    sourceKey,
    items.map((i) => i.id),
  );
  return items.map((item) => {
    const r = resolved.get(item.id);
    return {
      ...item,
      classification: r?.classification ?? "public",
      classificationOverridden: r?.overridden ?? false,
    };
  });
}

/** Everything a source has ingested, as uniform text/image items. */
export async function listIngestedItems(
  userId: string,
  sourceKey: string,
): Promise<IngestedItem[]> {
  switch (sourceKey) {
    case "projects": {
      const projects = await prisma.project.findMany({
        where: { userId },
        orderBy: { order: "asc" },
      });
      return projects.flatMap((p) => {
        const items = [
          textItem(sourceKey, `project:${p.id}`, p.name, p.blurb || p.detail || "", p.createdAt),
        ];
        if (p.imageUrl) {
          items.push(
            imageItem(sourceKey, `project-image:${p.id}`, p.name, p.blurb || "", p.imageUrl, p.createdAt),
          );
        }
        return items;
      });
    }
    case "links": {
      const rows = await prisma.source.findMany({
        where: { userId, type: "link", NOT: { kind: { startsWith: "ingest:" } } },
        orderBy: { createdAt: "desc" },
      });
      return sourceRows(rows, sourceKey);
    }
    case "pdfs": {
      const rows = await prisma.source.findMany({
        where: { userId, type: { in: ["pdf", "doc"] }, NOT: { kind: { startsWith: "ingest:" } } },
        orderBy: { createdAt: "desc" },
      });
      return sourceRows(rows, sourceKey);
    }
    case "text": {
      const rows = await prisma.source.findMany({
        where: { userId, type: "text", NOT: { kind: { startsWith: "ingest:" } } },
        orderBy: { createdAt: "desc" },
      });
      return sourceRows(rows, sourceKey);
    }
    case "photos": {
      const rows = await prisma.photo.findMany({
        where: { userId, NOT: { kind: { startsWith: "ingest:" } } },
        orderBy: { order: "asc" },
      });
      return rows.map((p) =>
        imageItem(
          sourceKey,
          `photo:${p.id}`,
          p.caption || p.filename,
          p.description || p.caption || "",
          `/api/uploads/${p.filename}`,
          p.createdAt,
        ),
      );
    }
    case "persona": {
      const persona = await prisma.personaConfig.findUnique({ where: { userId } });
      const when = persona?.updatedAt ?? new Date(0);
      return Object.entries(parseSections(persona?.personaSections))
        .filter(([, text]) => typeof text === "string" && text.trim())
        .map(([key, text]) => textItem(sourceKey, `persona:${key}`, key, text, when));
    }
    default: {
      // Custom sources own exactly the rows they marked.
      const mark = ingestMark(sourceKey);
      const [texts, photos] = await Promise.all([
        prisma.source.findMany({
          where: { userId, kind: mark },
          orderBy: { createdAt: "desc" },
        }),
        prisma.photo.findMany({
          where: { userId, kind: mark },
          orderBy: { createdAt: "desc" },
        }),
      ]);
      return [
        ...sourceRows(texts, sourceKey),
        ...photos.map((p) =>
          imageItem(
            sourceKey,
            `photo:${p.id}`,
            p.caption || p.filename,
            p.description || p.caption || "",
            `/api/uploads/${p.filename}`,
            p.createdAt,
          ),
        ),
      ];
    }
  }
}
