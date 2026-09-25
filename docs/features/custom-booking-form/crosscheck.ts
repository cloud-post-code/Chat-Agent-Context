/**
 * Secondary, live: copy MoonLight's booking form from its real site and score
 * the copy against what its own booking page asks (truth.moonlight.ts).
 * Run: npx tsx docs/features/custom-booking-form/crosscheck.ts [--keep]
 * --keep leaves the tenant so the card can be looked at; it prints the slug.
 *
 * Real crawl (the site plus its offsite GoCheckIn page), the real browser
 * read of the widget, the real model (two calls: services, then the form
 * transcription), a throwaway tenant in the local dev Postgres. Not a gate —
 * network and model output vary; read a miss before acting on it. It needs
 * outbound access to moonlightnailsspabrighton.com and booking.gocheckin.net.
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
  const S = await import("../../../lib/booking/store");
  const { planSteps } = await import("../../../lib/booking/flowSteps");
  const { Crawler } = await import("../../../lib/onboarding/crawl");
  const { discoverServicePages, extractServicesAndBooking } = await import("../../../lib/onboarding/services");

  const user = await prisma.user.create({
    data: {
      email: `crosscheck-custom-form-${Date.now()}@example.invalid`,
      name: "Crosscheck MoonLight",
      slug: `crosscheck-custom-form-${Date.now()}`,
      passwordHash: "",
      onboardedAt: new Date(),
    },
  });
  const say = (m: string) => console.log(`    · ${m}`);
  const crawler = new Crawler(MOONLIGHT.site, say);
  try {
    const home = await crawler.load(MOONLIGHT.site);
    if (!home) throw new Error("could not load the site");
    const pages = await discoverServicePages(crawler, home, []);
    console.log("\nPages read:");
    pages.forEach((p) => console.log(`  ${p.url}`));
    score("the offsite booking page was read", pages.some((p) => p.url.startsWith("https://booking.gocheckin.net/")));

    const { report, form } = await extractServicesAndBooking(pages, user.id, say, { crawler });
    const fields = (await A.getBookingConfig(user.id)).fields;
    const settings = await S.getBookingSettings(user.id);
    const staff = await S.listStaff(user.id);
    const services = await S.listServices(user.id);

    console.log(`\nForm copied (${report.seededFields} questions, ${report.formScreens} screen(s), read by ${report.formHow}; ${report.services} services):`);
    for (const f of fields) {
      console.log(`  ${f.required ? "*" : " "} ${f.key.padEnd(36)} ${f.type.padEnd(11)} ${f.role.padEnd(10)} screen ${f.screen}  ${f.label}`);
    }
    console.log(`Flow: ${settings.flow.map((s) => `${s.kind}${s.screen ? `:${s.screen}` : ""}${s.title ? ` "${s.title}"` : ""}`).join(" → ")}`);
    console.log(`Staff: ${staff.map((s) => s.name).join(", ") || "(none)"}; staffSelection ${settings.staffSelection}`);

    console.log("\nAgainst the real booking page:");
    score("a form was found and transcribed", report.formFound && !!form?.found, JSON.stringify(report));
    score("the widget was read in the browser (not just the page's HTML)", report.formHow === "playwright", report.formHow);
    const kinds = (form?.steps ?? []).map((s) => s.kind);
    score(`the steps are the widget's own: ${MOONLIGHT.steps.join(" → ")}`, kinds.join() === MOONLIGHT.steps.join(), kinds.join(" → "));
    const truth = MOONLIGHT.fields;
    score(`the questions are the widget's own, in order (${truth.length})`, fields.length === truth.length && truth.every((t, i) => same(fields[i]?.label ?? "", t.label)), fields.map((f) => f.label).join(" | "));
    score("required marks as shown", truth.every((t) => fields.find((f) => same(f.label, t.label))?.required === t.required));
    score("types as the inputs had them", truth.every((t) => fields.find((f) => same(f.label, t.label))?.type === t.type), fields.map((f) => `${f.label}:${f.type}`).join(" | "));
    score("roles: name, phone, email, notes, policy", truth.every((t) => fields.find((f) => same(f.label, t.label))?.role === t.role), fields.map((f) => `${f.label}:${f.role}`).join(" | "));
    score("every question sits on one screen", new Set(fields.map((f) => f.screen)).size === 1);
    score("the policy text rides with the agreement", /cancel/i.test(fields.find((f) => f.role === "policy")?.config.text ?? ""));
    score("nothing the widget doesn't ask", fields.every((f) => truth.some((t) => same(t.label, f.label))), fields.filter((f) => !truth.some((t) => same(t.label, f.label))).map((f) => f.label).join(" | "));
    score("'Any available staff' makes the provider optional", settings.staffSelection === "optional", settings.staffSelection);
    const named = staff.filter((s) => !/any available/i.test(s.name)).map((s) => s.name);
    score(`the providers listed are real names (${named.join(", ") || "none"})`, named.length > 0 && named.every((n) => MOONLIGHT.staff.some((t) => same(t, n))));
    const flow = await S.getBookingFlow(user.id);
    const walk = flow ? planSteps(flow.flow, flow.fields, { serviceId: null, variantId: null, answers: {} }).map((s) => (s.kind === "screen" ? `screen:${s.screen}` : s.kind)) : [];
    score("the card walks service → provider → time → questions → review", /^service,provider,time,screen:\d+,review$/.test(walk.join()), walk.join(" → "));
    const priced = Object.entries(MOONLIGHT.prices).filter(([name, price]) => {
      const s = services.find((x) => same(x.name, name));
      return s && s.pricing.amount === Number.parseFloat(price.replace(/[^\d.]/g, ""));
    });
    score(`sampled service prices match (${priced.length}/${Object.keys(MOONLIGHT.prices).length})`, priced.length >= 6, Object.keys(MOONLIGHT.prices).filter((n) => !priced.some(([p]) => p === n)).join(", "));
    score(`services seeded: ${services.length} of ${MOONLIGHT.serviceCount}`, services.length >= 45);
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
