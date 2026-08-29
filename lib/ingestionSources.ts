import { prisma } from "@/lib/db";
import { safeCardHtml } from "@/lib/uiCards";

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

export const UPLOAD_METHODS = [
  "resume",
  "github",
  "url",
  "file",
  "textarea",
  "image",
  "form",
  "generic",
] as const;
export type UploadMethod = (typeof UPLOAD_METHODS)[number];

/** Every piece of ingested information is stored as text or as an image. */
export const STORAGE_KINDS = ["text", "image", "text+image"] as const;
export type StorageKinds = (typeof STORAGE_KINDS)[number];

/**
 * Whether a text ingest splits into one item per point (the default) or
 * each upload stays one item. Data, chosen when the source is built.
 */
export const SPLIT_MODES = ["split", "single"] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];

/** Who a source's content is for. Stable slugs; labels are presentation. */
export const CLASSIFICATIONS = ["public", "contact", "close-friends", "personal"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];
export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  public: "Public",
  contact: "Co-worker",
  "close-friends": "Close friend",
  personal: "Personal",
};
/**
 * All four tiers are selectable. NOTE: classification is currently RECORDED,
 * not ENFORCED — retrieval does not yet filter by it, so a "Personal" item is
 * still reachable by every visitor. The admin surfaces say so; treat this as
 * curation ahead of the visibility rules, not as access control.
 */
export const ENABLED_CLASSIFICATIONS: readonly Classification[] = CLASSIFICATIONS;

/** Normalize an arbitrary string to a known classification, or null. */
export function asClassification(v: string | null | undefined): Classification | null {
  return (CLASSIFICATIONS as readonly string[]).includes(v ?? "")
    ? (v as Classification)
    : null;
}

export type IngestionSourceRow = {
  id: string;
  key: string;
  label: string;
  description: string;
  systemPrompt: string;
  uploadMethod: string;
  storageKinds: string;
  splitMode: string;
  panelHtml: string;
  classification: string;
  outputMethod: string;
  builtin: boolean;
  enabled: boolean;
  order: number;
  /** When this source was created / last edited — every source is time-stamped. */
  createdAt: Date;
  updatedAt: Date;
};

/** Which ingest controls a source's config earns. */
export type IngestForms = {
  /** Scan-a-web-page field. */
  url: boolean;
  /** Document upload (PDF / Word / text files). */
  docFile: boolean;
  /** Paste-text form. */
  textarea: boolean;
  /** Image upload. */
  image: boolean;
};

/**
 * The one mapping from a source's uploadMethod + storageKinds to the ingest
 * controls it shows — used by the real generic panel AND the builder's test
 * pane, so the sample page always matches what the saved source will do.
 * Storage kinds gate everything: text-shaped controls (url/doc/paste) need
 * text storage, the image control needs image storage. A contradictory
 * config (e.g. image method with text-only storage) yields no controls;
 * the panel explains instead of rendering something misleading.
 */
export function ingestFormsFor(uploadMethod: string, storageKinds: string): IngestForms {
  const text = storageKinds.includes("text");
  const image = storageKinds.includes("image");
  switch (uploadMethod) {
    case "url":
    case "github":
      return { url: text, docFile: false, textarea: false, image: false };
    case "file":
    case "resume":
      return { url: false, docFile: text, textarea: false, image: false };
    case "textarea":
    case "form":
      return { url: false, docFile: false, textarea: text, image: false };
    case "image":
      return { url: false, docFile: false, textarea: false, image };
    default:
      // generic and anything unknown: everything the storage allows.
      return { url: false, docFile: false, textarea: text, image };
  }
}

export async function listIngestionSources(): Promise<IngestionSourceRow[]> {
  return prisma.ingestionSource.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
}

export async function getIngestionSource(key: string): Promise<IngestionSourceRow | null> {
  return prisma.ingestionSource.findUnique({ where: { key } });
}

/** Write one row from the admin form. A blank id creates. */
export async function saveIngestionSource(input: {
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
  const owner = await prisma.ingestionSource.findUnique({ where: { key } });
  if (owner && owner.id !== input.id) {
    for (let n = 2; ; n++) {
      const candidate = `${key}-${n}`;
      if (!(await prisma.ingestionSource.findUnique({ where: { key: candidate } }))) {
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
    await prisma.ingestionSource.update({
      where: { id: input.id },
      data: { ...data, order: input.order ?? 0 },
    });
  } else {
    // New sources go to the end of the tab strip, where "just added" is
    // findable. Custom rows are never builtin: they render the generic panel.
    const last = await prisma.ingestionSource.aggregate({ _max: { order: true } });
    await prisma.ingestionSource.create({
      data: { ...data, builtin: false, order: input.order ?? (last._max.order ?? -1) + 1 },
    });
  }
  return null;
}

export async function deleteIngestionSource(id: string) {
  await prisma.ingestionSource.delete({ where: { id } });
}

/** Hide (or show) a source's Content tab. Config and ingested data untouched. */
export async function setIngestionSourceHidden(id: string, hidden: boolean): Promise<void> {
  await prisma.ingestionSource
    .update({ where: { id }, data: { enabled: !hidden } })
    .catch(() => {});
}

/**
 * The built-in tabs, in display order. Seeded once into an empty table
 * (seedStarterIngestionSources); after that the rows are Blake's to edit or
 * reorder — the starters never overwrite live rows.
 */
// Starters omit classification and splitMode so the DB defaults ("public",
// "split") stay the one source of truth for what an unnamed value means.
export const STARTER_INGESTION_SOURCES: Array<
  Omit<
    IngestionSourceRow,
    "id" | "enabled" | "builtin" | "classification" | "splitMode" | "panelHtml" | "createdAt" | "updatedAt"
  > & { builtin: true }
> = [
  {
    key: "projects",
    label: "Projects",
    description: "Portfolio projects with blurbs, links, tags, and an optional image.",
    systemPrompt:
      "Describe each project the way Blake would in conversation: what it is, what it's " +
      "built with, and why it exists. Keep blurbs to one or two sentences; keep the detail " +
      "field factual.",
    uploadMethod: "github",
    storageKinds: "text+image",
    outputMethod: "Project rows (image file in the upload dir) + project chunks",
    builtin: true,
    order: 1,
  },
  {
    key: "links",
    label: "Links",
    description: "Web pages scraped into knowledge: articles, profiles, writeups.",
    systemPrompt:
      "Summarize the scraped page in a few sentences focused on what it says about Blake " +
      "or Blake's work. Tag the source with a handful of short topical tags.",
    uploadMethod: "url",
    storageKinds: "text",
    outputMethod: "Source rows + Chunk embeddings",
    builtin: true,
    order: 2,
  },
  {
    key: "pdfs",
    label: "PDFs",
    description: "PDF and Word documents extracted into knowledge.",
    systemPrompt:
      "Extract the document's text faithfully, then summarize what it establishes about " +
      "Blake. Keep the raw text intact for retrieval; the summary is for the admin list.",
    uploadMethod: "file",
    storageKinds: "text",
    outputMethod: "Source rows + Chunk embeddings",
    builtin: true,
    order: 3,
  },
  {
    key: "text",
    label: "Text",
    description: "Pasted notes and free text added straight into knowledge.",
    systemPrompt:
      "Treat pasted text as ground truth written by Blake. Chunk and index it as-is; " +
      "summarize it in one or two sentences for the admin list.",
    uploadMethod: "textarea",
    storageKinds: "text",
    outputMethod: "Source rows + Chunk embeddings",
    builtin: true,
    order: 4,
  },
  {
    key: "photos",
    label: "Photos",
    description: "Gallery, project, and profile photos with captions.",
    systemPrompt:
      "Describe each uploaded photo in one factual paragraph — who or what is shown, the " +
      "setting, anything identifying — so the agent can talk about it without seeing it.",
    uploadMethod: "image",
    storageKinds: "image",
    outputMethod: "Photo rows (image file in the upload dir) + photo chunks",
    builtin: true,
    order: 5,
  },
  {
    key: "persona",
    label: "Persona",
    description: "Voice, values, and self-description the agent speaks from.",
    systemPrompt:
      "Persona sections are first-person ground truth about how Blake talks and thinks. " +
      "Split saved sections into one knowledge entry per distinct claim.",
    uploadMethod: "form",
    storageKinds: "text",
    outputMethod: "Profile.personaSections (JSON) + per-claim persona chunks",
    builtin: true,
    order: 6,
  },
];

/**
 * Seed the starters into an EMPTY table only. A non-empty table is Blake's
 * curation — deleting a source is deliberate, and a seed that re-inserts it
 * would resurrect the deletion. Failure degrades to "no rows yet", never a
 * crashed dashboard.
 */
export async function seedStarterIngestionSources(): Promise<void> {
  try {
    const count = await prisma.ingestionSource.count();
    if (count > 0) return;
    await prisma.ingestionSource.createMany({
      data: STARTER_INGESTION_SOURCES.map((s) => ({ ...s })),
    });
  } catch {
    // Best-effort: the dashboard renders whatever list() returns.
  }
}
