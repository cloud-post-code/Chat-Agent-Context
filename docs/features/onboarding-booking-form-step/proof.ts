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
type ToolDef = { name: string; input_schema: { properties?: Record<string, { enum?: string[] }> } };
function scriptedClient(turns: Turn[], seen: { system: string[]; messages: unknown[][]; tools: ToolDef[]; calls: number }) {
  let i = 0;
  return {
    messages: {
      stream(params: { system?: unknown; messages?: unknown[]; tools?: ToolDef[] }) {
        seen.calls++;
        seen.system.push(String(params.system ?? ""));
        seen.messages.push([...(params.messages ?? [])]);
        seen.tools = params.tools ?? [];
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
    type Row = import("../../../lib/appointmentTypes").AppointmentFieldRow;
    const row = (r: Omit<Row, "order" | "config" | "role" | "screen"> & Partial<Pick<Row, "order" | "config" | "role" | "screen">>): Row =>
      ({ order: 0, config: {}, role: "none", screen: 1, ...r });
    // The migrated form of an existing tenant: the contact details on screen 1, then one question per screen.
    const contact: Row[] = [
      row({ key: "first_name", label: "First name", type: "short_text", required: true, role: "first_name", screen: 1 }),
      row({ key: "last_name", label: "Last name", type: "short_text", required: true, role: "last_name", screen: 1 }),
      row({ key: "email", label: "Email", type: "email", required: true, role: "email", screen: 1 }),
      row({ key: "phone", label: "Phone", type: "phone", required: false, role: "phone", screen: 1 }),
    ];
    const fields: Row[] = [
      ...contact,
      row({ key: "guests", label: "How many guests?", type: "number", required: true, config: { min: 1, max: 8 }, screen: 2 }),
      row({ key: "allergies", label: "Any allergies?", type: "long_text", required: false, config: { showIf: { key: "guests", values: [] } }, screen: 3 }),
    ];
    const steps = S.describeBookingSteps(flow, fields);
    check("A1 the default order: service → options → provider → time → the contact screen → each question → review",
      steps.map((s) => s.kind).join(",") === "service,options,provider,time,screen,question,question,review", steps.map((s) => s.kind).join(","));
    check("A2 the service step counts the services", /2 services/.test(steps[0].detail), steps[0].detail);
    check("A3 an options step is listed as 'sometimes', naming how many services have it", /only for 1 service/.test(steps[1].detail), steps[1].detail);
    check("A4 the provider step names the choice and 'anyone available'", /1 provider, or anyone available/.test(steps[2].detail), steps[2].detail);
    const screen1 = steps.find((s) => s.kind === "screen")!;
    check("A5 a screen holding several fields is one step, id screen:<n>, titled by its labels with required ones starred",
      screen1.id === "screen:1" && screen1.title === "First name*, Last name*, Email*, Phone" && screen1.screen === 1, `${screen1.id} ${screen1.title}`);
    check("A5b …its detail lists each field with its type, and it carries the fields with their roles",
      screen1.detail === "First name* · short answer, Last name* · short answer, Email* · email, Phone · phone number" &&
        screen1.fields!.map((f) => f.role).join() === "first_name,last_name,email,phone" && screen1.fields![3].detail === "phone number · optional",
      `${screen1.detail} | ${JSON.stringify(screen1.fields)}`);
    const q1 = steps.find((s) => s.id === "q:guests")!;
    check("A6 a screen with one field keeps the question shape: q:<key>, label, range and requiredness, its screen and role",
      q1.kind === "question" && q1.title === "How many guests?" && q1.detail === "a number from 1 to 8 · required" && q1.screen === 2 && q1.question?.role === "none", JSON.stringify(q1));
    const q2 = steps.find((s) => s.id === "q:allergies")!;
    check("A7 a conditional question says when it is asked", /only when "guests" is answered/.test(q2.detail), q2.detail);
    check("A8 the review step says the booking is instant", /booked on the spot/.test(steps[steps.length - 1].detail));
    const hidden = S.describeBookingSteps({ ...flow, rules: { ...flow.rules, staffSelection: "hidden", confirmation: "request" } }, fields);
    check("A9 hidden staff selection drops the provider step; request confirmation is said", !hidden.some((s) => s.kind === "provider") && /request you confirm/.test(hidden[hidden.length - 1].detail));
    check("A10 booking off means no steps at all", S.describeBookingSteps(null, fields).length === 0);

    const after = S.describeBookingSteps(flow, [...contact, fields[4], row({ key: "pet", label: "Your pet's name", type: "short_text", required: false, screen: 4 })]);
    const d = S.diffSteps(steps, after);
    check("A11 diffSteps marks the new question added and the dropped one removed", d.added.join() === "q:pet" && d.removed.join() === "q:allergies" && d.changed.length === 0, JSON.stringify(d));
    const reworded = S.describeBookingSteps(flow, fields.map((f) => (f.key === "guests" ? { ...f, required: false } : f)));
    check("A12 diffSteps marks a reworded/re-required question changed", S.diffSteps(steps, reworded).changed.join() === "q:guests");
    const phoneRequired = S.describeBookingSteps(flow, fields.map((f) => (f.key === "phone" ? { ...f, required: true } : f)));
    check("A13 a field changing on a shared screen marks that screen changed", S.diffSteps(steps, phoneRequired).changed.join() === "screen:1", JSON.stringify(S.diffSteps(steps, phoneRequired)));

    // The business's own order: questions before the time, a titled contact screen, a conditional field on a shared screen.
    const own: import("../../../lib/booking/types").FlowStep[] = [
      { kind: "service" },
      { kind: "questions", screen: 2 },
      { kind: "questions", screen: 1, title: "About you" },
      { kind: "time" },
      { kind: "provider" },
      { kind: "review" },
    ];
    const ownFields = fields.map((f) => (f.key === "allergies" ? { ...f, screen: 2 } : f));
    const ownSteps = S.describeBookingSteps({ ...flow, rules: { ...flow.rules, flow: own } }, ownFields);
    check("A14 the flow's own order is kept: service → options → guests screen → contact screen → time → provider → review",
      ownSteps.map((s) => s.id).join(",") === "service,options,screen:2,screen:1,time,provider,review", ownSteps.map((s) => s.id).join(","));
    check("A15 a flow step's title names the screen; a conditional field on a shared screen keeps its note",
      ownSteps[3].title === "About you" && /Any allergies\? · a few lines · only when "guests" is answered/.test(ownSteps[2].detail), `${ownSteps[3].title} | ${ownSteps[2].detail}`);
    const noStaff = S.describeBookingSteps({ ...flow, staff: [] }, fields);
    check("A16 no providers on file drops the provider step even when selection is optional", !noStaff.some((s) => s.kind === "provider"));
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
    const seen = { system: [] as string[], messages: [] as unknown[][], tools: [] as ToolDef[], calls: 0 };
    const result = await C.editBookingForm({ userId, message, history }, { client: scriptedClient(turns, seen) as never });
    return { ...result, seen };
  };

  try {
    // ── C. Reading the form as the step sees it ──
    await A.setBookingEnabled(userId, true);
    // What the booking stage would have built for a salon: a generated form in
    // the business's own words — the contact details on one screen, tagged by
    // role, then one question on its own screen. (Turning booking on seeds
    // nothing the stage would keep; start from a clean catalog either way.)
    await prisma.appointmentField.deleteMany({ where: { userId } });
    const plan = [
      { key: "name", label: "Your name", type: "short_text", required: true, role: "name", screen: 1 },
      { key: "phone", label: "Your phone number", type: "phone", required: true, role: "phone", screen: 1 },
      { key: "notes", label: "Anything we should know before your visit?", type: "long_text", required: false, role: "notes", screen: 2 },
    ] as const;
    let written = 0;
    for (const f of plan) if ((await A.saveAppointmentField(userId, { ...f, config: {}, generated: true })) === null) written++;
    check("C1 the stage's generated form is on file", written === 3 && (await generatedCount()) === 3);
    await B.saveStaff(userId, { name: "Maya", role: "Stylist", bio: "" });

    const form = await C.bookingFormSummary(userId);
    check("C2 the summary carries the tenant's slug and that booking is on", form.slug === user.slug && form.enabled && form.flow !== null && !form.empty);
    check("C3 name and phone are fields on screen 1 with their roles; notes is on screen 2",
      form.fields.map((f) => `${f.key}:${f.role}:${f.screen}`).join() === "name:name:1,phone:phone:1,notes:notes:2", form.fields.map((f) => `${f.key}:${f.role}:${f.screen}`).join());
    check("C4 the steps: provider → time → the contact screen (titled by its labels) → notes → review (no services yet)",
      titles(form.steps) === "Choose who you'd like to see → Date and time → Your name*, Your phone number* → Anything we should know before your visit? → Review and confirm", titles(form.steps));
    const contactStep = form.steps.find((s) => s.kind === "screen")!;
    check("C5 the contact screen step lists the phone as required, with its type", contactStep.id === "screen:1" && /Your phone number\* · phone number/.test(contactStep.detail), contactStep.detail);
    const told = C.describeFormForModel(form);
    check("C6 the model is told every field under its step: key, type, requiredness, role and screen",
      /key notes: "Anything we should know before your visit\?" \(long_text, optional, role notes, screen 2\)/.test(told) &&
        /key phone: "Your phone number" \(phone, required, role phone, screen 1\)/.test(told) && /Maya/.test(told), told);
    check("C6b …and nothing about a details step or always-required fields", !/CUSTOMER DETAILS/.test(told) && !/always asked/.test(told) && !/Your details/.test(told), told);

    // ── D. A round of the chat changes the form for real and reads it back ──
    const d1 = await run("Ask how many guests are coming (up to 8), don't require the phone number, and ask for their email with the phone.", [
      {
        tools: [
          { name: "add_question", input: { label: "How many guests?", type: "number", required: true, min: 1, max: 8, after: "first" } },
          { name: "edit_question", input: { key: "phone", required: false, role: "phone" } },
          { name: "add_question", input: { label: "Your email", type: "email", required: true, role: "email", screen: "previous", after: "phone" } },
        ],
      },
      { text: "Added a guest count, made the phone number optional and added an email box beside it." },
    ]);
    check("D1 the reply is the model's own closing text", d1.reply === "Added a guest count, made the phone number optional and added an email box beside it.", d1.reply);
    check("D2 three changes are reported, in order",
      d1.changes.length === 3 && /Added the question “How many guests\?”/.test(d1.changes[0]) && /Changed “Your phone number”: now optional/.test(d1.changes[1]) && /Added the question “Your email” \(email\)/.test(d1.changes[2]), JSON.stringify(d1.changes));
    check("D3 the guest question is stored as a required number 1–8", (await A.getBookingConfig(userId)).fields.some((f) => f.key === "how_many_guests" && f.type === "number" && f.required && f.config.min === 1 && f.config.max === 8));
    check("D4 'after: first' asks it before the other questions; 'after: phone' puts the email right after the phone",
      d1.form.fields.map((f) => f.key).join() === "how_many_guests,name,phone,your_email,notes", d1.form.fields.map((f) => f.key).join());
    check("D5 the re-read form's steps show the guest count first, on a screen of its own, with its range",
      d1.form.steps.findIndex((s) => s.id === "q:how_many_guests") === 2 && d1.form.steps.some((s) => s.id === "q:how_many_guests" && s.detail === "a number from 1 to 8 · required"), titles(d1.form.steps));
    const phone = d1.form.fields.find((f) => f.key === "phone")!;
    const email = d1.form.fields.find((f) => f.key === "your_email")!;
    check("D6 the phone field is still asked, no longer required, its role kept", phone.required === false && phone.role === "phone" && phone.screen === 1, JSON.stringify(phone));
    check("D6b the email field carries role email and 'previous' put it on the phone's screen", email.role === "email" && email.screen === 1 && email.required, JSON.stringify(email));
    check("D6c the contact screen step now lists all three", /Your name\*, Your phone number, Your email\*/.test(d1.form.steps.find((s) => s.id === "screen:1")!.title), titles(d1.form.steps));
    check("D7 a chat edit is an admin edit: the form is the owner's now (no question stays generated)", (await generatedCount()) === 0);
    check("D8 the loop ended after the closing turn (2 model calls)", d1.seen.calls === 2, String(d1.seen.calls));
    check("D9 the system prompt carried the form as it stood before the change", /key notes:/.test(d1.seen.system[0]) && !/how_many_guests/.test(d1.seen.system[0]));
    const toolNames = d1.seen.tools.map((t) => t.name);
    const addQ = d1.seen.tools.find((t) => t.name === "add_question")!;
    const editQ = d1.seen.tools.find((t) => t.name === "edit_question")!;
    check("D10 the model has no set_customer_field tool; the question tools take role (the FIELD_ROLES) and screen",
      !toolNames.includes("set_customer_field") && ["add_question", "edit_question", "remove_question", "reorder_questions", "set_staff_selection", "set_confirmation", "add_service", "edit_service", "remove_service"].every((n) => toolNames.includes(n)) &&
        addQ.input_schema.properties?.role?.enum?.join() === "none,name,first_name,last_name,email,phone,notes,policy" && "screen" in (addQ.input_schema.properties ?? {}) &&
        editQ.input_schema.properties?.role?.enum?.length === 8 && "screen" in (editQ.input_schema.properties ?? {}),
      toolNames.join());

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

    const guestScreen = e2.form.fields.find((f) => f.key === "how_many_guests")!.screen;
    const e3 = await run("Ask for a photo of the problem, and ask about allergies only when they bring guests — on the same screen as the guest count.", [
      {
        tools: [
          { name: "add_question", input: { label: "A photo of the problem", type: "photo" } },
          { name: "add_question", input: { label: "Any allergies in the party?", type: "long_text", showIfKey: "how_many_guests", screen: guestScreen } },
          { name: "reorder_questions", input: { keys: ["a_photo_of_the_problem", "how_many_guests"] } },
        ],
      },
      { text: "Added both." },
    ]);
    check("E9 a photo question and a conditional question are added", e3.form.fields.some((f) => f.key === "a_photo_of_the_problem" && f.type === "photo") && e3.form.fields.some((f) => f.key === "any_allergies_in_the_party" && f.config.showIf?.key === "how_many_guests"));
    check("E10 reorder puts the named keys first and keeps the rest after", e3.form.fields.map((f) => f.key).join() === "a_photo_of_the_problem,how_many_guests,name,phone,your_email,any_allergies_in_the_party", e3.form.fields.map((f) => f.key).join());
    const allergies = e3.form.fields.find((f) => f.key === "any_allergies_in_the_party")!;
    const guestStep = e3.form.steps.find((s) => s.id === `screen:${guestScreen}`);
    check("E11 a numeric screen puts the question on that screen: the guest screen is now one step with both fields, the condition noted",
      allergies.screen === guestScreen && !!guestStep && guestStep.fields?.map((f) => f.key).join() === "how_many_guests,any_allergies_in_the_party" && /only when "how_many_guests" is answered/.test(guestStep.detail), titles(e3.form.steps));
    check("E12 a new question with no screen gets a screen of its own", e3.form.steps.some((s) => s.id === "q:a_photo_of_the_problem"), titles(e3.form.steps));

    const e4 = await run("Ask for the email on its own screen.", [
      { tools: [{ name: "edit_question", input: { key: "your_email", screen: "new" } }] },
      { text: "The email has its own screen now." },
    ]);
    const emailNow = e4.form.fields.find((f) => f.key === "your_email")!;
    check("E13 screen 'new' moves a question to a screen of its own, the change says so, and the contact screen shrinks",
      emailNow.screen > guestScreen && emailNow.role === "email" && /moved to screen/.test(e4.changes[0]) &&
        e4.form.steps.some((s) => s.id === "q:your_email") && e4.form.steps.find((s) => s.id === "screen:1")!.title === "Your name*, Your phone number",
      `${JSON.stringify(emailNow)} | ${titles(e4.form.steps)}`);

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
    check("F8 turning booking on from the step brings the form back", on.enabled && on.steps.length > 0 && !on.empty);

    await prisma.appointmentField.deleteMany({ where: { userId } });
    const bare = await C.bookingFormSummary(userId);
    check("F9 a form with no fields is `empty`: only the engine steps remain, and the model is told there are no questions yet",
      bare.empty && bare.fields.length === 0 && bare.steps.map((s) => s.kind).join() === "service,time,review" && /no questions yet/.test(C.describeFormForModel(bare)), `${titles(bare.steps)} | ${C.describeFormForModel(bare)}`);
    const f5 = await run("Ask for their name and email.", [
      {
        tools: [
          { name: "add_question", input: { label: "Full name", type: "short_text", required: true, role: "name", screen: "new" } },
          { name: "add_question", input: { label: "Email address", type: "email", required: true, role: "email", screen: "previous" } },
        ],
      },
      { text: "Added name and email." },
    ]);
    check("F10 on an empty form 'new' then 'previous' build one contact screen from nothing",
      f5.form.fields.map((f) => `${f.key}:${f.role}:${f.screen}`).join() === "full_name:name:1,email_address:email:1" && !f5.form.empty && f5.form.steps.some((s) => s.id === "screen:1" && s.title === "Full name*, Email address*"),
      f5.form.fields.map((f) => `${f.key}:${f.role}:${f.screen}`).join());
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
