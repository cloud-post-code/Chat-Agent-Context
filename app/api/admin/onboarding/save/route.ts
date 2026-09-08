import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { savePersonaBrand } from "@/lib/brand";
import { saveSocialLinks, sanitizeSocialLinks } from "@/lib/socialLinks";
import { DAYS, serializeHours, type Hours } from "@/lib/onboarding/extract";

export const runtime = "nodejs";

const RADII = new Set(["sharp", "rounded", "pill"]);
const WEIGHTS = new Set(["", "500", "600", "700", "800"]);
const HEXISH = /^#[0-9a-fA-F]{3,8}$/;

/**
 * Persist the reviewed values into their real tables. The chat flow saves in
 * stages, so `profile` and `theme` are each optional — only what the request
 * carries is written. The user's edits arrive here, not the raw extraction —
 * whatever is in the form wins. Theme values are clamped to supported presets.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: {
    profile?: Record<string, unknown>;
    locations?: Record<string, unknown>;
    social?: Record<string, unknown>;
    gallery?: Record<string, unknown>;
    theme?: Record<string, unknown>;
    brand?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const toHours = (v: unknown): string =>
    typeof v === "string"
      ? v.trim()
      : v && typeof v === "object"
        ? serializeHours(Object.fromEntries(
            DAYS.map((d) => [d, str((v as Record<string, unknown>)[d])])) as Hours)
        : "";

  if (body.profile) {
    const p = body.profile;
    const profile = {
      company_name: str(p.company_name),
      owner_name: str(p.owner_name),
      company_phone_number: str(p.company_phone_number),
      company_email: str(p.company_email),
    };
    await prisma.profile.upsert({
      where: { userId: user.id },
      update: profile,
      create: { userId: user.id, ...profile },
    });
  }

  // The locations review saves separately (its own chat question). The
  // structured entries are stored AS TEXT in the existing Profile fields —
  // one line per location — so the import / prompt side reads them like any
  // other profile text.
  if (body.locations) {
    const L = body.locations;
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
      where: { userId: user.id },
      update: { company_address, company_hours },
      create: { userId: user.id, company_address, company_hours },
    });
  }

  // The social review: the reviewed platform + link rows replace whatever the
  // profile held (the sanitizer clamps and drops non-http urls).
  if (body.social) {
    await saveSocialLinks(user.id, sanitizeSocialLinks(body.social.links));
  }

  // The gallery review: the extraction stage already stored each photo in
  // the upload store, so saving is row creation over reviewed captions. Only
  // app-upload paths are accepted (same rule as the imported logo). Replace
  // semantics keep an onboarding restart from stacking duplicates.
  if (body.gallery) {
    const images = (Array.isArray(body.gallery.images) ? body.gallery.images : [])
      .map((i: unknown) => {
        const img = (i ?? {}) as Record<string, unknown>;
        return { src: str(img.src), caption: str(img.caption) };
      })
      .filter((i) => /^\/api\/uploads\//.test(i.src))
      .slice(0, 25);
    await prisma.photo.deleteMany({ where: { userId: user.id, kind: "gallery" } });
    await prisma.photo.createMany({
      data: images.map((img, order) => ({
        userId: user.id,
        filename: img.src.replace(/^\/api\/uploads\//, ""),
        caption: img.caption || null,
        description: img.caption,
        kind: "gallery",
        order,
      })),
    });
  }

  if (body.theme) {
  const t = body.theme;
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
    where: { userId: user.id },
    update: theme,
    create: { userId: user.id, ...theme },
  });

  const logo = str(t.themeLogo);
  if (/^\/api\/uploads\//.test(logo)) {
    await prisma.personaConfig.upsert({
      where: { userId: user.id },
      update: { company_logo: logo },
      create: { userId: user.id, company_logo: logo },
    });
  }
  }

  // Brand voice, reviewed alongside the theme. savePersonaBrand validates
  // the source flag (an edited-away tagline clears it) and clamps values.
  if (body.brand) {
    const b = body.brand;
    await savePersonaBrand(user.id, {
      tagline: str(b.tagline),
      taglineSource: str(b.taglineSource),
      values: (Array.isArray(b.values) ? b.values : []).map((v: unknown) => str(v)),
      tone: str(b.tone),
    });
  }

  return Response.json({ ok: true });
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
