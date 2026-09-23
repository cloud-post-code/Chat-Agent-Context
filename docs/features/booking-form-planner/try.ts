/**
 * Build the booking form for any business and print it, for holding up against
 * that business's own booking page.
 * Run: npx tsx docs/features/booking-form-planner/try.ts <site url> [more urls…]
 *
 * Real crawl (the site plus its booking link, offsite included), real model, a
 * throwaway tenant per site in the local dev Postgres, deleted afterwards.
 * Live and unscored — crosscheck.ts is the scored run against a recorded truth.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}

async function build(site: string) {
  const { prisma } = await import("../../../lib/db");
  const A = await import("../../../lib/appointments");
  const { Crawler } = await import("../../../lib/onboarding/crawl");
  const { findBookingLink } = await import("../../../lib/onboarding/bookingPage");
  const { discoverServicePages, extractServicesAndBooking } = await import("../../../lib/onboarding/services");

  console.log(`\n══ ${site}`);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const user = await prisma.user.create({
    data: { email: `try-form-planner-${stamp}@example.invalid`, name: "Try Planner", slug: `try-form-planner-${stamp}`, passwordHash: "", onboardedAt: new Date() },
  });
  const crawler = new Crawler(site);
  try {
    await A.setBookingEnabled(user.id, true);
    const home = await crawler.load(site);
    if (!home) return console.log("  could not load the site");
    console.log(`  booking link on the homepage: ${findBookingLink(home) ?? "none found"}`);
    const pages = await discoverServicePages(crawler, home, []);
    console.log(`  pages read: ${pages.map((p) => p.url).join("  ")}`);
    const { report } = await extractServicesAndBooking(pages, user.id, () => {});
    console.log(`  kind: ${report.kind} · takes appointments: ${report.takesAppointments} · services: ${report.services}`);
    for (const f of (await A.getBookingConfig(user.id)).fields) {
      const opts = f.config.options ?? [];
      const sample = opts.slice(0, 4).map((o) => `${o.label}${o.price ? ` ${o.price}` : ""}`).join("; ");
      const bounds = f.type === "number" ? `  [${f.config.min ?? ""}–${f.config.max ?? ""}]` : "";
      console.log(`  ${f.required ? "*" : " "} ${f.type.padEnd(13)} ${f.label}${bounds}${opts.length ? `  [${opts.length}: ${sample}…]` : ""}`);
    }
  } finally {
    await crawler.close();
    await prisma.user.delete({ where: { id: user.id } });
  }
}

async function main() {
  const sites = process.argv.slice(2);
  if (!sites.length) throw new Error("usage: try.ts <site url> [more urls…]");
  for (const site of sites) await build(site).catch((e) => console.log(`  failed: ${e instanceof Error ? e.message : e}`));
  await (await import("../../../lib/db")).prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
