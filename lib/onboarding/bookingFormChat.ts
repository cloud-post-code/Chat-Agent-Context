import { str as strMax } from "@/lib/util/text";
import type Anthropic from "@anthropic-ai/sdk";
import { claude, claudeModel } from "@/lib/claude";
import type { ModelClient, Msg } from "@/lib/brain";
import { prisma } from "@/lib/db";
import {
  deleteAppointmentField,
  getBookingConfig,
  reorderAppointmentFields,
  saveAppointmentField,
  setBookingEnabled,
} from "@/lib/appointments";
import {
  FIELD_ROLES,
  FIELD_TYPES,
  isChoiceType,
  isFieldRole,
  keyFromLabel,
  type AppointmentFieldRow,
  type FieldConfig,
  type FieldRole,
} from "@/lib/appointmentTypes";
import {
  deleteService,
  getBookingFlow,
  getBookingSettings,
  listServices,
  saveBookingSettings,
  saveService,
} from "@/lib/booking/store";
import { pricingFromText, pricingLabel, sanitizeFlow, type FlowStep } from "@/lib/booking/types";
import { describeBookingSteps, type BookingFormSummary } from "@/lib/booking/steps";

/**
 * The onboarding chat's booking-form editor: the owner tries the form the
 * services stage built, says in plain words what is missing or wrong, and the
 * model changes the form for real through the same store the Booking panels
 * write to — questions (contact details among them, told apart by their
 * `role`), which questions share a screen, the order of the steps and of the
 * questions, screen titles, who-do-you-want-to-see, services — then the form
 * is read back and shown again. Sibling of
 * lib/adminBrain.ts (same injectable ModelClient, same bounded tool loop);
 * nothing here knows about HTTP.
 *
 * Every write goes through the real store, so a chat edit is an admin edit:
 * the form stops being onboarding's to rebuild (claimForm), exactly as if it
 * had been changed under Booking › Questions.
 */

export type FormChatInput = { userId: string; message: string; history?: Msg[] };
export type FormChatDeps = { client?: ModelClient };
export type FormChatResult = {
  /** What the assistant says back, one or two sentences. */
  reply: string;
  /** One line per change made, in order. Empty when nothing changed. */
  changes: string[];
  /** The form after the changes. */
  form: BookingFormSummary;
};

/** The form as the onboarding step reads it: the live flow, every field, the step list. */
export async function bookingFormSummary(userId: string): Promise<BookingFormSummary> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { slug: true } });
  const result = await getBookingFlow(userId);
  const flow = result?.flow ?? null;
  const fields = result?.fields ?? [];
  return {
    slug: user?.slug ?? "",
    enabled: result !== null,
    flow,
    fields,
    empty: fields.length === 0,
    steps: describeBookingSteps(flow, fields),
  };
}

/** Turn booking on and read the form back (which may be empty: turning on seeds nothing). */
export async function enableBookingForm(userId: string): Promise<BookingFormSummary> {
  await setBookingEnabled(userId, true);
  return bookingFormSummary(userId);
}

// ── What the model is told ───────────────────────────────────────────────────

/** One field as the model is told it: its key, wording, type, role, screen and extras. */
function describeField(f: AppointmentFieldRow): string {
  const opts = f.config.options?.length ? `, options: ${f.config.options.map((o) => o.label).slice(0, 12).join(" | ")}${f.config.options.length > 12 ? " | …" : ""}` : "";
  const range = f.type === "number" && (f.config.min !== undefined || f.config.max !== undefined) ? `, ${f.config.min ?? 0}–${f.config.max ?? "∞"}` : "";
  const when = f.config.showIf ? `, only when ${f.config.showIf.key}${f.config.showIf.values.length ? ` is ${f.config.showIf.values.join("/")}` : " is answered"}` : "";
  const placeholder = f.config.placeholder ? `, placeholder: ${JSON.stringify(f.config.placeholder)}` : "";
  return `- key ${f.key}: "${f.label}" (${f.type}, ${f.required ? "required" : "optional"}, role ${f.role}, screen ${f.screen}${opts}${range}${when}${placeholder})`;
}

/** The current form, in text the model can act on: every id and key it may name. */
export function describeFormForModel(form: BookingFormSummary): string {
  if (!form.flow) return "Booking is OFF for this business — there is no form yet.";
  const { flow, fields } = form;
  const services = flow.services.length
    ? flow.services
        .map((s) => `- id ${s.id}: ${s.name}${s.category ? ` [${s.category}]` : ""} — ${pricingLabel(s.pricing)}, ${s.durationMinutes} min`)
        .join("\n")
    : "(none — the form has no service step)";
  const staff = flow.staff.length ? flow.staff.map((s) => s.name).join(", ") : "(none)";
  const byKey = new Map(fields.map((f) => [f.key, f]));
  // Every step with its id, so the model can name it: `1. [service] Pick a
  // service`, `4. [screen:1] "How do we say hello?" — first_name*, phone*, email`.
  const order = form.steps
    .map((s, i) => {
      const keys = s.kind === "question" && s.question ? [s.question.key] : s.kind === "screen" ? (s.fields ?? []).map((f) => f.key) : [];
      const rows = keys.map((k) => byKey.get(k)).filter((f): f is AppointmentFieldRow => !!f);
      const lines = rows.map((f) => `  ${describeField(f)}`);
      const head =
        s.kind === "screen"
          ? `${i + 1}. [${s.id}] "${s.title}" — ${rows.map((f) => `${f.key}${f.required ? "*" : ""}`).join(", ")} (screen ${s.screen}, ${keys.length} questions together)`
          : s.kind === "question"
            ? `${i + 1}. [${s.id}] "${s.title}" (screen ${s.screen})`
            : `${i + 1}. [${s.id}] ${s.title}`;
      return [head, ...lines].join("\n");
    })
    .join("\n");
  return [
    `BUSINESS: ${flow.business.name || "(unnamed)"}`,
    `SERVICES:\n${services}`,
    `PROVIDERS a visitor can pick: ${staff}; provider choice is ${flow.rules.staffSelection}`,
    `Confirmation: ${flow.rules.confirmation === "request" ? "a request the business confirms" : "instant"}`,
    `THE FORM, step by step, in the order the visitor meets it (each step with its id in [brackets]; every question with its key under its step):\n${fields.length ? order : `${order}\n(no questions yet — the form asks nothing beyond the steps above)`}`,
  ].join("\n\n");
}

const SYSTEM_RULES = [
  "You are helping a business owner finish the booking form their customers will fill in on their",
  "agent page. They have just tried the form and are telling you what is missing, wrong or",
  "unnecessary. Make the change for real with the tools — do not describe what you would do, and",
  "do not ask permission for a change they plainly asked for. Then answer in one or two short",
  "sentences saying exactly what changed. They will see the updated form straight away.",
  "",
  "Rules:",
  "- Name, email and phone are ordinary questions with a `role` (name, first_name, last_name,",
  "  email, phone, notes, policy) so the calendar knows which answer is which; add or change them",
  "  with the question tools and set the role. Keep the owner's wording. Several questions can",
  "  share a screen (`screen`). Never add a question that asks for something the form already asks.",
  "- Anything else the owner wants to ask (party size, allergies, the pet's name, a preferred",
  "  stylist when there are no providers on file, an address, a waiver) is a question:",
  "  add_question / edit_question / remove_question / reorder_questions.",
  "- Pick the right type: a count is number (with a sensible min/max), a choice from a list is",
  "  select (or multi_select when several apply), yes/no is yes_no, a photo is photo, a signed",
  "  agreement is waiver with the text, an address is address, a longer answer is long_text.",
  "- Keep question labels short and written to the customer (\"How many guests?\").",
  "- Services: add_service / edit_service / remove_service. Use the price and duration the owner",
  "  gives; if they give none, leave the price out (it shows as \"varies\") rather than inventing one.",
  "- Providers: set_staff_selection changes whether visitors pick a person; adding people is done",
  "  under Booking › Providers — say so if asked.",
  "- The order is the owner's: `set_step_order` moves whole steps (by the ids in brackets),",
  "  `move_question` one question, `set_screen_title` names a screen.",
  "- If the form has no questions yet, the owner is describing it from scratch: create every",
  "  question they name, in the order given, all on ONE screen unless they say otherwise (set the",
  "  right role for name/email/phone), then ask at most ONE short question back.",
  "- Several changes in one message: make them all, in one go.",
  "- If a request is genuinely ambiguous, ask ONE short question and change nothing.",
  "- If something cannot be done from here (e.g. payments), say so in one sentence.",
  "- Never invent services, prices, staff or options the owner did not give you.",
].join("\n");

// ── Tools ────────────────────────────────────────────────────────────────────

const OPTION_SCHEMA = {
  type: "array",
  description: "For select / multi_select: the choices, in order. Price and duration only when the owner stated them.",
  items: {
    type: "object",
    properties: {
      label: { type: "string" },
      price: { type: "string", description: 'e.g. "$35", "from $40"' },
      duration: { type: "string", description: 'e.g. "45 min"' },
      group: { type: "string", description: "Section heading the option sits under" },
    },
    required: ["label"],
  },
} as const;

const QUESTION_PROPS = {
  label: { type: "string", description: "The question as the customer reads it" },
  type: { type: "string", enum: [...FIELD_TYPES] },
  required: { type: "boolean" },
  options: OPTION_SCHEMA,
  allowOther: { type: "boolean", description: "select / multi_select: also accept an answer not on the list" },
  min: { type: "integer", description: "number: smallest allowed" },
  max: { type: "integer", description: "number: largest allowed" },
  waiverText: { type: "string", description: "waiver: the text the customer agrees to" },
  showIfKey: { type: "string", description: "Ask only after this other question (its key) is answered…" },
  showIfValues: { type: "array", items: { type: "string" }, description: "…with one of these answers (empty = any answer)" },
  role: {
    type: "string",
    enum: [...FIELD_ROLES],
    description: "What the answer is to the business: name / first_name / last_name / email / phone for contact details, notes for special requests, policy for a policy agreement, none for anything else",
  },
  screen: {
    type: ["string", "integer"],
    description: 'Which screen the question is asked on: "new" = a screen of its own, "previous" = the same screen as the question before it in order (or the last screen), or a screen number the form already uses',
  },
} as const;

function formTools(): Anthropic.Tool[] {
  return [
    {
      name: "add_question",
      description: "Add a question to the booking form. Goes last unless `after` names the question to follow (or \"first\").",
      input_schema: {
        type: "object",
        properties: {
          ...QUESTION_PROPS,
          after: { type: "string", description: 'Key of the question this one follows, or "first" to ask it before all others' },
        },
        required: ["label", "type"],
      },
    },
    {
      name: "edit_question",
      description: "Change an existing question: its wording, type, whether it is required, its options, range, waiver text or condition. Only the fields given change.",
      input_schema: {
        type: "object",
        properties: { key: { type: "string", description: "The question's key" }, ...QUESTION_PROPS },
        required: ["key"],
      },
    },
    {
      name: "remove_question",
      description: "Remove a question from the form.",
      input_schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
    },
    {
      name: "reorder_questions",
      description: "Set the order the questions are asked in. Keys left out keep their place after the ones named.",
      input_schema: {
        type: "object",
        properties: { keys: { type: "array", items: { type: "string" }, description: "Every question key, in the new order" } },
        required: ["keys"],
      },
    },
    {
      name: "move_question",
      description: "Move one question in the order: before or after another question (by key), or first. The screen it is on does not change.",
      input_schema: {
        type: "object",
        properties: {
          key: { type: "string", description: "The question to move" },
          before: { type: "string", description: "Key of the question it should come before" },
          after: { type: "string", description: "Key of the question it should come after" },
          first: { type: "boolean", description: "true: ask it before all other questions" },
        },
        required: ["key"],
      },
    },
    {
      name: "set_screen_title",
      description: "Name a screen of questions: the heading the customer sees above the questions asked together on it.",
      input_schema: {
        type: "object",
        properties: {
          screen: { type: "integer", description: "The screen number (as the steps list it)" },
          title: { type: "string", description: "The heading, written to the customer; empty to remove it" },
        },
        required: ["screen", "title"],
      },
    },
    {
      name: "set_step_order",
      description: "Set the order of the whole form's steps by their ids: service, provider, location, time, screen:<n> (a screen of questions; q:<key> also names the screen that question is on) and review. Steps left out keep their place after the named ones; review is always last.",
      input_schema: {
        type: "object",
        properties: {
          steps: { type: "array", items: { type: "string" }, description: "The step ids, in the new order" },
        },
        required: ["steps"],
      },
    },
    {
      name: "set_staff_selection",
      description: "Whether visitors choose a provider: hidden (never asked), optional (\"anyone available\" offered), required (must pick).",
      input_schema: {
        type: "object",
        properties: { mode: { type: "string", enum: ["hidden", "optional", "required"] } },
        required: ["mode"],
      },
    },
    {
      name: "set_confirmation",
      description: "instant: the booking is confirmed on the spot. request: the business confirms it afterwards.",
      input_schema: {
        type: "object",
        properties: { mode: { type: "string", enum: ["instant", "request"] } },
        required: ["mode"],
      },
    },
    {
      name: "add_service",
      description: "Add a bookable service. Price and duration only as the owner stated them.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          price: { type: "string", description: 'e.g. "$45", "from $60", "$40–80"; omit when not given' },
          durationMinutes: { type: "integer" },
          category: { type: "string" },
          description: { type: "string" },
        },
        required: ["name"],
      },
    },
    {
      name: "edit_service",
      description: "Change a service's name, price, duration, category or description. Only the fields given change.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          price: { type: "string" },
          durationMinutes: { type: "integer" },
          category: { type: "string" },
          description: { type: "string" },
        },
        required: ["id"],
      },
    },
    {
      name: "remove_service",
      description: "Remove a service from the booking menu.",
      input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
  ];
}

// ── Running a tool for real ──────────────────────────────────────────────────

const str = (v: unknown, max = 200): string => strMax(v, max);
const int = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v) : typeof v === "string" && /^-?\d+$/.test(v.trim()) ? Number(v) : undefined;

/** The config a question tool call describes, laid over what is stored (edit) or nothing (add). */
function configFrom(input: Record<string, unknown>, base: FieldConfig | undefined): FieldConfig | undefined {
  const touched = ["options", "allowOther", "min", "max", "waiverText", "showIfKey", "showIfValues"].some((k) => input[k] !== undefined);
  if (!touched) return base === undefined ? {} : undefined;
  const out: FieldConfig = { ...(base ?? {}) };
  delete out.generated;
  if (input.options !== undefined) {
    out.options = (Array.isArray(input.options) ? input.options : []).map((o) =>
      typeof o === "string" ? { label: o } : ((o ?? {}) as Record<string, unknown>),
    ) as FieldConfig["options"];
  }
  if (input.allowOther !== undefined) out.allowOther = input.allowOther === true;
  if (input.min !== undefined) out.min = int(input.min);
  if (input.max !== undefined) out.max = int(input.max);
  if (input.waiverText !== undefined) out.text = str(input.waiverText, 4000);
  if (input.showIfKey !== undefined) {
    const key = str(input.showIfKey, 60);
    if (key) {
      out.showIf = { key, values: (Array.isArray(input.showIfValues) ? input.showIfValues : []).map((v) => str(v, 120)).filter(Boolean) };
    } else {
      delete out.showIf;
    }
  } else if (input.showIfValues !== undefined && out.showIf) {
    out.showIf = { ...out.showIf, values: (Array.isArray(input.showIfValues) ? input.showIfValues : []).map((v) => str(v, 120)).filter(Boolean) };
  }
  return out;
}

type Outcome = { result: string; change?: string };

/** The role a question tool call names, or undefined to keep what is stored. */
const roleFrom = (v: unknown): FieldRole | undefined => (isFieldRole(v) ? v : undefined);

/**
 * The screen a question tool call asks for, as a number: "new" is a screen
 * of its own (one past the highest in use), "previous" is the screen of the
 * question before `at` in order (or the last screen when nothing is before
 * it), a number is that screen. Undefined keeps what is stored (or, on
 * create, a screen of its own).
 */
function screenFrom(v: unknown, fields: ReadonlyArray<Pick<AppointmentFieldRow, "screen">>, at: number): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const top = fields.reduce((m, f) => Math.max(m, f.screen), 0);
  if (v === "new") return top + 1;
  if (v === "previous") {
    const before = at > 0 ? fields[at - 1] : fields[fields.length - 1];
    return before?.screen ?? top + 1;
  }
  const n = int(v);
  return n !== undefined && n >= 1 ? n : undefined;
}

/**
 * The flow step a step id names: `service|provider|location|time|review`,
 * `screen:<n>`, or `q:<key>` for the screen that question is on; a screen's
 * (or review's) title is carried over from the current flow. Null for an id
 * that names nothing (`options`, an unknown key, a screen with no field).
 */
function flowStepFromId(id: string, fields: ReadonlyArray<Pick<AppointmentFieldRow, "key" | "screen">>, current: FlowStep[]): FlowStep | null {
  if (id === "service" || id === "provider" || id === "location" || id === "time" || id === "review") {
    return current.find((s) => s.kind === id) ?? { kind: id };
  }
  const screen = id.startsWith("screen:") ? int(id.slice(7)) : id.startsWith("q:") ? fields.find((f) => f.key === id.slice(2))?.screen : undefined;
  if (screen === undefined || !fields.some((f) => f.screen === screen)) return null;
  return current.find((s) => s.kind === "questions" && s.screen === screen) ?? { kind: "questions", screen };
}

async function execute(userId: string, name: string, input: Record<string, unknown>): Promise<Outcome> {
  switch (name) {
    case "add_question": {
      const label = str(input.label, 120);
      const type = (FIELD_TYPES as readonly string[]).includes(String(input.type)) ? String(input.type) : "short_text";
      if (!label) return { result: "The question needs a label; nothing added." };
      const key = keyFromLabel(label);
      const { fields } = await getBookingConfig(userId);
      if (fields.some((f) => f.key === key)) return { result: `A question with key "${key}" already exists — use edit_question.` };
      const config = configFrom(input, undefined) ?? {};
      if (isChoiceType(type) && !config.options?.length) return { result: "A select question needs its options; nothing added." };
      const after = str(input.after, 60);
      const keys = fields.map((f) => f.key);
      // Where it lands in order: after the named question, first, or last.
      const at = after === "first" ? 0 : after && keys.includes(after) ? keys.indexOf(after) + 1 : fields.length;
      const role = roleFrom(input.role);
      const screen = screenFrom(input.screen, fields, at);
      const err = await saveAppointmentField(userId, { key, label, type, required: input.required === true, config, role, screen });
      if (err) return { result: err };
      if (at < fields.length) {
        keys.splice(at, 0, key);
        await reorderAppointmentFields(userId, keys);
      }
      const extras = [role && role !== "none" ? `role ${role}` : "", screen !== undefined ? `screen ${screen}` : ""].filter(Boolean);
      return {
        result: `Added question "${label}" (key ${key}${extras.length ? `, ${extras.join(", ")}` : ""}).`,
        change: `Added the question “${label}”${role && role !== "none" ? ` (${role.replace("_", " ")})` : ""}`,
      };
    }
    case "edit_question": {
      const key = str(input.key, 60);
      const { fields } = await getBookingConfig(userId);
      const cur = fields.find((f) => f.key === key);
      if (!cur) return { result: `No question with key "${key}".` };
      const label = str(input.label, 120) || cur.label;
      const type = input.type !== undefined && (FIELD_TYPES as readonly string[]).includes(String(input.type)) ? String(input.type) : cur.type;
      const required = typeof input.required === "boolean" ? input.required : cur.required;
      const config = configFrom(input, cur.config) ?? (type === cur.type ? undefined : { ...cur.config, generated: undefined });
      if (isChoiceType(type) && !(config ?? cur.config).options?.length) return { result: "A select question needs its options; nothing changed." };
      const role = roleFrom(input.role);
      const screen = screenFrom(input.screen, fields, fields.indexOf(cur));
      const err = await saveAppointmentField(userId, { key, label, type, required, config, role, screen });
      if (err) return { result: err };
      const what = [
        label !== cur.label ? `reworded to “${label}”` : "",
        type !== cur.type ? `now ${type.replace("_", " ")}` : "",
        required !== cur.required ? (required ? "now required" : "now optional") : "",
        config !== undefined ? "options updated" : "",
        role !== undefined && role !== cur.role ? `now the ${role === "none" ? "answer to an ordinary question" : role.replace("_", " ")}` : "",
        screen !== undefined && screen !== cur.screen ? `moved to screen ${screen}` : "",
      ].filter(Boolean);
      return { result: `Updated "${label}".`, change: `Changed “${cur.label}”${what.length ? `: ${what.join(", ")}` : ""}` };
    }
    case "remove_question": {
      const key = str(input.key, 60);
      const { fields } = await getBookingConfig(userId);
      const cur = fields.find((f) => f.key === key);
      if (!cur) return { result: `No question with key "${key}".` };
      await deleteAppointmentField(userId, key);
      return { result: `Removed "${cur.label}".`, change: `Removed the question “${cur.label}”` };
    }
    case "reorder_questions": {
      const keys = (Array.isArray(input.keys) ? input.keys : []).map((k) => str(k, 60)).filter(Boolean);
      if (!keys.length) return { result: "No keys given; order unchanged." };
      await reorderAppointmentFields(userId, keys);
      return { result: "Questions reordered.", change: "Reordered the questions" };
    }
    case "move_question": {
      const key = str(input.key, 60);
      const { fields } = await getBookingConfig(userId);
      const cur = fields.find((f) => f.key === key);
      if (!cur) return { result: `No question with key "${key}".` };
      const keys = fields.map((f) => f.key).filter((k) => k !== key);
      const before = str(input.before, 60);
      const after = str(input.after, 60);
      let at: number;
      if (input.first === true) at = 0;
      else if (before && keys.includes(before)) at = keys.indexOf(before);
      else if (after && keys.includes(after)) at = keys.indexOf(after) + 1;
      else return { result: "Say where it goes: before or after which question (by key), or first. Nothing moved." };
      keys.splice(at, 0, key);
      await reorderAppointmentFields(userId, keys);
      const where = at === 0 ? "first" : `after “${fields.find((f) => f.key === keys[at - 1])?.label ?? keys[at - 1]}”`;
      return { result: `Moved "${cur.label}" ${where}.`, change: `Moved the question “${cur.label}” ${where}` };
    }
    case "set_screen_title": {
      const screen = int(input.screen);
      const title = str(input.title, 120);
      const { fields } = await getBookingConfig(userId);
      if (screen === undefined || !fields.some((f) => f.screen === screen)) return { result: `No screen ${input.screen} — the screens in use are ${[...new Set(fields.map((f) => f.screen))].join(", ") || "none"}.` };
      const settings = await getBookingSettings(userId);
      const flow = sanitizeFlow(settings.flow, fields).map((s): FlowStep => {
        if (s.kind !== "questions" || s.screen !== screen) return s;
        const named: FlowStep = { kind: s.kind, screen: s.screen };
        return title ? { ...named, title } : named;
      });
      await saveBookingSettings(userId, { flow });
      return title
        ? { result: `Screen ${screen} is now titled "${title}".`, change: `Titled screen ${screen} “${title}”` }
        : { result: `Screen ${screen} has no title now.`, change: `Removed the title of screen ${screen}` };
    }
    case "set_step_order": {
      const ids = (Array.isArray(input.steps) ? input.steps : []).map((k) => str(k, 60)).filter(Boolean);
      if (!ids.length) return { result: "No step ids given; order unchanged." };
      const { fields } = await getBookingConfig(userId);
      const settings = await getBookingSettings(userId);
      const current = sanitizeFlow(settings.flow, fields);
      const named: FlowStep[] = [];
      for (const id of ids) {
        const step = flowStepFromId(id, fields, current);
        if (step) named.push(step);
      }
      if (!named.length) return { result: "None of those ids name a step; order unchanged. Use the ids in brackets in the step list." };
      // Unknown ids are ignored; steps left out are appended (engine steps, then
      // unmentioned screens, then review) by sanitizeFlow, keeping their titles.
      const flow = sanitizeFlow([...named, ...current], fields);
      await saveBookingSettings(userId, { flow });
      return { result: `Steps reordered: ${flow.map((s) => (s.kind === "questions" ? `screen:${s.screen}` : s.kind)).join(" → ")}.`, change: "Reordered the form's steps" };
    }
    case "set_staff_selection": {
      const mode = str(input.mode, 10);
      if (mode !== "hidden" && mode !== "optional" && mode !== "required") return { result: "Mode must be hidden, optional or required." };
      await saveBookingSettings(userId, { staffSelection: mode });
      const words = { hidden: "Visitors no longer pick a provider", optional: "Visitors may pick a provider or anyone available", required: "Visitors must pick a provider" };
      return { result: words[mode] + ".", change: words[mode] };
    }
    case "set_confirmation": {
      const mode = str(input.mode, 10);
      if (mode !== "instant" && mode !== "request") return { result: "Mode must be instant or request." };
      await saveBookingSettings(userId, { confirmation: mode, confirmationOwner: true });
      const line = mode === "request" ? "Bookings are now requests you confirm" : "Bookings are now confirmed on the spot";
      return { result: line + ".", change: line };
    }
    case "add_service": {
      const name = str(input.name, 200);
      if (!name) return { result: "A service needs a name; nothing added." };
      const price = str(input.price, 40);
      const saved = await saveService(userId, {
        name,
        category: str(input.category, 60),
        description: str(input.description, 2000),
        pricing: price ? pricingFromText(price) : { kind: "variable" },
        durationMinutes: int(input.durationMinutes) ?? (await getBookingSettings(userId)).defaultDurationMinutes,
      });
      if (!saved.ok) return { result: saved.error };
      return { result: `Added service "${name}" (id ${saved.id}).`, change: `Added the service “${name}”${price ? ` at ${price}` : ""}` };
    }
    case "edit_service": {
      const id = str(input.id, 80);
      const cur = (await listServices(userId)).find((s) => s.id === id);
      if (!cur) return { result: `No service with id "${id}".` };
      const price = str(input.price, 40);
      const patch: Parameters<typeof saveService>[1] = { id, name: str(input.name, 200) || cur.name };
      if (price) patch.pricing = pricingFromText(price);
      if (int(input.durationMinutes) !== undefined) patch.durationMinutes = int(input.durationMinutes);
      if (input.category !== undefined) patch.category = str(input.category, 60);
      if (input.description !== undefined) patch.description = str(input.description, 2000);
      const saved = await saveService(userId, patch);
      if (!saved.ok) return { result: saved.error };
      return { result: `Updated service "${patch.name}".`, change: `Changed the service “${cur.name}”` };
    }
    case "remove_service": {
      const id = str(input.id, 80);
      const cur = (await listServices(userId)).find((s) => s.id === id);
      if (!cur) return { result: `No service with id "${id}".` };
      await deleteService(userId, id);
      return { result: `Removed service "${cur.name}".`, change: `Removed the service “${cur.name}”` };
    }
    default:
      return { result: `Unknown tool "${name}".` };
  }
}

// ── The loop ─────────────────────────────────────────────────────────────────

const MAX_TURNS = 4;

/**
 * One round of the form chat: the owner's message in, the form changed for
 * real, the reply and the re-read form out. Never throws: a model failure
 * comes back as a reply that says so, with the form unchanged.
 */
export async function editBookingForm(input: FormChatInput, deps: FormChatDeps = {}): Promise<FormChatResult> {
  const { userId, message, history = [] } = input;
  const changes: string[] = [];
  let reply = "";

  try {
    const client: ModelClient = deps.client ?? claude();
    const before = await bookingFormSummary(userId);
    const system = `${SYSTEM_RULES}\n\nTHE FORM RIGHT NOW:\n${describeFormForModel(before)}`;
    const tools = formTools();
    const convo: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
    convo.push({ role: "user", content: message });

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const stream = client.messages.stream({ model: claudeModel(), max_tokens: 1024, system, tools, messages: convo });
      for await (const _event of stream) {
        // Text is read from the final message; nothing streams to the owner.
      }
      const final = await stream.finalMessage();
      const content = final.content as Anthropic.ContentBlock[];
      reply = content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      const toolUses = content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (!toolUses.length) break;

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        let outcome: Outcome;
        try {
          outcome = await execute(userId, tu.name, (tu.input ?? {}) as Record<string, unknown>);
        } catch (e) {
          outcome = { result: `That change failed: ${e instanceof Error ? e.message : String(e)}` };
        }
        if (outcome.change) changes.push(outcome.change);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: outcome.result });
      }
      convo.push({ role: "assistant", content });
      convo.push({ role: "user", content: results });
      // The loop ran out of turns mid-work: still say what was done.
      if (turn === MAX_TURNS - 1) reply = "";
    }
  } catch (e) {
    reply =
      e instanceof Error && e.message.includes("ANTHROPIC_API_KEY")
        ? "The form editor isn't configured yet (missing API key) — you can still change the form under Booking › Questions."
        : "Something went wrong reaching the model. Nothing was changed.";
  }

  if (!reply) {
    reply = changes.length
      ? `Done — ${changes.map((c) => c[0].toLowerCase() + c.slice(1)).join("; ")}. Here's the updated form.`
      : "I didn't change anything. Tell me what to add, remove or reword.";
  }
  const form = await bookingFormSummary(userId);
  return { reply, changes, form };
}
