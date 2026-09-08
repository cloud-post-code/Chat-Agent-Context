/**
 * Primary proof for onboarding-booking-extraction (see PROOF.md).
 * Run: npx tsx docs/features/onboarding-booking-extraction/proof.ts
 *
 * Drives the services-and-booking extractor with fixture Pages and a scripted
 * llm double (the only doubled boundary — the injectable seam), then asserts
 * the real rows it writes: services knowledge (Source + Chunks) and seeded
 * AppointmentField rows, with bookingEnabled untouched. Throwaway users are
 * deleted at the end.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";

// Load .env ourselves (tsx doesn't); never override values already set.
const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const page = (url: string, body: string) => {
  const html = `<html><body>${body}</body></html>`;
  return { url, html, $: cheerio.load(html) };
};

// Distinctive strings so a DB match can only come from this proof.
const SERVICE_NAME = "Quillhaven kiln retrofits";
const SERVICE_DESC = "Full Harrowgate-spec retrofit of aging kilns, two-week turnaround.";

const PAGES = [
  page("https://example.invalid/services", `<h1>Services</h1><p>${SERVICE_DESC}</p>`),
  page(
    "https://example.invalid/book",
    "<p>Book online — we'll need your phone number and the treatment you want.</p>",
  ),
];

/** The canned model output the scripted llm seam returns. */
const EXTRACTION = {
  services: [{ name: SERVICE_NAME, description: SERVICE_DESC }],
  booking: {
    takesAppointments: true,
    requirements: [
      { label: "Your phone number", type: "phone", required: true },
      // An off-whitelist type must degrade to short_text.
      { label: "Which treatment you want", type: "dropdown", required: false },
    ],
  },
};

async function main() {
  const { prisma, getProfile } = await import("../../../lib/db");
  const { extractServicesAndBooking, sanitizeServices } = await import(
    "../../../lib/onboarding/services"
  );
  const { getBookingConfig, setBookingEnabled, saveAppointmentField } = await import(
    "../../../lib/appointments"
  );

  const mkUser = (tag: string) =>
    prisma.user.create({
      data: {
        email: `proof-onboarding-booking-${tag}@example.invalid`,
        name: `Proof Onboarding ${tag}`,
        slug: `proof-onboarding-${tag}-${Date.now()}`,
        passwordHash: "",
        onboardedAt: new Date(),
      },
    });
  const scriptedLlm = (result: unknown) => {
    let calls = 0;
    const llm = async () => {
      calls++;
      return result as Record<string, unknown>;
    };
    return { llm, count: () => calls };
  };

  const userA = await mkUser("a");
  const userB = await mkUser("b");
  const quiet = () => {};

  try {
    // ── 1. Sanitizer: whitelist, caps, junk safety ──
    const clean = sanitizeServices(EXTRACTION as unknown as Record<string, unknown>);
    check("sanitizer keeps the service", clean.services[0]?.name === SERVICE_NAME);
    check("sanitizer keeps takesAppointments", clean.takesAppointments === true);
    check(
      "off-whitelist type degrades to short_text",
      clean.requirements[1]?.type === "short_text",
      JSON.stringify(clean.requirements),
    );
    check("phone type survives", clean.requirements[0]?.type === "phone");
    for (const junk of [null, {}, { services: "x", booking: 7 }, { booking: { requirements: [3] } }]) {
      const s = sanitizeServices(junk as unknown as Record<string, unknown>);
      check(
        `junk shape ${JSON.stringify(junk)} sanitizes empty without throwing`,
        s.services.length === 0 && s.requirements.length === 0 && s.takesAppointments === false,
      );
    }

    // ── 2. Happy path: knowledge saved, catalog seeded, booking still off ──
    const double1 = scriptedLlm(EXTRACTION);
    const run1 = await extractServicesAndBooking(PAGES, userA.id, quiet, { llm: double1.llm });
    check("llm seam was used", double1.count() > 0);
    check("run reports the service", run1.report.services === 1, JSON.stringify(run1.report));

    const sources = await prisma.source.findMany({ where: { userId: userA.id } });
    check("a services source row exists", sources.length > 0);
    const chunks = await prisma.chunk.findMany({ where: { userId: userA.id, originKind: "source" } });
    check("service knowledge chunks exist", chunks.length > 0);
    check(
      "chunk text carries the service",
      chunks.some((c) => c.text.includes(SERVICE_NAME)),
    );

    const cfgA = await getBookingConfig(userA.id);
    check("bookingEnabled untouched", cfgA.enabled === false);
    const keysA = cfgA.fields.map((f) => f.key);
    check(
      "catalog seeded: defaults first, then extracted",
      keysA.length === 4 && keysA[0] === "name" && keysA[1] === "email",
      keysA.join(","),
    );
    check(
      "extracted labels seeded as questions",
      cfgA.fields.some((f) => f.label === "Your phone number" && f.type === "phone" && f.required) &&
        cfgA.fields.some((f) => f.label === "Which treatment you want" && f.type === "short_text"),
      JSON.stringify(cfgA.fields),
    );
    check("profile row untouched otherwise", (await getProfile(userA.id)).bookingEnabled === false);

    // ── 3. Re-run: knowledge refreshed in place, nothing duplicated ──
    const run2 = await extractServicesAndBooking(PAGES, userA.id, quiet, {
      llm: scriptedLlm(EXTRACTION).llm,
    });
    check("re-run still reports the service", run2.report.services === 1);
    const chunks2 = await prisma.chunk.findMany({
      where: { userId: userA.id, originKind: "source" },
    });
    check("chunks replaced, not duplicated", chunks2.length === chunks.length, `${chunks2.length}`);
    const cfgA2 = await getBookingConfig(userA.id);
    check("fields not duplicated on re-run", cfgA2.fields.length === 4, `${cfgA2.fields.length}`);

    // ── 4. Enabling keeps the seeded catalog (no default re-seed) ──
    await setBookingEnabled(userA.id, true);
    const cfgA3 = await getBookingConfig(userA.id);
    check("enable keeps the seeded catalog", cfgA3.fields.length === 4, `${cfgA3.fields.length}`);
    check("enable flips only the toggle", cfgA3.enabled === true);

    // ── 5. Existing catalog is never touched ──
    await saveAppointmentField(userB.id, {
      key: "company",
      label: "Company",
      type: "short_text",
      required: true,
    });
    await extractServicesAndBooking(PAGES, userB.id, quiet, { llm: scriptedLlm(EXTRACTION).llm });
    const cfgB = await getBookingConfig(userB.id);
    check(
      "existing catalog untouched",
      cfgB.fields.length === 1 && cfgB.fields[0].key === "company",
      JSON.stringify(cfgB.fields),
    );
    check(
      "services knowledge still saved for that tenant",
      (await prisma.chunk.count({ where: { userId: userB.id, originKind: "source" } })) > 0,
    );

    // ── 6. Nothing extracted → nothing persisted ──
    const userC = await mkUser("c");
    try {
      const empty = { services: [], booking: { takesAppointments: false, requirements: [] } };
      const runC = await extractServicesAndBooking(PAGES, userC.id, quiet, {
        llm: scriptedLlm(empty).llm,
      });
      check("empty extraction reports zero services", runC.report.services === 0);
      check(
        "empty extraction persists no knowledge",
        (await prisma.source.count({ where: { userId: userC.id } })) === 0,
      );
      check(
        "empty extraction seeds no questions",
        (await prisma.appointmentField.count({ where: { userId: userC.id } })) === 0,
      );
    } finally {
      await prisma.user.delete({ where: { id: userC.id } }).catch(() => {});
    }
  } finally {
    await prisma.user.delete({ where: { id: userA.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: userB.id } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
