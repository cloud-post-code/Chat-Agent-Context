/**
 * The ingestion-source vocabulary and the pure mappings over it — no
 * database. Client components (SourceBuilder, AdminChat) import from here;
 * lib/ingestionSources.ts re-exports everything for the server side.
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
  /** Owning account. Every source belongs to exactly one. */
  userId: string;
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
