import { prisma } from "./db";
import { listMenu } from "./menu";
import {
  cartTotal,
  resolveLine,
  FULFILLMENTS,
  MAX_ORDER_LINES,
  type CartLineInput,
  type Fulfillment,
  type OrderLine,
} from "./menuTypes";

/**
 * The one write path for an order placed from the cart card. Fail closed:
 * the card is untrusted, so every line is re-resolved against the menu on
 * file — prices, rules, availability — and the totals stored are the ones
 * computed here, never the ones the visitor's browser drew.
 */

export type OrderContact = { name: string; phone: string; email: string };

export type OrderInput = {
  lines: CartLineInput[];
  contact: Partial<OrderContact>;
  fulfillment?: string;
  startsAt?: string;
  notes?: string;
};

export type CreateOrderResult =
  | { ok: true; id: string; subtotal: string; lines: OrderLine[]; appointmentId: string | null }
  | { ok: false; error: string };

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export async function createOrder(userId: string, input: OrderInput): Promise<CreateOrderResult> {
  const menu = await listMenu(userId);
  if (!menu.length) return { ok: false, error: "Ordering isn't available right now." };

  const raw = Array.isArray(input.lines) ? input.lines : [];
  if (!raw.length) return { ok: false, error: "Your cart is empty." };
  if (raw.length > MAX_ORDER_LINES) return { ok: false, error: "That's too many lines for one order." };
  const lines: OrderLine[] = [];
  for (const l of raw) {
    const item = menu.find((i) => i.key === String(l?.key ?? "").trim().toLowerCase());
    if (!item) return { ok: false, error: "One of the items isn't on the menu any more." };
    const verdict = resolveLine(item, {
      key: item.key,
      quantity: Number(l.quantity),
      choices: Array.isArray(l.choices) ? l.choices : [],
      note: typeof l.note === "string" ? l.note : "",
    });
    if (!verdict.ok) return verdict;
    lines.push(verdict.line);
  }

  const contact: OrderContact = {
    name: text(input.contact?.name, 120),
    phone: text(input.contact?.phone, 40),
    email: text(input.contact?.email, 200),
  };
  if (!contact.name) return { ok: false, error: "Your name is required." };
  if (!contact.phone && !contact.email) return { ok: false, error: "A phone number or email is required." };
  if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
    return { ok: false, error: "That email doesn't look right." };
  }

  const offered = [...new Set(menu.flatMap((i) => i.fulfillment))];
  const wanted = text(input.fulfillment, 20) as Fulfillment;
  let fulfillment = "";
  if (wanted) {
    if (!(FULFILLMENTS as readonly string[]).includes(wanted) || (offered.length && !offered.includes(wanted))) {
      return { ok: false, error: "Pick one of the offered ways to get your order." };
    }
    fulfillment = wanted;
  } else if (offered.length === 1) {
    fulfillment = offered[0];
  } else if (offered.length > 1) {
    return { ok: false, error: "Choose how you'd like to get your order." };
  }

  let startsAt: Date | null = null;
  if (text(input.startsAt, 40)) {
    startsAt = new Date(String(input.startsAt));
    if (Number.isNaN(startsAt.getTime())) return { ok: false, error: "That date doesn't look right." };
    if (startsAt.getTime() <= Date.now()) return { ok: false, error: "Pick a time in the future." };
  } else if (fulfillment === "appointment" || fulfillment === "dine_in") {
    return { ok: false, error: "Pick a time." };
  }

  const subtotal = cartTotal(lines) ?? "";
  const currency = menu.find((i) => i.currency)?.currency ?? "";
  const row = await prisma.order.create({
    data: {
      userId,
      lines: JSON.stringify(lines),
      contact: JSON.stringify(contact),
      fulfillment,
      startsAt,
      notes: text(input.notes, 1000),
      subtotal,
      currency,
    },
  });
  const appointmentId = startsAt ? await bookFromOrder(userId, lines, contact, startsAt, text(input.notes, 1000)) : null;
  return { ok: true, id: row.id, subtotal, lines, appointmentId };
}

/**
 * A timed order is a booking too: put it on the calendar through the real
 * `createBooking`, answering the tenant's form by the fields' roles with what
 * the order knows. Best-effort — a form that asks something the order can't
 * answer simply gets no calendar entry; the order itself is already saved.
 */
async function bookFromOrder(
  userId: string,
  lines: OrderLine[],
  contact: OrderContact,
  startsAt: Date,
  notes: string,
): Promise<string | null> {
  try {
    const { getBookingConfig } = await import("./appointments");
    const { createBooking } = await import("./booking/store");
    const { sanitizeSelection } = await import("./booking/types");
    const { enabled, fields } = await getBookingConfig(userId);
    if (!enabled || !fields.length) return null;
    const summary = lines
      .map((l) => `${l.quantity} × ${l.name}${l.choices.length ? ` (${l.choices.flatMap((c) => c.picks).join(", ")})` : ""}`)
      .join(", ");
    const at = contact.name.indexOf(" ");
    const firstName = at < 0 ? contact.name : contact.name.slice(0, at);
    const lastName = at < 0 ? "" : contact.name.slice(at + 1).trim();
    const answers: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.role === "name") answers[f.key] = contact.name;
      else if (f.role === "first_name") answers[f.key] = firstName;
      else if (f.role === "last_name" && lastName) answers[f.key] = lastName;
      else if (f.role === "email" && contact.email) answers[f.key] = contact.email;
      else if (f.role === "phone" && contact.phone) answers[f.key] = contact.phone;
      else if (f.role === "notes") answers[f.key] = [summary, notes].filter(Boolean).join("\n");
      else if (f.type === "multi_select" || f.type === "select") {
        // A menu question whose options are the order's lines: the picks are the answer.
        const picks = lines.map((l) => l.name).filter((n) => f.config.options?.some((o) => o.label.toLowerCase() === n.toLowerCase()));
        if (picks.length) answers[f.key] = f.type === "select" ? [picks[0]] : picks;
        else if (f.config.allowOther) answers[f.key] = [summary.slice(0, 200)];
      }
    }
    const result = await createBooking(
      userId,
      sanitizeSelection({ serviceId: null, startsAt: startsAt.toISOString(), answers, customer: {} }),
    );
    return result.ok ? result.id : null;
  } catch {
    return null;
  }
}

export type OrderRow = {
  id: string;
  lines: OrderLine[];
  contact: OrderContact;
  fulfillment: string;
  startsAt: Date | null;
  notes: string;
  subtotal: string;
  status: string;
  createdAt: Date;
};

const safe = <T,>(json: string, fallback: T): T => {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
};

export async function listOrders(userId: string): Promise<OrderRow[]> {
  const rows = await prisma.order.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 200 });
  return rows.map((r) => ({
    id: r.id,
    lines: safe<OrderLine[]>(r.lines, []),
    contact: { name: "", phone: "", email: "", ...safe<Partial<OrderContact>>(r.contact, {}) },
    fulfillment: r.fulfillment,
    startsAt: r.startsAt,
    notes: r.notes,
    subtotal: r.subtotal,
    status: r.status,
    createdAt: r.createdAt,
  }));
}

export async function deleteOrder(userId: string, id: string): Promise<void> {
  await prisma.order.deleteMany({ where: { userId, id } });
}
