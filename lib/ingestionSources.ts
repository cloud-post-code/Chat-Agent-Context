import { prisma } from "@/lib/db";
import { safeCardHtml } from "@/lib/uiCards";
import {
  CLASSIFICATIONS,
  ENABLED_CLASSIFICATIONS,
  UPLOAD_METHODS,
  STORAGE_KINDS,
  SPLIT_MODES,
  asClassification,
  ingestFormsFor,
  type Classification,
  type IngestionSourceRow,
  type UploadMethod,
  type StorageKinds,
  type SplitMode,
} from "./ingestionSources.shared";

/**
 * The ingestion-source catalog: one row per Content tab, holding the source's
 * code (key), how content gets in, the uniform storage rule (text/image),
 * where ingested data lands, the source's own system prompt, and the
 * classification its ingests DEFAULT to (overridable per document — see
 * lib/itemClassification.ts).
 *
 * Which ingestion sources exist is data, not code — the same principle the
 * A2UI card catalog (lib/uiCards.ts) follows. The dashboard renders the
 * Content tab strip from these rows in `order`; built-in rows dispatch to
 * their bespoke panels by key, custom rows render the generic panel.
 *
 * Data only, like lib/uiCards.ts — rendering belongs to the admin pages.
 */

export * from "./ingestionSources.shared";

export async function listIngestionSources(userId: string): Promise<IngestionSourceRow[]> {
  return prisma.ingestionSource.findMany({
    where: { userId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
}

export async function getIngestionSource(
  userId: string,
  key: string,
): Promise<IngestionSourceRow | null> {
  return prisma.ingestionSource.findUnique({
    where: { userId_key: { userId, key } },
  });
}

/** Write one row from the admin form. A blank id creates. */
export async function saveIngestionSource(userId: string, input: {
  id?: string;
  key: string;
  label: string;
  description: string;
  systemPrompt: string;
  uploadMethod: string;
  storageKinds: string;
  splitMode?: string;
  panelHtml?: string;
  classification?: string;
  outputMethod: string;
  enabled?: boolean;
  order?: number;
}): Promise<string | null> {
  const label = input.label.trim();
  if (!label) return "The ingestion source needs a name.";
  if (!(UPLOAD_METHODS as readonly string[]).includes(input.uploadMethod)) {
    return `Unknown upload method "${input.uploadMethod}". One of: ${UPLOAD_METHODS.join(", ")}.`;
  }
  if (!(STORAGE_KINDS as readonly string[]).includes(input.storageKinds)) {
    return `Unknown storage kind "${input.storageKinds}". One of: ${STORAGE_KINDS.join(", ")}.`;
  }
  const splitMode = input.splitMode ?? "split";
  if (!(SPLIT_MODES as readonly string[]).includes(splitMode)) {
    return `Unknown split mode "${splitMode}". One of: ${SPLIT_MODES.join(", ")}.`;
  }
  const panelHtml = (input.panelHtml ?? "").trim();
  if (panelHtml && !safeCardHtml(panelHtml)) {
    return (
      "Page code must be plain HTML with inline CSS — no scripts, forms, " +
      "iframes, or event handlers, and at most 40KB."
    );
  }
  const classification = input.classification ?? "public";
  if (!(ENABLED_CLASSIFICATIONS as readonly string[]).includes(classification)) {
    return `Unknown classification "${classification}". One of: ${ENABLED_CLASSIFICATIONS.join(", ")}.`;
  }

  // The key anchors deep links and panel dispatch; a hand-typed one is
  // normalized rather than rejected, and a blank one is derived from the label.
  let key =
    (input.key.trim() || label)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "source";

  // `key` is unique. An EDIT keeping its own key is a plain update; a NEW row
  // whose derived key is taken gets a suffixed key — silently overwriting the
  // owner is how an existing tab's config vanishes while its panel keeps
  // rendering.
  const owner = await prisma.ingestionSource.findUnique({
    where: { userId_key: { userId, key } },
  });
  // "new-source" belongs to the dashboard's builder sub-tab (NEW_SOURCE_TAB_KEY
  // in app/admin/contentTabs.ts) — a source keyed that would shadow it, so it
  // suffixes like any taken key.
  if (key === "new-source" || (owner && owner.id !== input.id)) {
    for (let n = 2; ; n++) {
      const candidate = `${key}-${n}`;
      if (
        !(await prisma.ingestionSource.findUnique({
          where: { userId_key: { userId, key: candidate } },
        }))
      ) {
        key = candidate;
        break;
      }
    }
  }

  const data = {
    key,
    label,
    description: input.description.trim(),
    systemPrompt: input.systemPrompt.trim(),
    uploadMethod: input.uploadMethod,
    storageKinds: input.storageKinds,
    splitMode,
    panelHtml,
    classification,
    outputMethod: input.outputMethod.trim(),
    enabled: input.enabled ?? true,
  };

  if (input.id) {
    const updated = await prisma.ingestionSource.updateMany({
      where: { id: input.id, userId },
      data: { ...data, order: input.order ?? 0 },
    });
    if (updated.count === 0) return "That ingestion source no longer exists.";
  } else {
    // New sources go to the end of the tab strip, where "just added" is
    // findable. Custom rows are never builtin: they render the generic panel.
    const last = await prisma.ingestionSource.aggregate({
      where: { userId },
      _max: { order: true },
    });
    await prisma.ingestionSource.create({
      data: {
        ...data,
        userId,
        builtin: false,
        order: input.order ?? (last._max.order ?? -1) + 1,
      },
    });
  }
  return null;
}

export async function deleteIngestionSource(userId: string, id: string) {
  await prisma.ingestionSource.deleteMany({ where: { id, userId } });
}

/** Hide (or show) a source's Content tab. Config and ingested data untouched. */
export async function setIngestionSourceHidden(
  userId: string,
  id: string,
  hidden: boolean,
): Promise<void> {
  await prisma.ingestionSource
    .updateMany({ where: { id, userId }, data: { enabled: !hidden } })
    .catch(() => {});
}

/**
 * The starter ingestion sources, in display order. These mirror what
 * onboarding extracts from a business's website (lib/onboarding/jobs.ts
 * EXTRACTORS): blog posts, testimonials, the people behind the business, and
 * the sitemap sweep's facts (services, pricing, hours, policies). Onboarding
 * fills these tabs; the admin adds to them by hand afterwards through the
 * same generic ingest panel.
 *
 * Seeded once into an empty table (seedStarterIngestionSources); after that
 * the rows are the account's to edit or reorder — the starters never
 * overwrite live rows.
 */
// Starters omit classification and splitMode so the DB defaults ("public",
// "split") stay the one source of truth for what an unnamed value means.
//
// `builtin: false` is deliberate: builtin rows dispatch to bespoke panels by
// key in app/admin/panels/index.tsx, and a builtin row with no panel is DROPPED from
// the tab strip. These four render the generic ingest panel over their own
// `ingest:<key>` rows, exactly like an admin-created source.
export const STARTER_INGESTION_SOURCES: Array<
  Omit<
    IngestionSourceRow,
    | "id"
    | "userId"
    | "enabled"
    | "builtin"
    | "classification"
    | "splitMode"
    | "panelHtml"
    | "createdAt"
    | "updatedAt"
  > & { builtin: false }
> = [
  {
    key: "blog",
    label: "Blog",
    description: "Blog and news posts from the site, each one indexed as its own piece.",
    systemPrompt:
      "Each item is one blog or news post. Keep the author's own wording; strip navigation, " +
      "related-post teasers, footers, and signup prompts. Record only what the post states — " +
      "never invent an author, a date, or content that isn't there.",
    uploadMethod: "url",
    storageKinds: "text",
    outputMethod: "Source rows + Chunk embeddings",
    builtin: false,
    order: 1,
  },
  {
    key: "testimonials",
    label: "Testimonials",
    description: "Customer testimonials — a quote plus who said it.",
    systemPrompt:
      "A testimonial is a customer's own quoted words WITH an attribution (a name, initials, " +
      "or a name and title) that literally appears in the text. Marketing copy, press " +
      "mentions, and unattributed praise do not count. Copy each quote as written; never " +
      "merge or embellish quotes or attributions.",
    uploadMethod: "generic",
    storageKinds: "text",
    outputMethod: "Source rows + Chunk embeddings",
    builtin: false,
    order: 2,
  },
  {
    key: "about-team",
    label: "About and Team",
    description: "Who the business is and the people behind it — one entry per person.",
    systemPrompt:
      "One entry per person the text actually introduces: a name plus whatever the text says " +
      "about them (role, bio, experience), plus what the business says about itself. Copy " +
      "from the text; never infer or pad a bio. Skip customers, quoted reviewers, and people " +
      "mentioned only in passing.",
    uploadMethod: "generic",
    storageKinds: "text",
    outputMethod: "Source rows + Chunk embeddings",
    builtin: false,
    order: 3,
  },
  {
    key: "services",
    label: "Services",
    description: "What the business offers: services, pricing, hours, policies, and FAQs.",
    systemPrompt:
      "Turn each page into discrete facts a customer could ask about: a service and what it " +
      "includes, a price, opening hours, an address, a policy, a guarantee, an FAQ answer. " +
      "Facts come ONLY from the text — never estimate or generalize beyond what is written. " +
      "Skip navigation labels, button text, and slogans with no information in them.",
    uploadMethod: "generic",
    storageKinds: "text",
    outputMethod: "Source rows + Chunk embeddings",
    builtin: false,
    order: 4,
  },
];

/**
 * Which starter tab each onboarding extractor fills.
 *
 * Onboarding writes plain `Source` rows; a Content tab lists exactly the rows
 * marked `ingest:<key>` (listIngestedItems in lib/ingestedItems.ts). Without
 * this mapping the four starter tabs stay empty after a full onboarding run —
 * ready for manual ingests, but never fed by the crawl that created them.
 *
 * The sweep maps to `services` on purpose: its catch-all prompt distills a
 * page into discrete customer-answerable facts — services, pricing, hours,
 * policies, FAQs — which is exactly what the `services` starter describes.
 *
 * Stated once here so the extractor-to-tab relationship is provable offline.
 */
export const ONBOARDING_SOURCE_KEYS = {
  blog: "blog",
  testimonials: "testimonials",
  team: "about-team",
  sweep: "services",
} as const;

/** The `Source.kind` mark an onboarding extractor writes. */
export function onboardingIngestKind(
  extractor: keyof typeof ONBOARDING_SOURCE_KEYS,
): string {
  return `ingest:${ONBOARDING_SOURCE_KEYS[extractor]}`;
}

/**
 * Seed the starters into an EMPTY table only. A non-empty table is Blake's
 * curation — deleting a source is deliberate, and a seed that re-inserts it
 * would resurrect the deletion. Failure degrades to "no rows yet", never a
 * crashed dashboard.
 */
export async function seedStarterIngestionSources(userId: string): Promise<void> {
  try {
    const count = await prisma.ingestionSource.count({ where: { userId } });
    if (count > 0) return;
    await prisma.ingestionSource.createMany({
      data: STARTER_INGESTION_SOURCES.map((s) => ({ ...s, userId })),
    });
  } catch {
    // Best-effort: the dashboard renders whatever list() returns.
  }
}
