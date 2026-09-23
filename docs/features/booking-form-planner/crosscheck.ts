/**
 * Secondary, live: build MoonLight's booking form from its real site and score
 * it against what its own booking page asks (truth.moonlight.ts).
 * Run: npx tsx docs/features/booking-form-planner/crosscheck.ts [--keep]
 * --keep leaves the tenant so the card can be looked at; it prints the slug.
 *
 * Real crawl (the site plus its offsite GoCheckIn page), real model, a
 * throwaway tenant in the local dev Postgres that starts in the state
 * production was in: booking on, the three default questions. Not a gate —
 * model output varies; read a miss before acting on it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { MOONLIGHT } from "./truth.moonlight";

const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}

let misses = 0;
function score(name: string, ok: boolean, detail?: string) {
  if (!ok) misses++;
  console.log(`  ${ok ? "MATCH" : "MISS "}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

async function main() {
  const { prisma } = await import("../../../lib/db");
  const A = await import("../../../lib/appointments");
  const { Crawler } = await import("../../../lib/onboarding/crawl");
  const { discoverServicePages, extractServicesAndBooking } = await import("../../../lib/onboarding/services");

  const user = await prisma.user.create({
    data: {
      email: `crosscheck-form-planner-${Date.now()}@example.invalid`,
      name: "Crosscheck MoonLight",
      slug: `crosscheck-form-planner-${Date.now()}`,
      passwordHash: "",
      onboardedAt: new Date(),
    },
  });
  const say = (m: string) => console.log(`    · ${m}`);
  const crawler = new Crawler(MOONLIGHT.site, say);
  try {
    await A.setBookingEnabled(user.id, true);
    const home = await crawler.load(MOONLIGHT.site);
    if (!home) throw new Error("could not load the site");
    const pages = await discoverServicePages(crawler, home, []);
    console.log("\nPages read:");
    pages.forEach((p) => console.log(`  ${p.url}`));
    score("the offsite booking page was read", pages.some((p) => p.url.startsWith("https://booking.gocheckin.net/")));

    const { report } = await extractServicesAndBooking(pages, user.id, say);
    const form = (await A.getBookingConfig(user.id)).fields;

    console.log(`\nForm built (${report.seededFields} questions, ${report.services} services):`);
    for (const f of form) {
      const n = f.config.options?.length;
      console.log(`  ${f.required ? "*" : " "} ${f.key.padEnd(10)} ${f.type.padEnd(13)} ${f.label}${n ? `  [${n} options]` : ""}`);
    }
    const menu = form.find((f) => f.key === "service");
    const opts = menu?.config.options ?? [];
    const groups = [...new Set(opts.map((o) => o.group).filter(Boolean))] as string[];
    console.log(`\nMenu sections: ${groups.join(" | ")}`);

    console.log("\nAgainst the real booking page:");
    score("services are a pick-several menu", menu?.type === "multi_select");
    const priced = Object.entries(MOONLIGHT.prices).filter(([name, price]) => {
      const o = opts.find((x) => same(x.label, name));
      return o && o.price?.replace(/\.00$/, "") === price.replace(/\.00$/, "");
    });
    score(`sampled prices match (${priced.length}/${Object.keys(MOONLIGHT.prices).length})`, priced.length >= 6,
      Object.keys(MOONLIGHT.prices).filter((n) => !priced.some(([p]) => p === n)).join(", "));
    const heads = MOONLIGHT.categories.filter((c) => groups.some((g) => same(g, c)));
    score(`menu headings match (${heads.length}/${MOONLIGHT.categories.length})`, heads.length >= 7);
    score(`menu size ${opts.length} of ${MOONLIGHT.serviceCount} (capped at 60)`, opts.length >= 45);
    score("name is required", form.find((f) => f.key === "name")?.required === true);
    score("phone is asked and required", form.find((f) => f.type === "phone")?.required === true);
    score("email is optional", form.find((f) => f.type === "email")?.required === false);
    score("notes are taken", form.some((f) => f.key === "notes"));
    // The real page has a technician step; its names only render after a
    // service is picked, so a pick-list when names were found, else a text box.
    const staff = form.find((f) => f.key === "staff" || /technician|staff|stylist/i.test(f.label));
    score("a technician preference is asked, and is optional", !!staff && !staff.required,
      staff ? `${staff.type}${staff.config.options ? `: ${staff.config.options.map((o) => o.label).join(", ")}` : ""}` : "not asked");
    const extra = form.filter((f) => f !== staff && !["name", "phone", "email", "service", "notes"].includes(f.key));
    score("asks nothing the real page doesn't", extra.length === 0, extra.map((f) => f.label).join(" | "));
    console.log(`\n${misses ? `${misses} miss(es)` : "Every check matched"}.`);
  } finally {
    await crawler.close();
    if (process.argv.includes("--keep")) console.log(`\nKept tenant: ${user.slug}`);
    else await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
