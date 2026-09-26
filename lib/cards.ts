import type { ProjectCard, PhotoCard, CustomElement } from "./cards.types";
import { str } from "@/lib/util/text";
import { prisma } from "./db";
import { safeTags } from "./knowledge";
import {
  filterPhotos,
  isEmptyPhotoFilter,
  parsePhotoTags,
  tagVocabulary,
  type PhotoFilter,
  type PhotoMeta,
} from "./photoIndex";
import { filterProjects, isEmptyProjectFilter, type ProjectFilter } from "./projectIndex";
import type { SocialBlock } from "./social";

export type { SocialBlock } from "./social";

/**
 * Shapes the data the A2UI cards render. The chat route calls these to hydrate
 * the tool blocks Claude emits (show_projects / show_project / show_gallery /
 * show_contact_form / show_social) into concrete payloads the frontend
 * renders as cards.
 *
 * The composable elements (gallery/projects) take an `input` bag straight
 * from the model's tool call: an empty/no-op filter means "everything" (the
 * old whole-card behavior canned rows still rely on), a non-empty filter that
 * matches nothing means "no card" (null), and a matching filter narrows the
 * card.
 */

export type { ProjectCard, PhotoCard, CustomElement, SocialItem } from "./cards.types";

export type UiBlock =
  | { type: "projects"; title?: string; items: ProjectCard[] }
  | { type: "project"; item: ProjectCard | null }
  | { type: "gallery"; layout: "carousel" | "filmstrip"; title?: string; items: PhotoCard[] }
  // A card designed in the admin card builder. Unlike the tool-drawn blocks
  // above, the stored content IS the card — nothing is hydrated at chat time.
  | { type: "custom"; title?: string; elements: CustomElement[] }
  // A card the builder CODED: model-written HTML+inline CSS, rendered in a
  // sealed sandbox (no scripts, no external requests). `height` is the
  // iframe's px height, since a sandboxed document can't report its own.
  | { type: "html"; html: string; height?: number }
  | { type: "contact" }
  // The business's own social links, filterable to specific platforms.
  // Owned by lib/social.ts; re-exported here rather than redefined.
  | SocialBlock;

function toProjectCard(p: {
  id: string;
  name: string;
  blurb: string;
  detail: string | null;
  githubUrl: string | null;
  liveUrl: string | null;
  imageUrl: string | null;
  tags: string;
}): ProjectCard {
  return {
    id: p.id,
    name: p.name,
    blurb: p.blurb,
    detail: p.detail,
    githubUrl: p.githubUrl,
    liveUrl: p.liveUrl,
    imageUrl: p.imageUrl,
    tags: safeTags(p.tags),
  };
}

const MAX_TITLE = 80;

function sanitizeIds(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;
}

/**
 * All of the tenant's projects, or the ones a filter names (ids, tags, free
 * text). Null when a non-empty filter matches nothing — no card, the model
 * answers in words. `input.title` overrides the plain "everything" case; it
 * has no default when a filter is given, same as the gallery.
 */
export async function allProjectsBlock(
  userId: string,
  input: Record<string, unknown> = {},
): Promise<UiBlock | null> {
  const projects = await prisma.project.findMany({
    where: { userId },
    orderBy: { order: "asc" },
  });
  const cards = projects.map(toProjectCard);
  const filter: ProjectFilter = {
    ids: sanitizeIds(input.ids),
    tags: sanitizeIds(input.tags),
    query: typeof input.query === "string" ? input.query : undefined,
    limit: typeof input.limit === "number" ? input.limit : undefined,
  };
  const isEmpty = isEmptyProjectFilter(filter);
  const items = filterProjects(cards, filter);
  if (!isEmpty && items.length === 0) return null;
  const title = str(input.title, MAX_TITLE) || undefined;
  return { type: "projects", title, items };
}

export async function singleProjectBlock(userId: string, id: string): Promise<UiBlock> {
  const p = await prisma.project.findFirst({ where: { id, userId } });
  return { type: "project", item: p ? toProjectCard(p) : null };
}

/** The contact form. */
export async function contactBlock(): Promise<UiBlock> {
  return { type: "contact" };
}

/** The owner's curated photos for the public home screen's bottom strip. */
export async function homePhotos(
  userId: string,
  limit = 12,
): Promise<{ src: string; alt: string }[]> {
  // Same rule as the gallery — no `ingest:*` photos — minus the owner's
  // headshot, which is not a picture of the business.
  const photos = await prisma.photo.findMany({
    where: {
      userId,
      NOT: [{ kind: { startsWith: "ingest:" } }, { kind: "profile" }],
    },
    orderBy: { order: "asc" },
    take: limit,
  });
  return photos.map((ph) => ({
    src: `/api/uploads/${ph.filename}`,
    alt: ph.caption || ph.description || "",
  }));
}

/** "Red gel" from tags/query, for when the model didn't pass a title. */
function deriveGalleryTitle(filter: PhotoFilter): string | undefined {
  const words = [...(filter.tags ?? []), ...(filter.query ? [filter.query] : [])]
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (!words.length) return undefined;
  const joined = words.join(" ");
  return joined[0].toUpperCase() + joined.slice(1);
}

/**
 * The gallery card: every curated photo when the filter is empty (canned
 * rows and the old whole-gallery callers depend on this), or the ones a
 * filter (ids/tags/query/limit) names. Null when a non-empty filter matches
 * nothing — the caller turns that into a "no such tag" tool result instead
 * of an empty gallery. `layout` stays required; `title` is the model's own
 * when given, else derived from the filter, else unset.
 */
export async function galleryBlock(
  userId: string,
  input: { layout: "carousel" | "filmstrip" } & Record<string, unknown>,
): Promise<UiBlock | null> {
  const { layout } = input;
  // Custom ingestion sources mark their photos `ingest:*`; the public
  // gallery shows only the owner's curated photo kinds.
  const photos = await prisma.photo.findMany({
    where: { userId, NOT: { kind: { startsWith: "ingest:" } } },
    orderBy: { order: "asc" },
  });
  const metas: PhotoMeta[] = photos.map((ph) => ({
    id: ph.id,
    src: `/api/uploads/${ph.filename}`,
    caption: ph.caption ?? "",
    description: ph.description ?? "",
    tags: parsePhotoTags(ph.tags),
  }));

  const filter: PhotoFilter = {
    ids: sanitizeIds(input.ids),
    tags: sanitizeIds(input.tags),
    query: typeof input.query === "string" ? input.query : undefined,
    limit: typeof input.limit === "number" ? input.limit : undefined,
  };
  const isEmpty = isEmptyPhotoFilter(filter);
  const matched = filterPhotos(metas, filter);
  if (!isEmpty && matched.length === 0) return null;

  const title = str(input.title, MAX_TITLE) || (!isEmpty ? deriveGalleryTitle(filter) : undefined);
  return {
    type: "gallery",
    layout,
    title,
    items: matched.map((m) => ({
      id: m.id,
      src: m.src,
      description: m.description || m.caption || "",
      caption: m.caption || null,
      tags: m.tags,
    })),
  };
}

/** Tag vocabulary for a "no match" tool result, over this tenant's curated photos. */
export async function galleryTagVocabulary(userId: string): Promise<string[]> {
  const photos = await prisma.photo.findMany({
    where: { userId, NOT: { kind: { startsWith: "ingest:" } } },
    select: { tags: true },
  });
  return tagVocabulary(photos.map((ph) => ({ id: "", src: "", caption: "", description: "", tags: parsePhotoTags(ph.tags) })));
}
