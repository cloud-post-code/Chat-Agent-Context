/**
 * Primary proof for onboarding-booking-form-step (see PROOF.md).
 * Run: npx tsx docs/features/onboarding-booking-form-step/proof.ts
 *
 * A exercises the pure step describer. B drives the staged job's new booking
 * stage (gating, fail-soft, wire shape) with no crawler. C–F run the form chat
 * against the real store under a throwaway user; the scripted model client is
 * the one doubled boundary. Offline.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// lib/onboarding/jobs.ts reaches lib/fonts.ts, whose next/font/google loaders
// only work inside Next's build. Stand them in with a shape-only stub, for
// this process alone — the fonts are never read here.
{
  const Module = createRequire(import.meta.url)("node:module") as { _load: (...a: unknown[]) => unknown };
  const load = Module._load;
  Module._load = function (this: unknown, request: unknown, ...rest: unknown[]) {
    if (request === "next/font/google") {
      return new Proxy({}, { get: () => () => ({ className: "", variable: "", style: { fontFamily: "sans-serif" } }) });
    }
    return load.call(this, request, ...rest);
  };
}

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

/** One scripted model turn: optional text, then tool calls (or none = done). */
type Turn = { text?: string; tools?: { name: string; input: Record<string, unknown> }[] };

/** A ModelClient whose stream() pops the next scripted turn and records what it was sent. */
function scriptedClient(turns: Turn[], seen: { system: string[]; messages: unknown[][]; calls: number }) {
  let i = 0;
  return {
    messages: {
      stream(params: { system?: unknown; messages?: unknown[] }) {
        seen.calls++;
        seen.system.push(String(params.system ?? ""));
        seen.messages.push([...(params.messages ?? [])]);
        const turn = turns[Math.min(i++, turns.length - 1)] ?? {};
        return {
          async *[Symbol.asyncIterator]() {
            if (turn.text) yield { type: "content_block_delta", delta: { type: "text_delta", text: turn.text } };
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
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const titles = (steps: { title: string }[]) => steps.map((s) => s.title).join(" → ");

async function main() {
  const S = await import("../../../lib/booking/steps");
  const T = await import("../../../lib/booking/types");

  // ══ A. The steps a visitor meets, described from the flow ═══════════════
  {
    const settings = T.sanitizeBookingSettings({});
    const rules = { ...settings, hasPromoCodes: false } as unknown as import("../../../lib/booking/types").BookingRules;
    delete (rules as unknown as Record<string, unknown>).promoCodes;
    const svc = (name: string, extra: Partial<import("../../../lib/booking/types").ServiceRow> = {}) =>
      ({
        id: name.toLowerCase(), name, category: "Hair", description: "", imageUrl: null, images: [],
        pricing: { kind: "fixed", amount: 30 }, durationMinutes: 30, addons: [], variants: [], deposit: { kind: "none" },
        modes: [], staffIds: [], locationIds: [], eligibility: "", preparation: "", cancellationPolicy: "",
        bufferBeforeMinutes: 0, bufferAfterMinutes: 0, order: 0, enabled: true, ...extra,
      }) as import("../../../lib/booking/types").ServiceRow;
    const flow: import("../../../lib/booking/types").BookingFlow = {
      business: { name: "Quill Barbers", timezone: "UTC", currency: "USD", phone: "" },
      services: [svc("Cut"), svc("Shave", { addons: [{ id: "oil", name: "Hot oil", price: 5 }] })],
      categories: ["Hair"],
      staff: [{ id: "s1", name: "Maya", role: "", bio: "", photoUrl: null, specialties: [], languages: [], credentials: [], genderLabel: "", hours: null, timeOff: [], priceOverrides: {}, durationOverrides: {}, order: 0, enabled: true }],
      locations: [],
      rules: { ...rules, staffSelection: "optional", confirmation: "instant" },
      preselect: { serviceId: null },
    };
    const fields: import("../../../lib/appointmentTypes").AppointmentFieldRow[] = [
      { key: "guests", label: "How many guests?", type: "number", required: true, order: 0, config: { min: 1, max: 8 } },
      { key: "allergies", label: "Any allergies?", type: "long_text", required: false, order: 1, config: { showIf: { key: "guests", values: [] } } },
    ];
    const steps = S.describeBookingSteps(flow, fields);
    check("A1 steps follow the card's order: service → options → provider → time → details → questions → review",
      steps.map((s) => s.kind).join(",") === "service,options,provider,time,details,question,question,review", steps.map((s) => s.kind).join(","));
    check("A2 the service step counts the services", /2 services/.test(steps[0].detail), steps[0].detail);
    check("A3 an options step is listed as 'sometimes', naming how many services have it", /only for 1 service/.test(steps[1].detail), steps[1].detail);
    check("A4 the provider step names the choice and 'anyone available'", /1 provider, or anyone available/.test(steps[2].detail), steps[2].detail);
    const details = steps.find((s) => s.kind === "details")!;
    check("A5 the details step lists the asked customer fields, required ones starred", /First name\*/.test(details.detail) && /Email\*/.test(details.detail), details.detail);
    const q1 = steps.find((s) => s.id === "q:guests")!;
    check("A6 a number question says its range and that it is required", q1.detail === "a number from 1 to 8 · required", q1.detail);
    const q2 = steps.find((s) => s.id === "q:allergies")!;
    check("A7 a conditional question says when it is asked", /only when "guests" is answered/.test(q2.detail), q2.detail);
    check("A8 the review step says the booking is instant", /booked on the spot/.test(steps[steps.length - 1].detail));
    const hidden = S.describeBookingSteps({ ...flow, rules: { ...flow.rules, staffSelection: "hidden", confirmation: "request" } }, fields);
    check("A9 hidden staff selection drops the provider step; request confirmation is said", !hidden.some((s) => s.kind === "provider") && /request you confirm/.test(hidden[hidden.length - 1].detail));
    check("A10 booking off means no steps at all", S.describeBookingSteps(null, fields).length === 0);

    const after = S.describeBookingSteps(flow, [fields[0], { key: "pet", label: "Your pet's name", type: "short_text", required: false, order: 2, config: {} }]);
    const d = S.diffSteps(steps, after);
    check("A11 diffSteps marks the new question added and the dropped one removed", d.added.join() === "q:pet" && d.removed.join() === "q:allergies" && d.changed.length === 0, JSON.stringify(d));
    const reworded = S.describeBookingSteps(flow, [{ ...fields[0], required: false }, fields[1]]);
    check("A12 diffSteps marks a reworded/re-required question changed", S.diffSteps(steps, reworded).changed.join() === "q:guests");
  }

  // ══ B. The staged job's booking stage ════════════════════════════════════
  {
    const J = await import("../../../lib/onboarding/jobs");
    const job = { id: "proof-job", userId: "nobody", url: "https://x.example/", phase: "theme-done", progress: 100, log: [] } as unknown as import("../../../lib/onboarding/jobs").Job;
    check("B1 advance('booking') is accepted after the theme review", J.advanceJob(job, "booking") && job.phase === "booking", job.phase);
    for (let i = 0; i < 50 && job.busy; i++) await sleep(50);
    check("B2 a booking read that fails (no crawler here) is fail-soft: phase booking-done, no report", job.phase === "booking-done" && job.stepBooking?.report === null, `${job.phase} ${JSON.stringify(job.stepBooking)}`);
    check("B3 …and the log says the form can still be built in the next step", job.log.some((l) => /build the form in the next step/.test(l)), job.log.join(" | "));
    const wire = J.jobPayload({ ...job, servicePages: [{ url: "https://x.example/services" }] } as unknown as import("../../../lib/onboarding/jobs").Job) as Record<string, unknown>;
    check("B4 the wire payload carries stepBooking and never the internal service pages", "stepBooking" in wire && !("servicePages" in wire));
    check("B5 advance('knowledge') is accepted from booking-done", J.advanceJob(job, "knowledge", []) === true);
    for (let i = 0; i < 100 && job.busy; i++) await sleep(50);
    const early = { ...job, phase: "core-done", busy: false } as unknown as import("../../../lib/onboarding/jobs").Job;
    check("B6 advance('booking') is refused while another stage runs", !J.advanceJob({ ...early, busy: true } as never, "booking"));
  }

  // ══ C–F. The form chat, for real ════════════════════════════════════════
  const { prisma } = await import("../../../lib/db");
  const C = await import("../../../lib/onboarding/bookingFormChat");
  const A = await import("../../../lib/appointments");
  const B = await import("../../../lib/booking/store");

  const user = await prisma.user.create({
    data: {
      email: `proof-booking-form-step-${Date.now()}@example.invalid`,
      name: "Proof Booking Form Step",
      slug: `proof-booking-form-step-${Date.now()}`,
      passwordHash: "",
    },
  });
  const userId = user.id;
  const generatedCount = async () =>
    (await prisma.appointmentField.findMany({ where: { userId } })).filter((r) => r.config.includes('"generated":true')).length;

  const run = async (message: string, turns: Turn[], history: { role: "user" | "assistant"; content: string }[] = []) => {
    const seen = { system: [] as string[], messages: [] as unknown[][], calls: 0 };
    const result = await C.editBookingForm({ userId, message, history }, { client: scriptedClient(turns, seen) as never });
    return { ...result, seen };
  };

  try {
    // ── C. Reading the form as the step sees it ──
    await A.setBookingEnabled(userId, true);
    // What the booking stage would have built for a salon: a generated form.
    const written = await A.rebuildUntouchedForm(userId, [
      { key: "name", label: "Your name", type: "short_text", required: true },
      { key: "phone", label: "Your phone number", type: "phone", required: true },
      { key: "notes", label: "Anything we should know before your visit?", type: "long_text", required: false },
    ]);
    check("C1 the stage's generated form is on file", written === 3 && (await generatedCount()) === 3);
    await B.saveStaff(userId, { name: "Maya", role: "Stylist", bio: "" });

    const form = await C.bookingFormSummary(userId);
    check("C2 the summary carries the tenant's slug and that booking is on", form.slug === user.slug && form.enabled && form.flow !== null);
    check("C3 name and phone are the details step, not questions; notes is the one question",
      form.fields.map((f) => f.key).join() === "notes", form.fields.map((f) => f.key).join());
    check("C4 the steps: provider → time → details → notes → review (no services yet)",
      titles(form.steps) === "Choose who you'd like to see → Date and time → Your details → Anything we should know before your visit? → Review and confirm", titles(form.steps));
    check("C5 a required legacy phone question makes the details step require the phone", /Phone\*/.test(form.steps.find((s) => s.kind === "details")!.detail));
    const told = C.describeFormForModel(form);
    check("C6 the model is told the question keys, the provider, and the customer fields' state",
      /key notes:/.test(told) && /Maya/.test(told) && /phone \("Phone"\): asked, required/.test(told), told);

    // ── D. A round of the chat changes the form for real and reads it back ──
    const d1 = await run("Ask how many guests are coming (up to 8), and don't require the phone number.", [
      {
        tools: [
          { name: "add_question", input: { label: "How many guests?", type: "number", required: true, min: 1, max: 8, after: "first" } },
          { name: "set_customer_field", input: { key: "phone", required: false } },
        ],
      },
      { text: "Added a guest count and made the phone number optional." },
    ]);
    check("D1 the reply is the model's own closing text", d1.reply === "Added a guest count and made the phone number optional.", d1.reply);
    check("D2 two changes are reported, in order", d1.changes.length === 2 && /Added the question “How many guests\?”/.test(d1.changes[0]) && /Phone is asked, optional/.test(d1.changes[1]), JSON.stringify(d1.changes));
    check("D3 the guest question is stored as a required number 1–8", (await A.getBookingConfig(userId)).fields.some((f) => f.key === "how_many_guests" && f.type === "number" && f.required && f.config.min === 1 && f.config.max === 8));
    check("D4 'after: first' asks it before the other questions", d1.form.fields.map((f) => f.key).join() === "how_many_guests,notes", d1.form.fields.map((f) => f.key).join());
    check("D5 the re-read form's steps show it, with its range", d1.form.steps.some((s) => s.id === "q:how_many_guests" && s.detail === "a number from 1 to 8 · required"));
    const phone = (await B.getBookingSettings(userId)).customerFields.find((f) => f.key === "phone")!;
    check("D6 the phone customer field is asked but no longer required", phone.enabled && !phone.required);
    check("D7 a chat edit is an admin edit: the form is the owner's now (no question stays generated)", (await generatedCount()) === 0);
    check("D8 the loop ended after the closing turn (2 model calls)", d1.seen.calls === 2, String(d1.seen.calls));
    check("D9 the system prompt carried the form as it stood before the change", /key notes:/.test(d1.seen.system[0]) && !/how_many_guests/.test(d1.seen.system[0]));

    // ── E. Services, wording, order, removal, provider choice, confirmation ──
    const e1 = await run("Add a $20 beard trim, 30 minutes.", [
      { tools: [{ name: "add_service", input: { name: "Beard trim", price: "$20", durationMinutes: 30, category: "Barbering" } }] },
      { text: "Added Beard trim at $20 for 30 minutes." },
    ]);
    const beard = e1.form.flow!.services.find((s) => s.name === "Beard trim");
    check("E1 the service is on the menu with the stated price and length", !!beard && beard.pricing.kind === "fixed" && beard.pricing.amount === 20 && beard.durationMinutes === 30, JSON.stringify(beard?.pricing));
    check("E2 the form now opens with the service step", e1.form.steps[0].kind === "service" && /1 service/.test(e1.form.steps[0].detail), titles(e1.form.steps));

    const e2 = await run("Reword the guest question to 'How many are coming?', make it optional, drop the notes question, and let people skip choosing a stylist — actually don't ask at all. Bookings should be requests I confirm.", [
      {
        tools: [
          { name: "edit_question", input: { key: "how_many_guests", label: "How many are coming?", required: false } },
          { name: "remove_question", input: { key: "notes" } },
          { name: "set_staff_selection", input: { mode: "hidden" } },
          { name: "set_confirmation", input: { mode: "request" } },
        ],
      },
      { text: "Done." },
    ]);
    check("E3 four changes in one round", e2.changes.length === 4, JSON.stringify(e2.changes));
    const guests = e2.form.fields.find((f) => f.key === "how_many_guests")!;
    check("E4 the question is reworded and optional, its range kept", guests.label === "How many are coming?" && !guests.required && guests.config.max === 8, JSON.stringify(guests));
    check("E5 the notes question is gone", !e2.form.fields.some((f) => f.key === "notes"));
    check("E6 no provider step once staff selection is hidden", !e2.form.steps.some((s) => s.kind === "provider"), titles(e2.form.steps));
    check("E7 the review step says bookings are requests", /request you confirm/.test(e2.form.steps[e2.form.steps.length - 1].detail));
    check("E8 confirmation set by chat counts as the owner's choice", (await B.getBookingSettings(userId)).confirmationOwner === true);

    const e3 = await run("Ask for a photo of the problem, and ask about allergies only when they bring guests.", [
      {
        tools: [
          { name: "add_question", input: { label: "A photo of the problem", type: "photo" } },
          { name: "add_question", input: { label: "Any allergies in the party?", type: "long_text", showIfKey: "how_many_guests" } },
          { name: "reorder_questions", input: { keys: ["a_photo_of_the_problem", "how_many_guests"] } },
        ],
      },
      { text: "Added both." },
    ]);
    check("E9 a photo question and a conditional question are added", e3.form.fields.some((f) => f.key === "a_photo_of_the_problem" && f.type === "photo") && e3.form.fields.some((f) => f.key === "any_allergies_in_the_party" && f.config.showIf?.key === "how_many_guests"));
    check("E10 reorder puts the named keys first and keeps the rest after", e3.form.fields.map((f) => f.key).join() === "a_photo_of_the_problem,how_many_guests,any_allergies_in_the_party", e3.form.fields.map((f) => f.key).join());

    // ── F. Guard rails ──
    const f1 = await run("Add a select question.", [
      { tools: [{ name: "add_question", input: { label: "Which room?", type: "select" } }, { name: "remove_question", input: { key: "nope" } }, { name: "bogus", input: {} }] },
      {},
    ]);
    check("F1 a select without options, an unknown key and an unknown tool change nothing", f1.changes.length === 0 && !f1.form.fields.some((f) => f.key === "which_room"));
    check("F2 …and the reply says nothing changed", /didn't change anything/.test(f1.reply), f1.reply);
    const f2 = await run("Just add it", [{ tools: [{ name: "add_question", input: { label: "Preferred day?", type: "short_text" } }] }, {}]);
    check("F3 a model that closes without text gets a reply built from the changes", /^Done — added the question “Preferred day\?”/.test(f2.reply), f2.reply);
    const f3 = await run("Remove that last one.", [{ tools: [{ name: "remove_question", input: { key: "preferred_day" } }] }, { text: "Removed." }], [
      { role: "user", content: "Just add it" },
      { role: "assistant", content: f2.reply },
    ]);
    check("F4 earlier rounds are sent to the model as the conversation", (f3.seen.messages[0] as unknown[]).length === 3);
    const before = await C.bookingFormSummary(userId);
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const f4 = await C.editBookingForm({ userId, message: "Add something." });
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    check("F5 no model key: the reply says so, nothing changes, the form still comes back", /isn't configured/.test(f4.reply) && f4.changes.length === 0 && titles(f4.form.steps) === titles(before.steps), f4.reply);

    await prisma.profile.update({ where: { userId }, data: { bookingEnabled: false } });
    const off = await C.bookingFormSummary(userId);
    check("F6 booking off: the summary says so with no steps", !off.enabled && off.flow === null && off.steps.length === 0);
    check("F7 …and the model would be told there is no form", /Booking is OFF/.test(C.describeFormForModel(off)));
    const on = await C.enableBookingForm(userId);
    check("F8 turning booking on from the step brings the form back", on.enabled && on.steps.length > 0);
  } finally {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }

  // ══ Z. No proof users left behind ═════════════════════════════════════════
  check("Z proof user removed", (await prisma.user.count({ where: { id: userId } })) === 0);

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
