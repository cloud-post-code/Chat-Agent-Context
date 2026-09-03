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
  const rawHours = p.company_hours;
  const company_hours =
    typeof rawHours === "string"
      ? rawHours.trim()
      : rawHours && typeof rawHours === "object"
        ? serializeHours(Object.fromEntries(
            DAYS.map((d) => [d, str((rawHours as Record<string, unknown>)[d])])) as Hours)
        : "";
  const profile = {
    company_name: str(p.company_name),
    owner_name: str(p.owner_name),
    company_address: str(p.company_address),
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
