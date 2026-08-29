import { prisma } from "./db";
import { safeTags } from "./knowledge";

/**
 * Shapes the data the A2UI cards render. The chat route calls these to hydrate
 * the tool blocks Claude emits (show_projects / show_project / show_gallery)
 * into concrete payloads the frontend renders as cards.
 */

export type ProjectCard = {
  id: string;
  name: string;
  blurb: string;
  detail: string | null;
  githubUrl: string | null;
  liveUrl: string | null;
  imageUrl: string | null;
  tags: string[];
};

export type PhotoCard = {
  id: string;
  src: string;
  description: string;
  caption: string | null;
};

/**
 * One element of a custom-designed card. A closed vocabulary rather than
 * markup: the card builder's model output becomes visitor-facing UI, and a
 * fixed set of typed elements is what keeps that safe and on-theme.
 */
export type CustomElement =
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "badges"; items: string[] }
  | { kind: "stats"; items: { label: string; value: string }[] }
  | { kind: "buttons"; items: { label: string; url: string }[] }
  | { kind: "image"; src: string; alt?: string }
  | { kind: "quote"; text: string; by?: string }
  | { kind: "divider" };

export type UiBlock =
  | { type: "projects"; items: ProjectCard[] }
  | { type: "project"; item: ProjectCard | null }
  | { type: "gallery"; layout: "carousel" | "filmstrip"; items: PhotoCard[] }
  // A card designed in the admin card builder. Unlike the tool-drawn blocks
  // above, the stored content IS the card — nothing is hydrated at chat time.
  | { type: "custom"; title?: string; elements: CustomElement[] }
  // A card the builder CODED: model-written HTML+inline CSS, rendered in a
  // sealed sandbox (no scripts, no external requests). `height` is the
  // iframe's px height, since a sandboxed document can't report its own.
  | { type: "html"; html: string; height?: number }
  | { type: "contact" };

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

export async function allProjectsBlock(): Promise<UiBlock> {
  const projects = await prisma.project.findMany({ orderBy: { order: "asc" } });
  return { type: "projects", items: projects.map(toProjectCard) };
}

export async function singleProjectBlock(id: string): Promise<UiBlock> {
  const p = await prisma.project.findUnique({ where: { id } });
  return { type: "project", item: p ? toProjectCard(p) : null };
}

/** The contact form. */
export async function contactBlock(): Promise<UiBlock> {
  return { type: "contact" };
}

export async function galleryBlock(
  layout: "carousel" | "filmstrip",
): Promise<UiBlock> {
  // Custom ingestion sources mark their photos `ingest:*`; the public
  // gallery shows only Blake's curated photo kinds.
  const photos = await prisma.photo.findMany({
    where: { NOT: { kind: { startsWith: "ingest:" } } },
    orderBy: { order: "asc" },
  });
  return {
    type: "gallery",
    layout,
    items: photos.map((ph) => ({
      id: ph.id,
      src: `/api/uploads/${ph.filename}`,
      description: ph.description || ph.caption || "",
      caption: ph.caption,
    })),
  };
}
