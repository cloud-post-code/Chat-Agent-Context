import { prisma } from "@/lib/db";
import { getIngestionSource } from "@/lib/ingestionSources";
import { ingestMark } from "@/lib/ingestedItems";
import {
  clearItemClassifications,
  setItemClassifications,
} from "@/lib/itemClassification";
import { extractText, extractLink, extractDocument } from "@/lib/scrape";
import { describeImage } from "@/lib/vision";
import { saveBytes } from "@/lib/uploads";
import { indexSource, dropOrigin } from "@/lib/retrieval/indexer";
import { indexPhoto } from "@/lib/retrieval/origins";
import path from "node:path";

/**
 * Writes for custom ingestion sources. Everything a custom source ingests is
 * stored uniformly: text becomes a Source row, images become an upload file +
 * Photo row, and both are marked `kind = "ingest:<sourceKey>"` so the source
 * owns exactly its rows and the built-in tabs never show them.
 *
 * The source's storageKinds is enforced HERE, at the write — a text-only
 * source cannot be handed an image through any path.
 *
 * Each ingest also takes an optional `classification`: the source's own
 * classification is the default, and this overrides it for the document being
 * ingested. When a document splits into many items, every item inherits the
 * one choice made for the document.
 *
 * The extractor/describer are injectable so proofs run with zero model
 * calls; indexing is best-effort like every other admin save.
 */

type TextExtract = (
  text: string,
  title: string | null,
) => Promise<{ title?: string | null; rawText?: string | null; summary?: string | null; tags?: string[] }>;

type ImageDescribe = (bytes: Buffer, ext: string) => Promise<string>;

async function allows(
  userId: string,
  sourceKey: string,
  kind: "text" | "image",
): Promise<string | null> {
  const source = await getIngestionSource(userId, sourceKey);
  if (!source) return `No ingestion source "${sourceKey}".`;
  if (!source.storageKinds.includes(kind)) {
    return `"${source.label}" stores ${source.storageKinds}, not ${kind}.`;
  }
  return null;
}

// ── The split pass ─────────────────────────────────────────────────────
// Splitting is a BEHAVIOR OF THE PIPELINE, not something a source's prompt
// has to ask for: every text ingest (document, URL, paste) is offered to the
// splitter, and the source's systemPrompt is only the LENS — it defines what
// counts as one item and which details each should carry. Caps and the
// single-row fallback are universal.

/** Most items one document may split into — a spend and noise cap. */
export const MAX_SPLIT_ITEMS = 20;

/** How much of a document the splitter reads. */
const SPLIT_INPUT_CHARS = 24_000;

export type SplitItem = { title: string; text: string };

/** Minimal client surface, injectable so proofs run zero model calls. */
export type SplitClient = {
  messages: {
    create(req: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: "user"; content: string }>;
    }): Promise<{ content: unknown[] }>;
  };
};

const DEFAULT_LENS =
  "Each item is one distinct, self-contained point from the document — a " +
  "fact, project, claim, or event that stands on its own.";

/**
 * Parse the model's reply into raw objects — tolerating a reply cut off by
 * the token budget. A dense document can overrun any budget, and throwing
 * away eighteen complete items because the nineteenth was truncated is how a
 * split "randomly" degrades to one blob. Strategy: parse the whole array if
 * it's valid JSON; otherwise walk the array with a depth counter and parse
 * each complete top-level object individually, dropping only the cut tail.
 */
function parseItemArray(raw: string): unknown[] | null {
  const start = raw.indexOf("[");
  if (start < 0) return null;
  const whole = raw.match(/\[[\s\S]*\]/)?.[0];
  if (whole) {
    try {
      const parsed = JSON.parse(whole);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through to salvage
    }
  }
  const out: unknown[] = [];
  let depth = 0;
  let objStart = -1;
  let inString = false;
  let escaped = false;
  for (let i = start + 1; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          out.push(JSON.parse(raw.slice(objStart, i + 1)));
        } catch {
          // a malformed object mid-array: skip it, keep salvaging
        }
        objStart = -1;
      }
    }
  }
  return out.length ? out : null;
}

/**
 * One model call: raw text in, discrete items out. Returns null on ANY
 * failure or on a 0–1 item result — the caller falls back to the plain
 * single-row ingest, so an outage can never lose an upload. Failures are
 * logged: a silent fallback is indistinguishable from "the doc really was
 * one point", and that ambiguity is un-debuggable in production.
 */
export async function splitIntoItems(
  rawText: string,
  lens: string,
  client?: SplitClient,
): Promise<SplitItem[] | null> {
  try {
    const { claude, claudeModel } = await import("@/lib/claude");
    // The SDK requires streaming for a full-budget (64K) request; stream and
    // collect, presenting the same create() surface the fakes implement.
    const c: SplitClient =
      client ?? {
        messages: {
          create: (req) => claude().messages.stream(req).finalMessage(),
        },
      };
    const res = await c.messages.create({
      model: claudeModel(),
      // The model's full output ceiling (Haiku 4.5: 64K) — the item cap and
      // the concise-item instruction bound real spend; the budget must never
      // be what truncates a dense document's array.
      max_tokens: 64000,
      system:
        "You split an ingested document into discrete knowledge items for a " +
        "retrieval system. Reply with ONLY a JSON array of objects " +
        `{"title": "...", "text": "..."} — at most ${MAX_SPLIT_ITEMS} items. ` +
        "Keep each item's text to 2–5 sentences. Every item must be " +
        "understandable alone (repeat names/context rather than writing " +
        "\"it\" or \"this project\"). What counts as one item:\n" +
        (lens.trim() || DEFAULT_LENS),
      messages: [{ role: "user", content: rawText.slice(0, SPLIT_INPUT_CHARS) }],
    });
    const raw = res.content
      .map((b) => {
        const block = b as { type?: string; text?: string };
        return block?.type === "text" && typeof block.text === "string" ? block.text : "";
      })
      .join("");
    const parsed = parseItemArray(raw);
    if (!parsed) {
      console.error(`split: unparseable reply (${raw.length} chars), falling back to one row`);
      return null;
    }
    const items = parsed
      .map((v) => {
        const d = v as { title?: unknown; text?: unknown };
        const title = typeof d?.title === "string" ? d.title.trim() : "";
        const text = typeof d?.text === "string" ? d.text.trim() : "";
        return title && text ? { title, text } : null;
      })
      .filter((v): v is SplitItem => v !== null)
      .slice(0, MAX_SPLIT_ITEMS);
    // One point isn't a split — the plain row already says it.
    if (items.length < 2) {
      console.error(`split: ${items.length} usable item(s), falling back to one row`);
      return null;
    }
    return items;
  } catch (e) {
    console.error("split: model call failed, falling back to one row:", e);
    return null;
  }
}

/** The provenance tag linking an item row back to its parent document. */
const docTag = (label: string) => `doc:${label}`;

/**
 * Store one row per split item, marked and tagged, each indexed
 * best-effort. Returns the created row count.
 *
 * The document's classification is applied to every item it split into: the
 * choice was made about the document, and its pieces are the same document.
 */
async function writeSplitItems(
  userId: string,
  sourceKey: string,
  parentLabel: string,
  items: SplitItem[],
  classification?: string | null,
): Promise<number> {
  const mark = ingestMark(sourceKey);
  const written: string[] = [];
  for (const item of items) {
    const row = await prisma.source.create({
      data: {
        userId,
        type: "text",
        kind: mark,
        title: item.title,
        rawText: item.text,
        summary: item.text,
        tags: JSON.stringify([docTag(parentLabel)]),
        status: "scanned",
      },
    });
    written.push(`source:${row.id}`);
    try {
      await indexSource(userId, row.id);
    } catch (e) {
      console.error(`index split item ${row.id} failed:`, e);
    }
  }
  await setItemClassifications(userId, sourceKey, written, classification);
  return items.length;
}

/**
 * Try the split for an extracted ingest. On success the parent blob row is
 * replaced by the item rows; on failure the caller keeps the plain row.
 */
async function splitAndReplace(
  userId: string,
  sourceKey: string,
  parentId: string,
  parentLabel: string,
  rawText: string | null | undefined,
  client?: SplitClient,
  classification?: string | null,
): Promise<boolean> {
  if (!rawText?.trim()) return false;
  const source = await getIngestionSource(userId, sourceKey);
  // The source said "one item per upload" — no split pass, no model call.
  if (source?.splitMode === "single") return false;
  const items = await splitIntoItems(rawText, source?.systemPrompt ?? "", client);
  if (!items) return false;
  await writeSplitItems(userId, sourceKey, parentLabel, items, classification);
  // Safe without dropOrigin: on the text/file paths the parent row is
  // deleted before it is ever indexed, so it owns no chunks or edges.
  await prisma.source.deleteMany({ where: { id: parentId, userId } }).catch(() => {});
  // The parent's own override (if the split path was reached after one was
  // recorded) dies with the row; its items carry the choice instead.
  await clearItemClassifications(userId, [`source:${parentId}`]);
  return true;
}

/** Ingest pasted text into a custom source. Returns an error string or null. */
export async function ingestCustomText(
  userId: string,
  sourceKey: string,
  input: { title: string; text: string; classification?: string | null },
  extract: TextExtract = extractText,
  splitClient?: SplitClient,
): Promise<string | null> {
  const refusal = await allows(userId, sourceKey, "text");
  if (refusal) return refusal;
  const text = input.text.trim();
  if (text.length < 2) return "Nothing to ingest.";
  const title = input.title.trim() || null;

  const src = await prisma.source.create({
    data: { userId, type: "text", kind: ingestMark(sourceKey), title, status: "pending" },
  });
  try {
    const r = await extract(text, title);
    await prisma.source.update({
      where: { id: src.id },
      data: {
        title: r.title ?? title,
        rawText: r.rawText ?? text,
        summary: r.summary ?? null,
        tags: JSON.stringify(r.tags ?? []),
        // The mark is ownership, not metadata — never let extraction move it.
        kind: ingestMark(sourceKey),
        status: "scanned",
        error: null,
      },
    });
  } catch (e) {
    await prisma.source.update({
      where: { id: src.id },
      data: { status: "failed", error: e instanceof Error ? e.message : String(e) },
    });
    return null;
  }
  if (
    await splitAndReplace(
      userId,
      sourceKey,
      src.id,
      title ?? "note",
      text,
      splitClient,
      input.classification,
    )
  ) {
    return null;
  }
  await setItemClassifications(userId, sourceKey, [`source:${src.id}`], input.classification);
  try {
    await indexSource(userId, src.id);
  } catch (e) {
    console.error(`index custom source ${src.id} failed:`, e);
  }
  return null;
}

type LinkExtract = (
  url: string,
) => Promise<{ title?: string | null; rawText?: string | null; summary?: string | null; tags?: string[] }>;

type DocExtract = (
  bytes: Buffer,
  filename: string,
) => Promise<{ title?: string | null; rawText?: string | null; summary?: string | null; tags?: string[] }>;

/**
 * Scan a web page into a custom source. Upserts by URL (Source.url is
 * unique) so re-scanning refreshes the row instead of duplicating it —
 * while the ownership mark keeps the row out of the built-in Links tab.
 */
export async function ingestCustomUrl(
  userId: string,
  sourceKey: string,
  url: string,
  extract: LinkExtract = extractLink,
  splitClient?: SplitClient,
  classification?: string | null,
): Promise<string | null> {
  const refusal = await allows(userId, sourceKey, "text");
  if (refusal) return refusal;
  const clean = url.trim();
  if (!/^https?:\/\//i.test(clean)) return "That doesn't look like a URL.";

  const mark = ingestMark(sourceKey);
  const src = await prisma.source.upsert({
    where: { userId_url: { userId, url: clean } },
    update: { status: "pending", error: null, type: "link", kind: mark },
    create: { userId, url: clean, type: "link", kind: mark, status: "pending" },
  });
  try {
    const r = await extract(clean);
    await prisma.source.update({
      where: { id: src.id },
      data: {
        title: r.title ?? null,
        rawText: r.rawText ?? null,
        summary: r.summary ?? null,
        tags: JSON.stringify(r.tags ?? []),
        kind: mark,
        status: "scanned",
        error: null,
      },
    });
  } catch (e) {
    await prisma.source.update({
      where: { id: src.id },
      data: { status: "failed", error: e instanceof Error ? e.message : String(e) },
    });
    return null;
  }
  // A re-scan REPLACES the url's items: drop the previous set only once the
  // fresh split has actually produced items, then retire the blob row.
  {
    const fresh = await prisma.source.findUnique({ where: { id: src.id } });
    const source = await getIngestionSource(userId, sourceKey);
    const items =
      source?.splitMode !== "single" && fresh?.rawText?.trim()
        ? await splitIntoItems(fresh.rawText, source?.systemPrompt ?? "", splitClient)
        : null;
    if (items) {
      // Exact tag only: the JSON-quoted form ("doc:<url>", closing quote
      // included) cannot prefix-match a sibling page's tag the way a raw
      // substring would (doc:https://x.com/page vs …/page/2).
      const exactTag = JSON.stringify(docTag(clean));
      const stale = await prisma.source.findMany({
        where: { userId, kind: mark, tags: { contains: exactTag }, NOT: { id: src.id } },
        select: { id: true },
      });
      // Deleting a Source cascades its chunks but NOT its graph-edge
      // ownership — retract each origin first (same rule as deleteSource),
      // or relations from the old scan persist as fact forever.
      for (const row of [...stale, { id: src.id }]) {
        try {
          await dropOrigin(userId, "source", row.id);
        } catch (e) {
          console.error(`dropOrigin(source ${row.id}) failed:`, e);
        }
      }
      await prisma.source.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
      // A re-scan replaces the previous items, so their overrides go with
      // them — the fresh set carries this scan's choice instead.
      await clearItemClassifications(userId, [
        ...stale.map((r) => `source:${r.id}`),
        `source:${src.id}`,
      ]);
      await writeSplitItems(userId, sourceKey, clean, items, classification);
      await prisma.source.deleteMany({ where: { id: src.id, userId } }).catch(() => {});
      return null;
    }
  }
  await setItemClassifications(userId, sourceKey, [`source:${src.id}`], classification);
  try {
    await indexSource(userId, src.id);
  } catch (e) {
    console.error(`index custom source ${src.id} failed:`, e);
  }
  return null;
}

/** Ingest an uploaded document (PDF / Word / text file) into a custom source. */
export async function ingestCustomFile(
  userId: string,
  sourceKey: string,
  bytes: Buffer,
  filename: string,
  extract: DocExtract = extractDocument,
  splitClient?: SplitClient,
  classification?: string | null,
): Promise<string | null> {
  const refusal = await allows(userId, sourceKey, "text");
  if (refusal) return refusal;
  if (bytes.length === 0) return "Empty file.";

  const src = await prisma.source.create({
    data: {
      userId,
      type: /\.docx$/i.test(filename) ? "doc" : "pdf",
      filename,
      kind: ingestMark(sourceKey),
      status: "pending",
    },
  });
  try {
    const r = await extract(bytes, filename);
    await prisma.source.update({
      where: { id: src.id },
      data: {
        title: r.title ?? filename,
        rawText: r.rawText ?? null,
        summary: r.summary ?? null,
        tags: JSON.stringify(r.tags ?? []),
        kind: ingestMark(sourceKey),
        status: "scanned",
        error: null,
      },
    });
  } catch (e) {
    await prisma.source.update({
      where: { id: src.id },
      data: { status: "failed", error: e instanceof Error ? e.message : String(e) },
    });
    return null;
  }
  {
    const fresh = await prisma.source.findUnique({ where: { id: src.id } });
    if (
      await splitAndReplace(
        userId,
        sourceKey,
        src.id,
        filename,
        fresh?.rawText,
        splitClient,
        classification,
      )
    ) {
      return null;
    }
  }
  await setItemClassifications(userId, sourceKey, [`source:${src.id}`], classification);
  try {
    await indexSource(userId, src.id);
  } catch (e) {
    console.error(`index custom source ${src.id} failed:`, e);
  }
  return null;
}

/**
 * Delete ONE ingested item from a custom source. Ownership is enforced: the
 * id must name a row marked `ingest:<sourceKey>`, so a forged or
 * cross-source id — including ids of built-in tab rows — is refused rather
 * than deleted. Chunks cascade with the row; dropOrigin retracts the
 * entities and relations extracted from it (same rule as deleteSource /
 * deletePhoto), so the agent genuinely forgets the item.
 */
export async function deleteIngestedItem(
  userId: string,
  sourceKey: string,
  itemId: string,
): Promise<string | null> {
  const mark = ingestMark(sourceKey);
  const [model, id] = itemId.split(":", 2);
  if (!id) return `Not a deletable item id: "${itemId}".`;

  if (model === "source") {
    const row = await prisma.source.findFirst({ where: { id, userId } });
    if (!row || row.kind !== mark) return "That item doesn't belong to this source.";
    await prisma.source.deleteMany({ where: { id, userId } }).catch(() => {});
    await clearItemClassifications(userId, [itemId]);
    try {
      await dropOrigin(userId, "source", id);
    } catch (e) {
      console.error(`dropOrigin(source ${id}) failed:`, e);
    }
    return null;
  }
  if (model === "photo") {
    const row = await prisma.photo.findFirst({ where: { id, userId } });
    if (!row || row.kind !== mark) return "That item doesn't belong to this source.";
    await prisma.photo.deleteMany({ where: { id, userId } }).catch(() => {});
    await clearItemClassifications(userId, [itemId]);
    try {
      await dropOrigin(userId, "photo", id);
    } catch (e) {
      console.error(`dropOrigin(photo ${id}) failed:`, e);
    }
    return null;
  }
  return `Not a deletable item id: "${itemId}".`;
}

/** Ingest an image into a custom source. Returns an error string or null. */
export async function ingestCustomImage(
  userId: string,
  sourceKey: string,
  bytes: Buffer,
  contentType: string,
  caption: string,
  describe: ImageDescribe = describeImage,
  classification?: string | null,
): Promise<string | null> {
  const refusal = await allows(userId, sourceKey, "image");
  if (refusal) return refusal;
  if (bytes.length === 0) return "Empty image.";

  const filename = await saveBytes(bytes, contentType);
  let description = "";
  try {
    description = await describe(bytes, path.extname(filename));
  } catch {
    // Best-effort, like the Photos tab: an unvisioned image still ingests.
  }
  const photo = await prisma.photo.create({
    data: {
      userId,
      filename,
      description,
      caption: caption.trim(),
      kind: ingestMark(sourceKey),
    },
  });
  await setItemClassifications(userId, sourceKey, [`photo:${photo.id}`], classification);
  try {
    await indexPhoto(userId, photo.id);
  } catch (e) {
    console.error(`index custom photo ${photo.id} failed:`, e);
  }
  return null;
}
