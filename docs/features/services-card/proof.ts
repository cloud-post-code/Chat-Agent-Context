/**
 * Primary proof for services-card (see PROOF.md).
 * Run: npx tsx docs/features/services-card/proof.ts
 *
 * Writes services through the real onboarding extractor (its llm seam doubled),
 * then drives the real visitor brain with a scripted model client and asserts
 * the `services` card it hydrates — content, booking config, gating — plus the
 * catalog format round-trip, legacy records, the onboarding planner's services
 * kind, and that the booking the card leads to really lands the service as an
 * answer. Throwaway users are deleted at the end.
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

/** One scripted model turn: optional streamed text, then tool calls (or none = done). */
type Turn = { text?: string; tools?: { name: string; input: Record<string, unknown> }[] };

/** A ModelClient that pops scripted turns and records the params it was sent. */
function scriptedClient(turns: Turn[]) {
  let i = 0;
  const seenParams: { tools?: { name: string }[]; messages?: unknown[] }[] = [];
  const client = {
    messages: {
      stream(params: { tools?: { name: string }[]; messages?: unknown[] }) {
        seenParams.push(params);
        const turn = turns[Math.min(i++, turns.length - 1)] ?? {};
        return {
          async *[Symbol.asyncIterator]() {
            if (turn.text) {
              yield { type: "content_block_delta", delta: { type: "text_delta", text: turn.text } };
            }
          },
          async finalMessage() {
            const content: unknown[] = [];
            if (turn.text) content.push({ type: "text", text: turn.text });
            for (const [j, t] of (turn.tools ?? []).entries()) {
              content.push({ type: "tool_use", id: `tu_${i}_${j}`, name: t.name, input: t.input });
            }
            return { content };
          },
        };
      },
    },
  };
  return { client, seenParams };
}

const page = (url: string, body: string) => {
  const html = `<html><body>${body}</body></html>`;
  return { url, html, $: cheerio.load(html) };
};

// Distinctive strings so a DB match can only come from this proof. The second
// name carries a period on purpose: it is the case the format exists for.
const SERVICES = [
  { name: "Quillhaven gel overlay", description: "Builder gel over the natural nail.\nFrom $58, about 75 minutes." },
  { name: "St. Harrowgate signature pedicure", description: "Soak, scrub and a ten-minute massage. $64." },
  { name: "Wrenfield nail art consult", description: "" },
];
const EXTRACTION = {
  services: SERVICES,
  booking: { takesAppointments: true, requirements: [{ label: "Your phone number", type: "phone", required: true }] },
};
const PAGES = [page("https://example.invalid/services", "<h1>Services</h1><p>Nails.</p>")];

type ServicesBlock = {
  type: "services";
  items: { id: string; name: string; description: string }[];
  booking: { fields: { key: string; label: string }[]; serviceKey: string | null } | null;
};

async function main() {
  const { prisma } = await import("../../../lib/db");
  const { formatServiceCatalog, parseServiceCatalog, SERVICES_SOURCE_TITLE } = await import(
    "../../../lib/serviceCatalog"
  );
  const { extractServicesAndBooking } = await import("../../../lib/onboarding/services");
  const { listServices, servicesBlock } = await import("../../../lib/cards");
  const { answer } = await import("../../../lib/brain");
  const { CARD_TOOLS, normalizeQuestion } = await import("../../../lib/canned");
  const { writeUiCard, parseSampleBlock, listUiCards } = await import("../../../lib/uiCards");
  const { parseDraft } = await import("../../../lib/cardBuilder");
  const { sanitizeCardPlan, generateOnboardingCards } = await import("../../../lib/onboarding/cards");
  const { setBookingEnabled, deleteAppointmentField, createAppointment, listAppointments } =
    await import("../../../lib/appointments");
  const { onboardingIngestKind } = await import("../../../lib/ingestionSources");

  const made: string[] = [];
  const mkUser = async (tag: string) => {
    const u = await prisma.user.create({
      data: {
        email: `proof-services-card-${tag}-${Date.now()}@example.invalid`,
        name: `Proof Services ${tag}`,
        slug: `proof-services-${tag}-${Date.now()}`,
        passwordHash: "",
        onboardedAt: new Date(),
      },
    });
    made.push(u.id);
    return u;
  };
  const quiet = () => {};
  const llmOf = (result: unknown) => async () => result as Record<string, unknown>;

  const run = async (userId: string, turns: Turn[], message = "scripted services turn") => {
    const { client, seenParams } = scriptedClient(turns);
    const events: { t: string; v: unknown }[] = [];
    for await (const e of answer({ userId, message, sessionId: `proof-${Date.now()}` }, { client })) {
      events.push(e);
    }
    const offered = (seenParams[0]?.tools ?? []).map((t) => t.name);
    const cards = events
      .filter((e) => e.t === "card" && (e.v as { type?: string })?.type === "services")
      .map((e) => e.v as ServicesBlock);
    return { events, offered, cards, seenParams };
  };

  try {
    // ── 1. The catalog format: round-trip, flattening, legacy, junk ──
    const text = formatServiceCatalog(SERVICES);
    const back = parseServiceCatalog(text);
    check("format → parse round-trips every service", back.length === 3, JSON.stringify(back));
    check(
      "a name with a period inside it survives whole",
      back[1]?.name === "St. Harrowgate signature pedicure" &&
        back[1]?.description === "Soak, scrub and a ten-minute massage. $64.",
      JSON.stringify(back[1]),
    );
    check(
      "a line break inside a description is flattened, not read as structure",
      back[0]?.description === "Builder gel over the natural nail. From $58, about 75 minutes.",
      JSON.stringify(back[0]),
    );
    check("a service with no description parses with an empty one",
      back[2]?.name === "Wrenfield nail art consult" && back[2]?.description === "", JSON.stringify(back[2]));
    const legacy = parseServiceCatalog("Gel manicure. Long-wear polish, $45.\n\nNail art.");
    check(
      "a record saved before the format (\"Name. Description\" per line) still parses",
      legacy.length === 2 && legacy[0].name === "Gel manicure" &&
        legacy[0].description === "Long-wear polish, $45." &&
        legacy[1].name === "Nail art" && legacy[1].description === "",
      JSON.stringify(legacy),
    );
    const namesOnly = parseServiceCatalog(formatServiceCatalog([
      { name: "St. Harrowgate pedicure", description: "" },
      { name: "Gel overlay", description: "" },
    ]));
    check("a names-only current record is not mistaken for a legacy one",
      namesOnly.length === 2 && namesOnly[0].name === "St. Harrowgate pedicure", JSON.stringify(namesOnly));
    for (const junk of [null, undefined, "", "   \n\n  \n"]) {
      check(`junk ${JSON.stringify(junk)} parses to no services without throwing`,
        parseServiceCatalog(junk as never).length === 0);
    }

    // ── 2. The extractor writes the record the card reads ──
    const userA = await mkUser("a");
    const svc = await extractServicesAndBooking(PAGES as never, userA.id, quiet, { llm: llmOf(EXTRACTION) as never });
    check("extractor reports three services", svc.report.services === 3, JSON.stringify(svc.report));
    const source = await prisma.source.findFirst({
      where: { userId: userA.id, kind: onboardingIngestKind("services"), title: SERVICES_SOURCE_TITLE },
    });
    check("the services Source exists under the catalog title", !!source);
    check("its rawText is the catalog format", source?.rawText === text, JSON.stringify(source?.rawText));
    const chunks = await prisma.chunk.findMany({
      where: { userId: userA.id, sourceId: source?.id ?? "" }, orderBy: { seq: "asc" },
    });
    check(
      "retrieval chunks stay sentence-shaped (\"Name. Description\")",
      chunks.length === 3 && chunks[1].text === "St. Harrowgate signature pedicure. Soak, scrub and a ten-minute massage. $64.",
      JSON.stringify(chunks.map((c) => c.text)),
    );
    const listed = await listServices(userA.id);
    check("listServices returns the services in stored order",
      listed.map((s) => s.name).join("|") === SERVICES.map((s) => s.name).join("|"), JSON.stringify(listed));
    check("service ids are unique", new Set(listed.map((s) => s.id)).size === 3);

    // A sweep page files under the same ingest mark; it must not read as services.
    await prisma.source.create({
      data: {
        userId: userA.id, type: "link", url: "https://example.invalid/policies", title: "Policies",
        kind: onboardingIngestKind("sweep"), rawText: "Cancellation. 24 hours notice.", status: "scanned",
      },
    });
    check("a sweep page under the same ingest mark is not read as services",
      (await listServices(userA.id)).length === 3);

    // ── 3. Hydration: services + the live booking config ──
    // Onboarding seeded the form (name, email, the service picker, phone) and booking is on by default.
    const blockA = (await servicesBlock(userA.id)) as ServicesBlock | null;
    check("servicesBlock hydrates a services block", blockA?.type === "services" && blockA.items.length === 3);
    check(
      "booking rides in the block with the tenant's live fields",
      !!blockA?.booking && blockA.booking.fields.map((f) => f.key).join(",") === "name,email,service,your_phone_number",
      JSON.stringify(blockA?.booking?.fields.map((f) => f.key)),
    );
    check("the chosen service pre-answers the seeded picker", blockA?.booking?.serviceKey === "service");

    await deleteAppointmentField(userA.id, "service");
    const noPicker = (await servicesBlock(userA.id)) as ServicesBlock | null;
    check("with no service or reason question, nothing is pre-answered",
      !!noPicker?.booking && noPicker.booking.serviceKey === null, JSON.stringify(noPicker?.booking));

    const userR = await mkUser("r");
    await extractServicesAndBooking(PAGES as never, userR.id, quiet, {
      llm: llmOf({ services: SERVICES, booking: { takesAppointments: false, requirements: [] } }) as never,
    });
    await deleteAppointmentField(userR.id, "service");
    await prisma.appointmentField.create({
      data: { userId: userR.id, key: "reason", label: "What would you like to talk about?", type: "long_text", required: false, order: 9 },
    });
    const viaReason = (await servicesBlock(userR.id)) as ServicesBlock | null;
    check("without the picker, the generic reason question takes the service",
      viaReason?.booking?.serviceKey === "reason", JSON.stringify(viaReason?.booking));

    await setBookingEnabled(userA.id, false);
    const off = (await servicesBlock(userA.id)) as ServicesBlock | null;
    check("booking off → the same list with booking null (no Book button)",
      off?.type === "services" && off.items.length === 3 && off.booking === null, JSON.stringify(off?.booking));
    await setBookingEnabled(userA.id, true);

    const userEmpty = await mkUser("empty");
    check("no services on file → servicesBlock is null", (await servicesBlock(userEmpty.id)) === null);

    // ── 4. The brain: catalog-gated tool, card event, canned path ──
    check("show_services is a canned card tool", CARD_TOOLS.includes("show_services"));
    {
      const { offered, cards } = await run(userA.id, [
        { tools: [{ name: "show_services", input: {} }] }, { text: "done" },
      ]);
      check("with no catalog row, show_services is not offered", !offered.includes("show_services"), offered.join(","));
      check("…but a call still hydrates (the canned path relies on it)", cards.length === 1);
    }
    const sample = JSON.stringify(await servicesBlock(userA.id));
    const wrote = await writeUiCard(userA.id, {
      key: "", label: "Our services", tool: "show_services", description: "The services list",
      reason: "When a visitor asks what we offer", note: "", sampleBlock: sample,
    });
    check("a show_services catalog row with a services sample is accepted", wrote.ok, JSON.stringify(wrote));
    check("the stored sample parses back as a services block", parseSampleBlock(sample)?.type === "services");
    {
      const { offered, cards, seenParams } = await run(userA.id, [
        { text: "Here's what we offer.", tools: [{ name: "show_services", input: {} }] }, { text: " Tap Book." },
      ]);
      check("with the row, show_services is offered to the model", offered.includes("show_services"), offered.join(","));
      check("a show_services call yields one services card event", cards.length === 1);
      check("the card carries the real services and booking",
        cards[0]?.items[1]?.name === "St. Harrowgate signature pedicure" && !!cards[0]?.booking,
        JSON.stringify(cards[0]));
      const toolResult = JSON.stringify(seenParams[1]?.messages ?? []);
      check("the model is told the card rendered", toolResult.includes("Card rendered to the user."));
    }
    {
      const { cards, seenParams } = await run(userEmpty.id, [
        { tools: [{ name: "show_services", input: {} }] }, { text: "We don't list services yet." },
      ]);
      check("no services → no card event", cards.length === 0);
      check("…and the model is told there is no data",
        JSON.stringify(seenParams[1]?.messages ?? []).includes("No data available."));
    }
    {
      // A starter question carrying the card: zero model calls.
      const q = "What nail services do you offer?";
      await prisma.cannedAnswer.create({
        data: {
          userId: userA.id, question: q, matchKey: normalizeQuestion(q),
          answer: "Here is everything we do.", cardTool: "show_services", enabled: true,
        },
      });
      const { cards, seenParams, events } = await run(userA.id, [{ text: "MODEL SHOULD NOT RUN" }], q);
      const spoke = events.filter((e) => e.t === "text").map((e) => e.v).join("");
      check("a canned answer naming show_services makes zero model calls", seenParams.length === 0);
      check("…and still draws the services card beside its text",
        cards.length === 1 && spoke === "Here is everything we do.", spoke);
    }

    // ── 5. The card builder accepts the live-data route ──
    const draft = parseDraft(JSON.stringify({
      label: "Services", tool: "show_services", description: "Services list", reason: "When asked what we offer", note: "",
      sampleBlock: { type: "services", items: [{ id: "1", name: "Sample service", description: "What it includes" }], booking: null },
    }));
    check("parseDraft accepts show_services with a services sample", draft.tool === "show_services");
    let mismatched = false;
    try {
      parseDraft(JSON.stringify({
        label: "Services", tool: "show_services", description: "", reason: "", note: "",
        sampleBlock: { type: "custom", elements: [] },
      }));
    } catch {
      mismatched = true;
    }
    check("parseDraft rejects show_services drawing a non-services block", mismatched);

    // ── 6. Onboarding plans it automatically, gated on services being on file ──
    const signals = { photos: 0, projects: 0, services: 3, takesAppointments: true, contactChannels: [], categories: ["services"] };
    const plan = { cards: [{ kind: "services", label: "What we offer", description: "Services", reason: "When asked what we offer", questions: [1] }] };
    check("the planner keeps a services card when services are on file",
      sanitizeCardPlan(plan, signals, 1).cards[0]?.kind === "services");
    check("…and drops it when none are",
      sanitizeCardPlan(plan, { ...signals, services: 0 }, 1).cards.length === 0);

    const userP = await mkUser("p");
    await extractServicesAndBooking(PAGES as never, userP.id, quiet, { llm: llmOf(EXTRACTION) as never });
    const starter = await prisma.cannedAnswer.create({
      data: { userId: userP.id, question: "What do you offer?", matchKey: normalizeQuestion("What do you offer?"), answer: "Lots.", enabled: true },
    });
    let corpusSeen = "";
    const report = await generateOnboardingCards([], userP.id, { categories: ["services"] }, quiet, {
      llm: (async (_sys: string, corpus: string) => {
        corpusSeen = corpus;
        return plan as unknown as Record<string, unknown>;
      }) as never,
      draft: (async () => { throw new Error("no designed card expected"); }) as never,
    });
    check("the planner is told how many services are on file", corpusSeen.includes("Services on file: 3"), corpusSeen.slice(-400));
    check("onboarding writes the services card row", report.written === 1 && report.cards[0]?.tool === "show_services", JSON.stringify(report));
    const rowP = (await listUiCards(userP.id))[0];
    const sampleP = parseSampleBlock(rowP?.sampleBlock ?? "") as ServicesBlock | null;
    check("its preview is the tenant's own services, bookable",
      sampleP?.type === "services" && sampleP.items.length === 3 && !!sampleP.booking, rowP?.sampleBlock?.slice(0, 200));
    const attached = await prisma.cannedAnswer.findUnique({ where: { id: starter.id } });
    check("the starter question now carries show_services",
      attached?.cardTool === "show_services" && attached.cardInput === null, JSON.stringify(attached));

    // ── 7. The booking the card leads to: the service lands as an ordinary answer ──
    const blockP = (await servicesBlock(userP.id)) as ServicesBlock;
    const key = blockP.booking!.serviceKey!;
    const when = new Date(Date.now() + 36 * 3600_000);
    when.setMinutes(0, 0, 0);
    const booked = await createAppointment(userP.id, {
      startsAt: when.toISOString(),
      answers: { name: "Proof Visitor", email: "visitor@example.invalid", your_phone_number: "555-0100", [key]: blockP.items[1].name },
    });
    check("the wizard's submit shape (service pre-answered) books through the existing path", booked.ok, JSON.stringify(booked));
    const appts = await listAppointments(userP.id);
    // A menu question stores the pick with the price the visitor was shown
    // ("… ($64)"), a text question stores it bare — either way it must name it.
    check("the appointment records which service was tapped",
      (appts[0]?.answers[key] ?? "").startsWith("St. Harrowgate signature pedicure"), JSON.stringify(appts[0]?.answers));
  } finally {
    for (const id of made) await prisma.user.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
