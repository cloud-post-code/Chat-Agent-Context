/**
 * One-off bridge for tenants onboarded before the Service table: a booking
 * form whose "service" question is a menu (a select / multi_select with
 * options) and no Service rows yet. Each option becomes a Service row — the
 * price and duration from the option (or read out of the services knowledge
 * record's description), the category from the option's group, a photo from
 * the gallery by caption — and the picker question is then deleted, since
 * the service step asks it now.
 *
 *   npx tsx scripts/materialize-legacy-services.ts
 *
 * Prints one line per tenant touched; a tenant with Service rows already, or
 * with no such question, is left alone and prints nothing. Idempotent.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

// Load .env (tsx doesn't); never override values already set.
const root = path.resolve(__dirname, "..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}

const PICKER_KEY = "service";

type Known = { name: string; category: string; description: string; price: string; duration: string; image: string };

const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function main() {
  const { prisma } = await import("../lib/db");
  const { getBookingConfig, deleteAppointmentField } = await import("../lib/appointments");
  const { durationMinutes } = await import("../lib/appointmentTypes");
  const { listServices, saveService, getBookingSettings } = await import("../lib/booking/store");
  const { pricingFromText } = await import("../lib/booking/types");
  const { bestImageFor } = await import("../lib/booking/matchImages");
  const { onboardingIngestKind } = await import("../lib/ingestionSources");
  const { SERVICES_SOURCE_TITLE, parseServiceCatalog, priceFromText, durationFromText } = await import("../lib/serviceCatalog");
  const { sanitizeMenuItem } = await import("../lib/menuTypes");

  const pickers = await prisma.appointmentField.findMany({
    where: { key: PICKER_KEY, type: { in: ["select", "multi_select"] } },
    select: { userId: true },
  });
  const userIds = [...new Set(pickers.map((p) => p.userId))];

  for (const userId of userIds) {
    const { fields } = await getBookingConfig(userId);
    const picker = fields.find((f) => f.key === PICKER_KEY && (f.config.options?.length ?? 0) > 0);
    if (!picker) continue;
    if ((await listServices(userId)).length > 0) continue;

    // What the tenant already knows about its services, merged by name: the
    // menu items, the picker's options, the services knowledge record.
    const byName = new Map<string, Known>();
    const take = (name: string, patch: Partial<Omit<Known, "name">>) => {
      const key = nameKey(name);
      if (!key) return;
      const cur = byName.get(key) ?? { name: name.trim(), category: "", description: "", price: "", duration: "", image: "" };
      for (const [k, v] of Object.entries(patch) as [keyof Omit<Known, "name">, string | undefined][]) {
        if (v && !cur[k]) cur[k] = v;
      }
      byName.set(key, cur);
    };
    for (const r of await prisma.menuItem.findMany({ where: { userId }, orderBy: { order: "asc" } })) {
      let item = null;
      try {
        item = sanitizeMenuItem({ ...JSON.parse(r.data), key: r.key, name: r.name, category: r.category });
      } catch {
        item = sanitizeMenuItem({ key: r.key, name: r.name, category: r.category });
      }
      if (!item) continue;
      take(item.name, {
        category: item.category,
        description: item.shortDescription || item.fullDescription,
        price: item.salePrice || item.price,
        duration: item.estimatedTime,
        image: /^https:\/\/\S+$/i.test(item.image) ? item.image : "",
      });
    }
    for (const o of picker.config.options ?? []) {
      take(o.label, { category: o.group, description: o.description, price: o.price, duration: o.duration });
    }
    const source = await prisma.source.findFirst({
      where: { userId, kind: onboardingIngestKind("services"), title: SERVICES_SOURCE_TITLE },
      orderBy: { updatedAt: "desc" },
      select: { rawText: true },
    });
    for (const s of parseServiceCatalog(source?.rawText)) {
      take(s.name, { description: s.description, price: priceFromText(s.description), duration: durationFromText(s.description) });
    }

    const known = [...byName.values()];
    const settings = await getBookingSettings(userId);
    const photos = await prisma.photo.findMany({
      where: { userId, NOT: { kind: { startsWith: "ingest:" } } },
      select: { filename: true, caption: true, description: true },
    });
    const gallery = photos.map((p) => ({
      filename: p.filename,
      src: `/api/uploads/${p.filename}`,
      text: [p.caption, p.description].filter(Boolean).join(" "),
    }));

    let written = 0;
    for (const k of known) {
      const fromGallery = k.image ? null : bestImageFor(k.name, gallery);
      const photo = fromGallery ? gallery.find((g) => g.src === fromGallery) : null;
      const saved = await saveService(userId, {
        name: k.name,
        category: k.category,
        description: k.description,
        pricing: pricingFromText(k.price),
        durationMinutes: durationMinutes(k.duration) ?? settings.defaultDurationMinutes,
        images: k.image ? [k.image] : [],
        imageFilename: photo?.filename ?? null,
      });
      if (saved.ok) written++;
      else console.error(`  ${userId}: couldn't save "${k.name}" — ${saved.error}`);
    }
    if (!written) {
      console.log(`${userId}: ${known.length} service(s) known, none written — picker kept`);
      continue;
    }
    await deleteAppointmentField(userId, PICKER_KEY);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { slug: true } });
    console.log(`${user?.slug ?? userId}: wrote ${written} Service row(s) from the "${picker.label}" menu; picker question deleted`);
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
