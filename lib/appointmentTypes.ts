/**
 * The appointment shapes, with no imports.
 *
 * These live apart from lib/appointments.ts because the admin Calendar is a
 * client component: importing the shapes from the store would pull Prisma and
 * the Anthropic SDK (via the retrieval indexer) into the client bundle and
 * break the build. Types alone are erased at compile time, but FIELD_TYPES is
 * a real value the field editor renders its <select> from, so it has to come
 * from somewhere the client can safely reach.
 *
 * The pure rules of a question also live here — what a config may hold, how a
 * menu line is written, what a price adds up to, whether an answer is one the
 * question allows — because three places must agree on them: the wizard that
 * draws the question, the server that re-validates the answer, and the admin
 * editor that writes the config.
 */

export const FIELD_TYPES = [
  "short_text",
  "long_text",
  "email",
  "phone",
  // Pick one / pick any from the question's own options — a menu when the
  // options carry prices.
  "select",
  "multi_select",
  // A count: party size, number of guests, how many rooms.
  "number",
  "yes_no",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const isChoiceType = (t: string): t is "select" | "multi_select" =>
  t === "select" || t === "multi_select";

/**
 * One thing a visitor can pick. Price and duration are the business's own
 * words ("$35", "$40+", "from £25", "45 min") — text, not numbers, because a
 * small business's menu is full of ranges and "and up", and a number would
 * claim a precision the menu never had.
 */
export type FieldOption = {
  label: string;
  price?: string;
  duration?: string;
  description?: string;
  /** Menu section ("Manicures", "Add-ons"); options sharing one are drawn together. */
  group?: string;
};

export type FieldConfig = {
  /** select / multi_select only. */
  options?: FieldOption[];
  /** select / multi_select: also accept an answer that isn't on the list. */
  allowOther?: boolean;
  /** number only; whole numbers. */
  min?: number;
  max?: number;
  /** Onboarding wrote this question and nobody has edited the form since —
   *  so onboarding may rebuild it. Stored only; never accepted from a caller. */
  generated?: boolean;
};

export type AppointmentFieldRow = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  order: number;
  config: FieldConfig;
};

export type BookingConfig = { enabled: boolean; fields: AppointmentFieldRow[] };

/** The key a label becomes. One rule, because the planner must see a key
 *  collision before the store's upsert silently overwrites a question. */
export const keyFromLabel = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);

const MAX_OPTIONS = 60;
const MAX_PICKS = 20;
const OTHER_ANSWER_CAP = 200;

const flat = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

/**
 * Anything → a config this field type can actually use. Never throws: the
 * input is stored JSON, a posted admin form, or model output. Options on a
 * text question, or a max on a menu, are dropped rather than carried along as
 * dead weight the next reader has to second-guess.
 */
export function sanitizeFieldConfig(type: string, raw: unknown): FieldConfig {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  if (isChoiceType(type)) {
    const options: FieldOption[] = [];
    const seen = new Set<string>();
    for (const o of Array.isArray(src.options) ? src.options : []) {
      if (options.length >= MAX_OPTIONS) break;
      const item = typeof o === "string" ? { label: o } : ((o ?? {}) as Record<string, unknown>);
      const label = flat(item.label, 120);
      // Labels are how an answer names its option, so two alike can't coexist.
      if (!label || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      const opt: FieldOption = { label };
      const price = flat(item.price, 40);
      const duration = flat(item.duration, 40);
      const description = flat(item.description, 300);
      const group = flat(item.group, 60);
      if (price) opt.price = price;
      if (duration) opt.duration = duration;
      if (description) opt.description = description;
      if (group) opt.group = group;
      options.push(opt);
    }
    return { options, allowOther: src.allowOther === true };
  }

  if (type === "number") {
    const int = (v: unknown) =>
      typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= 1_000_000 ? v : undefined;
    const min = int(src.min);
    const max = int(src.max);
    const out: FieldConfig = {};
    if (min !== undefined) out.min = min;
    // A max below the min would make the question unanswerable; drop it.
    if (max !== undefined && (min === undefined || max >= min)) out.max = max;
    return out;
  }

  return {};
}

export function parseFieldConfig(type: string, json: string | null | undefined): FieldConfig {
  try {
    const stored = JSON.parse(json || "{}");
    const config = sanitizeFieldConfig(type, stored);
    return stored?.generated === true ? { ...config, generated: true } : config;
  } catch {
    return sanitizeFieldConfig(type, {});
  }
}

/**
 * The admin's way of writing a menu: one option per line, the way a price
 * list reads, with a "# Section" line starting a group.
 *
 *   # Manicures
 *   Gel Manicure | $35 | 45 min | Includes removal
 *
 * Price and duration may be left out or swapped — a part that reads as a
 * length of time is the duration, the other short one is the price.
 */
export function parseOptionLines(text: string): FieldOption[] {
  const options: FieldOption[] = [];
  let group = "";
  for (const line of String(text ?? "").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("#")) {
      group = t.replace(/^#+\s*/, "");
      continue;
    }
    const [label, ...rest] = t.split("|").map((p) => p.trim());
    if (!label) continue;
    let price = "";
    let duration = "";
    let description = "";
    for (const part of rest) {
      if (!part) continue;
      if (!price && looksLikePrice(part)) price = part;
      else if (!duration && looksLikeDuration(part)) duration = part;
      else if (!description) description = part;
    }
    const opt: FieldOption = { label };
    if (price) opt.price = price;
    if (duration) opt.duration = duration;
    if (description) opt.description = description;
    if (group) opt.group = group;
    options.push(opt);
  }
  return options;
}

// Short and unmistakable, so a description that merely mentions a number
// ("Includes 2 coats") stays a description.
const looksLikePrice = (s: string) =>
  s.length <= 40 && (/^free$/i.test(s) || /\p{Sc}/u.test(s) || /^\d[\d,.]*\s*\+?$/.test(s));
const looksLikeDuration = (s: string) =>
  s.length <= 20 && !/\p{Sc}/u.test(s) && durationMinutes(s) !== null;

/** The inverse of parseOptionLines — what the admin textarea is filled with. */
export function formatOptionLines(options: FieldOption[] | undefined): string {
  const lines: string[] = [];
  let group = "";
  for (const o of options ?? []) {
    const g = o.group ?? "";
    if (g !== group) {
      // An ungrouped option after a grouped one needs a header too, or it
      // would read back as part of the section above it.
      lines.push(`# ${g}`);
      group = g;
    }
    const parts = [o.label, o.price ?? "", o.duration ?? "", o.description ?? ""];
    while (parts.length > 1 && !parts[parts.length - 1]) parts.pop();
    lines.push(parts.join(" | "));
  }
  return lines.join("\n");
}

/**
 * The number inside a price, and whether the price is exactly that number.
 * "$35" is exact; "$35+", "from $35" and "$35–50" are a floor. Null when the
 * text holds no amount at all ("varies", "call us").
 */
export function priceAmount(price?: string): { amount: number; exact: boolean; symbol: string } | null {
  const text = (price ?? "").trim();
  if (!text) return null;
  if (/^free$/i.test(text)) return { amount: 0, exact: true, symbol: "" };
  const m = text.match(/(\p{Sc})?\s*(\d[\d,]*(?:\.\d{1,2})?)/u);
  if (!m) return null;
  const amount = Number.parseFloat(m[2].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  return { amount, exact: /^\p{Sc}?\s*\d[\d,]*(?:\.\d{1,2})?$/u.test(text), symbol: m[1] ?? "" };
}

/** Minutes in "45 min", "1 hr", "1h 30m", "1.5 hours"; null when it isn't a length of time. */
export function durationMinutes(duration?: string): number | null {
  const text = (duration ?? "").trim().toLowerCase();
  if (!text) return null;
  const h = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  const m = text.match(/(\d+)\s*(?:minutes?|mins?|m)\b/);
  if (!h && !m) return null;
  return Math.round((h ? Number.parseFloat(h[1]) * 60 : 0) + (m ? Number.parseInt(m[1], 10) : 0));
}

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return [h ? `${h} hr` : "", m || !h ? `${m} min` : ""].filter(Boolean).join(" ");
}

/**
 * What a set of picks adds up to. A trailing "+" marks a floor: some pick was
 * priced "from", or carries no price at all, so the real figure is at least
 * this. Null when nothing picked has a price (or a duration) to add.
 */
export function selectionTotal(picks: FieldOption[]): { price: string | null; duration: string | null } {
  let sum = 0;
  let priced = 0;
  let floor = false;
  let symbol = "";
  let minutes = 0;
  let timed = 0;
  for (const o of picks) {
    const p = priceAmount(o.price);
    if (p) {
      sum += p.amount;
      priced++;
      if (!p.exact) floor = true;
      if (!symbol) symbol = p.symbol;
    }
    const d = durationMinutes(o.duration);
    if (d !== null) {
      minutes += d;
      timed++;
    }
  }
  const amount = Number.isInteger(sum) ? String(sum) : sum.toFixed(2);
  return {
    price: priced ? `${symbol}${amount}${floor || priced < picks.length ? "+" : ""}` : null,
    duration: timed ? `${formatMinutes(minutes)}${timed < picks.length ? "+" : ""}` : null,
  };
}

/** "$35 · 45 min" — the facts that ride beside an option's name. */
export function optionFacts(o: FieldOption): string {
  return [o.price, o.duration].filter(Boolean).join(" · ");
}

const findOption = (config: FieldConfig, label: string) =>
  (config.options ?? []).find((o) => o.label.toLowerCase() === label.toLowerCase());

/**
 * A visitor's picks as option objects; a pick that isn't on the list (the
 * "something else" answer) comes back as a bare label with no price.
 */
export function pickedOptions(config: FieldConfig, picks: string[]): FieldOption[] {
  return picks.map((p) => findOption(config, p) ?? { label: p });
}

const asPicks = (raw: unknown): string[] => {
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of list) {
    const s = flat(typeof v === "number" ? String(v) : v, OTHER_ANSWER_CAP);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
};

export type ResolvedAnswer = { ok: true; value: string } | { ok: false; error: string };

/**
 * One submitted answer → the string that gets stored, or the reason it can't
 * be. The server's rule, exported so the wizard can show the same verdict
 * before the round trip. An empty value is "no answer"; whether that is
 * allowed is the caller's `required` check, not this function's.
 *
 * Picks are stored with the price the visitor was shown — "Gel Manicure ($35
 * · 45 min)" — because the menu can change after the booking and the owner
 * needs to see what was agreed to, not what the option costs today.
 */
export function resolveAnswer(
  field: Pick<AppointmentFieldRow, "label" | "type" | "config">,
  raw: unknown,
): ResolvedAnswer {
  const { type, config } = field;

  if (isChoiceType(type)) {
    const picks = asPicks(raw);
    if (!picks.length) return { ok: true, value: "" };
    if (type === "select" && picks.length > 1) return { ok: false, error: `Pick just one for "${field.label}".` };
    if (picks.length > MAX_PICKS) return { ok: false, error: `That's too many picks for "${field.label}".` };
    if (!config.allowOther && picks.some((p) => !findOption(config, p))) {
      return { ok: false, error: `Pick from the listed options for "${field.label}".` };
    }
    const options = pickedOptions(config, picks);
    const named = options.map((o) => (optionFacts(o) ? `${o.label} (${optionFacts(o)})` : o.label));
    const total = selectionTotal(options);
    const sum = [total.price, total.duration].filter(Boolean).join(" · ");
    return { ok: true, value: named.join(", ") + (options.length > 1 && sum ? ` — total ${sum}` : "") };
  }

  if (type === "number") {
    const text = typeof raw === "number" ? String(raw) : flat(raw, 20);
    if (!text) return { ok: true, value: "" };
    const n = Number(text);
    if (!Number.isInteger(n)) return { ok: false, error: `"${field.label}" needs a whole number.` };
    const min = config.min ?? 0;
    if (n < min) return { ok: false, error: `"${field.label}" can't be less than ${min}.` };
    if (config.max !== undefined && n > config.max) {
      return { ok: false, error: `"${field.label}" can't be more than ${config.max}.` };
    }
    return { ok: true, value: String(n) };
  }

  if (type === "yes_no") {
    const text = raw === true ? "yes" : raw === false ? "no" : flat(raw, 10).toLowerCase();
    if (!text) return { ok: true, value: "" };
    if (text !== "yes" && text !== "no") return { ok: false, error: `Answer yes or no to "${field.label}".` };
    return { ok: true, value: text === "yes" ? "Yes" : "No" };
  }

  return { ok: true, value: String(raw ?? "").trim().slice(0, 2000) };
}
