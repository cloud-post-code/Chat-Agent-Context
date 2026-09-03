import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
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

  let body: { profile?: Record<string, unknown>; theme?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  if (body.profile) {
  const p = body.profile;
  const toHours = (v: unknown): string =>
    typeof v === "string"
      ? v.trim()
      : v && typeof v === "object"
        ? serializeHours(Object.fromEntries(
            DAYS.map((d) => [d, str((v as Record<string, unknown>)[d])])) as Hours)
        : "";

  // Locations arrive as structured form entries and are stored AS TEXT in
  // the existing Profile fields — one line per location — so the import /
  // prompt side reads them like any other profile text.
  const locations = (Array.isArray(p.locations) ? p.locations : [])
    .map((l) => {
      const loc = (l ?? {}) as Record<string, unknown>;
      return { address: str(loc.address), phone: str(loc.phone), hours: toHours(loc.hours) };
    })
    .filter((l) => l.address || l.hours);
  const noInPerson = p.no_in_person === true;

  let company_address: string;
  let company_hours: string;
  if (noInPerson) {
    company_address = "Online only — no in-person location";
    company_hours = toHours(p.company_hours);
  } else if (locations.length > 1) {
    company_address = locations
      .map((l, i) => `Location ${i + 1}: ${l.address}${l.phone ? ` (${l.phone})` : ""}`)
      .join("\n");
    company_hours = locations
      .map((l, i) => `Location ${i + 1} — ${l.hours || "hours not listed"}`)
      .join("\n");
  } else if (locations.length === 1) {
    company_address = locations[0].address;
    company_hours = locations[0].hours || toHours(p.company_hours);
  } else {
    company_address = str(p.company_address);
    company_hours = toHours(p.company_hours);
  }

  const profile = {
    company_name: str(p.company_name),
    owner_name: str(p.owner_name),
    company_address,
    company_phone_number: str(p.company_phone_number),
    company_email: str(p.company_email),
    company_hours,
  };
  await prisma.profile.upsert({
    where: { userId: user.id },
    update: profile,
    create: { userId: user.id, ...profile },
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

  return Response.json({ ok: true });
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
