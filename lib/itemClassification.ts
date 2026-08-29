import { prisma } from "@/lib/db";
import {
  asClassification,
  getIngestionSource,
  type Classification,
} from "@/lib/ingestionSources";

/**
 * Per-item classification: which contacts a single ingested document is for.
 *
 * The rule is default-plus-override. An ingestion source's `classification`
 * is the DEFAULT for everything ingested through it; an ItemClassification row
 * overrides that default for one item. No row means "inherit" — the default is
 * never copied down, so re-classifying a source moves every item that wasn't
 * deliberately overridden, which is the behavior that makes a default useful.
 *
 * Items are keyed by the composite "<model>:<rowid>" id that
 * lib/ingestedItems.ts already assigns them, so this works uniformly across
 * all four backing tables — including the Profile-JSON-backed Experience and
 * Persona items, which have no row of their own to carry a column.
 *
 * NOT access control. Classification is recorded here but retrieval does not
 * yet filter on it, so a "personal" item is still reachable by every visitor.
 *
 * Data only — rendering belongs to the admin pages.
 */

/** The classification an item ends up with, and whether it was overridden. */
export type ResolvedClassification = {
  classification: Classification;
  /** True when an explicit per-item override set it, false when inherited. */
  overridden: boolean;
};

/** A source's default, falling back to "public" for an unknown/missing row. */
export async function sourceDefaultClassification(
  userId: string,
  sourceKey: string,
): Promise<Classification> {
  const source = await getIngestionSource(userId, sourceKey);
  return asClassification(source?.classification) ?? "public";
}

/**
 * Resolve classifications for a batch of items in one pass — two queries
 * regardless of item count, so a long Content list doesn't fan out.
 */
export async function resolveClassifications(
  userId: string,
  sourceKey: string,
  itemIds: string[],
): Promise<Map<string, ResolvedClassification>> {
  const fallback = await sourceDefaultClassification(userId, sourceKey);
  const out = new Map<string, ResolvedClassification>(
    itemIds.map((id) => [id, { classification: fallback, overridden: false }]),
  );
  if (itemIds.length === 0) return out;

  const rows = await prisma.itemClassification
    .findMany({ where: { userId, itemId: { in: itemIds } } })
    .catch(() => []);
  for (const row of rows) {
    const value = asClassification(row.classification);
    // An override row holding a value no longer in the catalog is treated as
    // absent rather than trusted: inheriting a real default beats surfacing a
    // classification the UI can't name.
    if (value) out.set(row.itemId, { classification: value, overridden: true });
  }
  return out;
}

/** Resolve one item's classification. */
export async function resolveClassification(
  userId: string,
  sourceKey: string,
  itemId: string,
): Promise<ResolvedClassification> {
  const map = await resolveClassifications(userId, sourceKey, [itemId]);
  return map.get(itemId) ?? { classification: "public", overridden: false };
}

/**
 * Record an override for one item. Passing the source's own default, or a
 * value that isn't a known classification, CLEARS the override instead of
 * storing it — an item explicitly set back to the source default should
 * resume following that default when it later changes.
 */
export async function setItemClassification(
  userId: string,
  sourceKey: string,
  itemId: string,
  classification: string | null | undefined,
): Promise<void> {
  if (!itemId) return;
  const value = asClassification(classification);
  const fallback = await sourceDefaultClassification(userId, sourceKey);
  if (!value || value === fallback) {
    await clearItemClassifications(userId, [itemId]);
    return;
  }
  await prisma.itemClassification
    .upsert({
      where: { userId_itemId: { userId, itemId } },
      update: { sourceKey, classification: value },
      create: { userId, itemId, sourceKey, classification: value },
    })
    .catch((e) => {
      console.error(`setItemClassification(${itemId}) failed:`, e);
    });
}

/**
 * Apply one classification to several items at once — the ingest path, where
 * a single upload can split into many item rows that all inherit the choice
 * made for the document.
 */
export async function setItemClassifications(
  userId: string,
  sourceKey: string,
  itemIds: string[],
  classification: string | null | undefined,
): Promise<void> {
  for (const id of itemIds) {
    await setItemClassification(userId, sourceKey, id, classification);
  }
}

/** Drop override rows for deleted items, so ids can't be reused stale. */
export async function clearItemClassifications(
  userId: string,
  itemIds: string[],
): Promise<void> {
  if (itemIds.length === 0) return;
  await prisma.itemClassification
    .deleteMany({ where: { userId, itemId: { in: itemIds } } })
    .catch(() => {});
}

/** Drop every override a source owns — used when its data is purged. */
export async function clearSourceClassifications(
  userId: string,
  sourceKey: string,
): Promise<void> {
  await prisma.itemClassification
    .deleteMany({ where: { userId, sourceKey } })
    .catch(() => {});
}
