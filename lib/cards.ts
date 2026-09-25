import type { FieldConfig, FieldRole, FieldType } from "./appointmentTypes";
import { prisma } from "./db";
import { onboardingIngestKind } from "./ingestionSources";
import { safeTags } from "./knowledge";
import { SERVICES_SOURCE_TITLE, parseServiceCatalog, priceFromText } from "./serviceCatalog";
import { getBookingFlow } from "./booking/store";
import { formatDuration, pricingLabel, type BookingFlow } from "./booking/types";
import type { CartBlock, MenuBlock } from "./menu";
import {
  filterPhotos,
  isEmptyPhotoFilter,
  parsePhotoTags,
  tagVocabulary,
  type PhotoFilter,
  type PhotoMeta,
} from "./photoIndex";
import {
  filterProjects,
  filterServices,
  isEmptyProjectFilter,
  isEmptyServiceFilter,
  priceAmountFromLabel,
  similarServices,
  type ProjectFilter,
  type ServiceFilter,
  type ServiceMeta,
} from "./serviceIndex";
import type { SocialBlock } from "./social";

export type { CartBlock, MenuBlock } from "./menu";
export type { SocialBlock } from "./social";
export { filterPhotos, isEmptyPhotoFilter, photoIndexLines, tagVocabulary } from "./photoIndex";
export type { PhotoFilter, PhotoMeta } from "./photoIndex";
export {
  filterProjects,
  filterServices,
  isEmptyProjectFilter,
  isEmptyServiceFilter,
  serviceIndexLines,
  similarServices,
} from "./serviceIndex";
export type { ProjectFilter, ServiceFilter, ServiceMeta } from "./serviceIndex";

/**
 * Shapes the data the A2UI cards render. The chat route calls these to hydrate
 * the tool blocks Claude emits (show_projects / show_project / show_gallery /
 * show_services / show_booking / show_social) into concrete payloads the
 * frontend renders as cards.
 *
 * The composable elements (gallery/services/projects/booking) all take an
 * `input` bag straight from the model's tool call: an empty/no-op filter
 * means "everything" (the old whole-card behavior canned rows still rely
 * on), a non-empty filter that matches nothing means "no card" (null), and
 * a matching filter narrows the card AND — for services — the booking flow
 * riding inside it, so a focused card's Book button never reopens the full
 * list.
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
  tags?: string[];
};

export type ServiceCard = {
  id: string;
  name: string;
  description: string;
  /** Present when the service comes from the live booking flow (a Service
   *  row) rather than the plain knowledge catalog. */
  imageUrl?: string | null;
  priceLabel?: string;
  duration?: string;
  category?: string;
};

/**
 * What a services card needs to book from: the form's fields, and the full
 * booking flow (services, staff, locations, rules) the card books through
 * with the tapped service already chosen.
 */
export type ServiceBooking = { fields: BookingField[]; flow: BookingFlow | null };

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
  // The tenant's services, read from the knowledge onboarding saved. `booking`
  // rides in the block when appointments are on, so each service opens the
  // wizard with itself already chosen; null draws the list with no Book button.
  // `focusIds` marks which items are the visitor's actual ask when the card
  // also carries "similar" neighbours, so the renderer can show those first
  // and bigger, the rest under a "Similar" label.
  | { type: "services"; title?: string; focusIds?: string[]; items: ServiceCard[]; booking: ServiceBooking | null }
  // The booking conversation: the business's own steps and questions. The
  // fields ride in the block so the card asks exactly what the tenant
  // configured at the moment it was drawn. `flow` is the full booking flow
  // (services, staff, locations, rules); null on an old stored sample, which
  // the card fetches before drawing itself.
  | { type: "booking"; fields: BookingField[]; flow: BookingFlow | null }
  // The menu — the whole thing grouped by section, or a curated list — and the
  // cart that every menu card feeds. Hydrated in lib/menu.ts; the cart's lines
  // live with the visitor, so the cart block carries only how to check out.
  | MenuBlock
  | CartBlock
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

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const MAX_TITLE = 80;

function sanitizeIds(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;
}

/**
 * All of the tenant's projects, or the ones a filter names (ids, tags, free
 * text). Null when a non-empty filter matches nothing — no card, the model
 * answers in words. `input.title` overrides the plain "everything" case; it
 * has no default when a filter is given, same as gallery/services.
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

/**
 * One wizard question as the card receives it. `config` is what makes the
 * card draw the right control: a choice question's options (a menu, when they
 * carry prices) or a number's bounds — empty for the text types.
 */
export type BookingField = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  config: FieldConfig;
  /** Which answer is the customer's name/email/phone (FIELD_ROLES). */
  role: FieldRole;
  /** Fields sharing a screen are asked together, in order. */
  screen: number;
};

/**
 * The booking block, hydrated from the live flow in one read. Null when
 * booking is disabled, or when there is nothing to ask and nothing to sell —
 * the guard that keeps a stale canned answer (or a model that saw the tool a
 * moment ago) from drawing a broken booker. The fields are every field the
 * form asks, role-tagged and screen-grouped, so the card walks the
 * business's own form; the flow carries the order.
 *
 * `preselect` is a service id the visitor already named — show_booking's
 * `service` input, resolved by brain.ts — carried into the flow's
 * `preselect.serviceId` so the card can skip straight past the service step.
 */
export async function bookingBlock(userId: string, preselect?: string | null): Promise<UiBlock | null> {
  const flowResult = await getBookingFlow(userId, { preselectServiceId: preselect ?? null });
  if (!flowResult) return null;
  const fields: BookingField[] = flowResult.fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
    config: f.config,
    role: f.role,
    screen: f.screen,
  }));
  if (fields.length === 0 && flowResult.flow.services.length === 0) return null;
  return { type: "booking", fields, flow: flowResult.flow };
}

/** The tenant's services as saved knowledge; empty when none are on file. */
export async function listServices(userId: string): Promise<ServiceCard[]> {
  // The sweep files its pages under the same `ingest:services` mark, so the
  // title is what singles out the catalog. Newest wins if a re-onboard against
  // a moved site left an older copy behind.
  const source = await prisma.source.findFirst({
    where: { userId, kind: onboardingIngestKind("services"), title: SERVICES_SOURCE_TITLE },
    orderBy: { updatedAt: "desc" },
    select: { id: true, rawText: true },
  });
  if (!source) return [];
  return parseServiceCatalog(source.rawText).map((s, i) => ({
    id: `${source.id}:${i}`,
    name: s.name,
    description: s.description,
  }));
}

/** A ServiceCard's own price, in serviceIndex's numeric form, for filtering/similarity. */
function servicePriceAmount(c: ServiceCard): number | null {
  return c.priceLabel ? priceAmountFromLabel(c.priceLabel) : null;
}

function toServiceMeta(c: ServiceCard): ServiceMeta {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    category: c.category,
    priceLabel: c.priceLabel,
    priceAmount: servicePriceAmount(c),
  };
}

/**
 * The services card, hydrated from the live booking flow when it has any
 * services (real Service rows, or the legacy bridge's derived ones — either
 * way richer: image, price label, duration, category), else the plain
 * knowledge catalog as before (its price derived with priceFromText, same as
 * serviceIndexLines, so a price still shows). Null when neither has
 * anything on file, or a non-empty filter matches nothing: nothing is drawn
 * and the model answers in words, rather than a visitor being shown an empty
 * price list.
 *
 * `input.similar` (0-4) appends the closest other services to the filtered
 * focus (see similarServices).
 */
export async function servicesBlock(
  userId: string,
  input: Record<string, unknown> = {},
): Promise<UiBlock | null> {
  const [catalogItems, booking] = await Promise.all([listServices(userId), bookingBlock(userId)]);
  const flow = booking?.type === "booking" ? booking.flow : null;
  const allItems: ServiceCard[] = flow?.services.length
    ? flow.services.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        imageUrl: s.imageUrl,
        priceLabel: pricingLabel(s.pricing, flow.business.currency),
        duration: formatDuration(s.durationMinutes),
        category: s.category,
      }))
    : catalogItems.map((c) => ({ ...c, priceLabel: priceFromText(c.description) || undefined }));
  if (!allItems.length) return null;

  const filter: ServiceFilter = {
    ids: sanitizeIds(input.ids),
    category: typeof input.category === "string" ? input.category : undefined,
    query: typeof input.query === "string" ? input.query : undefined,
    limit: typeof input.limit === "number" ? input.limit : undefined,
  };
  const isEmpty = isEmptyServiceFilter(filter);
  const meta = allItems.map(toServiceMeta);
  const focusMeta = filterServices(meta, filter);
  if (!isEmpty && focusMeta.length === 0) return null;

  const similarN = typeof input.similar === "number" ? Math.max(0, Math.min(4, Math.floor(input.similar))) : 0;
  const similarMeta = similarN > 0 && focusMeta.length ? similarServices(meta, focusMeta, similarN).items : [];

  const byId = new Map(allItems.map((c) => [c.id, c]));
  const combined = [...focusMeta, ...similarMeta];
  const items = combined.map((m) => byId.get(m.id)).filter((c): c is ServiceCard => !!c);

  const focusIds = !isEmpty ? focusMeta.map((m) => m.id) : undefined;
  const title = str(input.title, MAX_TITLE) || undefined;
  const fields = booking?.type === "booking" ? booking.fields : null;
  return {
    type: "services",
    title,
    focusIds,
    items,
    booking: fields ? { fields, flow } : null,
  };
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
