import { str } from "@/lib/util/text";
import { prisma } from "@/lib/db";
import { savePersonaBrand } from "@/lib/brand";
import { saveSocialLinks, sanitizeSocialLinks } from "@/lib/socialLinks";
import { DAYS, serializeHours, type Hours } from "@/lib/onboarding/hours";

/**
 * Persist reviewed onboarding values into their real tables, with no request
 * object involved — the review route (app/api/admin/onboarding/save/route.ts)
 * and the bulk builder (lib/bulkBuild.ts) both call this. Values are written
 * as given: the chat flow saves in stages, so every field is optional, and
 * whatever is present wins over what was there. Theme values are clamped to
 * supported presets.
 */

export type ReviewSave = {
  profile?: Record<string, unknown>;
  locations?: Record<string, unknown>;
  social?: Record<string, unknown>;
  gallery?: Record<string, unknown>;
  theme?: Record<string, unknown>;
  brand?: Record<string, unknown>;
};

const RADII = new Set(["sharp", "rounded", "pill"]);
const WEIGHTS = new Set(["", "500", "600", "700", "800"]);
const HEXISH = /^#[0-9a-fA-F]{3,8}$/;

const toHours = (v: unknown): string =>
  typeof v === "string"
    ? v.trim()
    : v && typeof v === "object"
      ? serializeHours(Object.fromEntries(
          DAYS.map((d) => [d, str((v as Record<string, unknown>)[d])])) as Hours)
      : "";

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function saveProfile(userId: string, p: Record<string, unknown>): Promise<void> {
  const profile = {
    company_name: str(p.company_name),
    owner_name: str(p.owner_name),
    company_phone_number: str(p.company_phone_number),
    company_email: str(p.company_email),
  };
  await prisma.profile.upsert({
    where: { userId },
    update: profile,
    create: { userId, ...profile },
  });
}

/**
 * The structured entries are stored AS TEXT in the existing Profile fields —
 * one line per location — so the import / prompt side reads them like any
 * other profile text.
 */
async function saveLocations(userId: string, L: Record<string, unknown>): Promise<void> {
  const locations = (Array.isArray(L.locations) ? L.locations : [])
    .map((l: unknown) => {
      const loc = (l ?? {}) as Record<string, unknown>;
      return { address: str(loc.address), phone: str(loc.phone), hours: toHours(loc.hours) };
    })
    .filter((l: { address: string; hours: string }) => l.address || l.hours);
  const noInPerson = L.no_in_person === true;

  let company_address: string;
  let company_hours: string;
  if (noInPerson || locations.length === 0) {
    company_address = noInPerson ? "Online only — no in-person location" : "";
    company_hours = "";
  } else if (locations.length === 1) {
    company_address = locations[0].address;
    company_hours = locations[0].hours;
  } else {
    company_address = locations
      .map((l: { address: string; phone: string }, i: number) =>
        `Location ${i + 1}: ${l.address}${l.phone ? ` (${l.phone})` : ""}`)
      .join("\n");
    company_hours = locations
      .map((l: { hours: string }, i: number) =>
        `Location ${i + 1} — ${l.hours || "hours not listed"}`)
      .join("\n");
  }
  await prisma.profile.upsert({
    where: { userId },
    update: { company_address, company_hours },
    create: { userId, company_address, company_hours },
  });
}

/**
 * The extraction stage already stored each photo in the upload store, so
 * saving is row creation over reviewed captions. Only app-upload paths are
 * accepted. Replace semantics keep a restart from stacking duplicates.
 */
const strTags = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of v) {
    const tag = str(t).toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
};

async function saveGallery(userId: string, gallery: Record<string, unknown>): Promise<void> {
  const images = (Array.isArray(gallery.images) ? gallery.images : [])
    .map((i: unknown) => {
      const img = (i ?? {}) as Record<string, unknown>;
      return { src: str(img.src), caption: str(img.caption), tags: strTags(img.tags) };
    })
    .filter((i) => /^\/api\/uploads\//.test(i.src))
    .slice(0, 25);
  await prisma.photo.deleteMany({ where: { userId, kind: "gallery" } });
  await prisma.photo.createMany({
    data: images.map((img, order) => ({
      userId,
      filename: img.src.replace(/^\/api\/uploads\//, ""),
      caption: img.caption || null,
      description: img.caption,
      tags: JSON.stringify(img.tags),
      kind: "gallery",
      order,
    })),
  });
}

async function saveTheme(userId: string, t: Record<string, unknown>): Promise<void> {
  const colorsIn = (typeof t.themeColors === "string"
    ? safeParse(t.themeColors)
    : t.themeColors) as Record<string, unknown> | null;
  const colors: Record<string, string> = {};
  for (const [k, v] of Object.entries(colorsIn ?? {})) {
    if (HEXISH.test(String(v))) colors[k] = String(v);
  }
  const theme = {
    themeFont: str(t.themeFont) || "space-grotesk",
    themeBodyFont: str(t.themeBodyFont) || "inter",
    themeColors: JSON.stringify(colors),
    themeRadius: RADII.has(str(t.themeRadius)) ? str(t.themeRadius) : "rounded",
    themeFontSize: /^\d{2}$/.test(str(t.themeFontSize)) ? str(t.themeFontSize) : "",
    themeHeadingWeight: WEIGHTS.has(str(t.themeHeadingWeight)) ? str(t.themeHeadingWeight) : "",
  };
  await prisma.themeConfig.upsert({
    where: { userId },
    update: theme,
    create: { userId, ...theme },
  });

  const logo = str(t.themeLogo);
  if (/^\/api\/uploads\//.test(logo)) {
    await prisma.personaConfig.upsert({
      where: { userId },
      update: { company_logo: logo },
      create: { userId, company_logo: logo },
    });
  }
}

export async function saveOnboardingReview(userId: string, body: ReviewSave): Promise<void> {
  if (body.profile) await saveProfile(userId, body.profile);
  if (body.locations) await saveLocations(userId, body.locations);
  if (body.social) await saveSocialLinks(userId, sanitizeSocialLinks(body.social.links));
  if (body.gallery) await saveGallery(userId, body.gallery);
  if (body.theme) await saveTheme(userId, body.theme);
  if (body.brand) {
    const b = body.brand;
    await savePersonaBrand(userId, {
      tagline: str(b.tagline),
      taglineSource: str(b.taglineSource),
      values: (Array.isArray(b.values) ? b.values : []).map((v: unknown) => str(v)),
      tone: str(b.tone),
    });
  }
}
