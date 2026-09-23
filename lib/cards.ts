import type { FieldConfig, FieldType } from "./appointmentTypes";
import { prisma } from "./db";
import { onboardingIngestKind } from "./ingestionSources";
import { safeTags } from "./knowledge";
import { SERVICES_SOURCE_TITLE, parseServiceCatalog } from "./serviceCatalog";
import { getBookingFlow } from "./booking/store";
import { formatDuration, pricingLabel, type BookingFlow } from "./booking/types";

/**
 * Shapes the data the A2UI cards render. The chat route calls these to hydrate
 * the tool blocks Claude emits (show_projects / show_project / show_gallery /
 * show_services) into concrete payloads the frontend renders as cards.
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

export type ServiceCard = {
  id: string;
  name: string;
  description: string;
  /** Present when the service comes from the live booking flow (a Service
   *  row, or a legacy-derived one) rather than the plain knowledge catalog. */
  imageUrl?: string | null;
  priceLabel?: string;
  duration?: string;
  category?: string;
};

/**
 * What a services card needs to book from: the live wizard fields, and which
 * of them the chosen service pre-answers (null when the tenant asks no such
 * question, so the wizard opens with nothing filled in). `flow` carries the
 * full booking flow (services, staff, locations, rules) when one exists, so
 * the new flow-aware card can book straight through it.
 */
export type ServiceBooking = { fields: BookingField[]; serviceKey: string | null; flow: BookingFlow | null };

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
  | { type: "contact" }
  // The tenant's services, read from the knowledge onboarding saved. `booking`
  // rides in the block when appointments are on, so each service opens the
  // wizard with itself already chosen; null draws the list with no Book button.
  | { type: "services"; items: ServiceCard[]; booking: ServiceBooking | null }
  // The booking wizard: one question per configured field, then a time, then
  // a confirm. The fields ride in the block so the card asks exactly what the
  // tenant configured at the moment it was drawn. `flow` is the full booking
  // flow (services, staff, locations, rules) for the new flow-aware card;
  // null on an old stored sample, which falls back to the intake-only wizard.
  | { type: "booking"; fields: BookingField[]; flow: BookingFlow | null };

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

export async function allProjectsBlock(userId: string): Promise<UiBlock> {
  const projects = await prisma.project.findMany({
    where: { userId },
    orderBy: { order: "asc" },
  });
  return { type: "projects", items: projects.map(toProjectCard) };
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
};

/**
 * The booking wizard, hydrated from the live config. Null when booking is
 * disabled or has no questions — the guard that keeps a stale canned answer
 * (or a model that saw the tool a moment ago) from drawing a broken booker.
 *
 * `preselect` is a service id (or legacy service id) the visitor already
 * named — show_booking's `service` input, resolved by brain.ts — carried
 * into the flow's `preselect.serviceId` so the card can skip straight past
 * the service step.
 */
export async function bookingBlock(userId: string, preselect?: string | null): Promise<UiBlock | null> {
  const { getBookingConfig } = await import("./appointments");
  const { enabled, fields } = await getBookingConfig(userId);
  if (!enabled || fields.length === 0) return null;
  const flowResult = await getBookingFlow(userId, { preselectServiceId: preselect ?? null });
  return {
    type: "booking",
    fields: fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      config: f.config,
    })),
    flow: flowResult?.flow ?? null,
  };
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

/**
 * The question a chosen service pre-answers: the picker onboarding seeds
 * (key "service"), else the generic "reason" default. Anything else would be
 * guessing which of the tenant's questions a service name belongs in.
 */
function serviceQuestionKey(fields: BookingField[]): string | null {
  return (["service", "reason"] as const).find((k) => fields.some((f) => f.key === k)) ?? null;
}

/**
 * The services card, hydrated from the live booking flow when it has any
 * services (real Service rows, or the legacy bridge's derived ones — either
 * way richer: image, price label, duration, category), else the plain
 * knowledge catalog as before. Null when neither has anything on file:
 * nothing is drawn and the model answers in words, rather than a visitor
 * being shown an empty price list.
 */
export async function servicesBlock(userId: string): Promise<UiBlock | null> {
  const [catalogItems, booking] = await Promise.all([listServices(userId), bookingBlock(userId)]);
  const flow = booking?.type === "booking" ? booking.flow : null;
  const items: ServiceCard[] = flow?.services.length
    ? flow.services.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        imageUrl: s.imageUrl,
        priceLabel: pricingLabel(s.pricing, flow.business.currency),
        duration: formatDuration(s.durationMinutes),
        category: s.category,
      }))
    : catalogItems;
  if (!items.length) return null;
  const fields = booking?.type === "booking" ? booking.fields : null;
  return {
    type: "services",
    items,
    booking: fields ? { fields, serviceKey: serviceQuestionKey(fields), flow } : null,
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

export async function galleryBlock(
  userId: string,
  layout: "carousel" | "filmstrip",
): Promise<UiBlock> {
  // Custom ingestion sources mark their photos `ingest:*`; the public
  // gallery shows only the owner's curated photo kinds.
  const photos = await prisma.photo.findMany({
    where: { userId, NOT: { kind: { startsWith: "ingest:" } } },
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
