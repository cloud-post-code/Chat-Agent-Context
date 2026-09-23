"use client";

import { useState } from "react";
import { choiceSummary, FULFILLMENT_LABELS, type Fulfillment } from "@/lib/menuTypes";
import type { CartCheckout } from "@/lib/menu";
import { useCart, type CartLine } from "./cart";
import { Customizer, Stepper } from "./MenuCard";
import { card, cf, linkBtn, liveBtn, textBtn } from "./styles";

/**
 * The cart card: every line the visitor added — name, choices, note, a − n +
 * stepper, Edit (the customizer again), Remove, the line total — the subtotal
 * with a "+" when any price is a floor, and checkout. Checkout asks only what
 * an order needs: how to get it (when the menu offers more than one way),
 * name, phone and/or email as the business asks, a time when the way needs
 * one, and notes. One POST to /api/order; the server re-prices everything.
 *
 * `CartLines` is the body without the card frame, so the menu card's footer
 * can open the same cart inline.
 */

export function CartCard({ checkout, slug }: { checkout: CartCheckout; slug: string }) {
  return (
    <div data-fill="bg-soft" style={{ ...card, maxWidth: 480 }}>
      <strong style={{ fontSize: 15, fontFamily: "var(--font-heading)" }}>Your cart</strong>
      <div style={{ marginTop: 8 }}>
        <CartLines checkout={checkout} slug={slug} />
      </div>
    </div>
  );
}

type OrderReply = { ok: true; id: string; subtotal: string } | { ok: false; error: string };

export function CartLines({ checkout, slug }: { checkout: CartCheckout; slug: string }) {
  const { store, lines, total, problems } = useCart();
  const [editing, setEditing] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [done, setDone] = useState<{ subtotal: string; count: number } | null>(null);

  if (done) {
    return (
      <div style={{ borderTop: "1px solid var(--success-on-bg-soft)", paddingTop: 8 }}>
        <strong style={{ fontSize: 15 }}>Order received — thank you.</strong>
        <p style={{ fontSize: 13, fontStyle: "italic", margin: "6px 0 0" }}>
          {done.count} item{done.count === 1 ? "" : "s"}
          {done.subtotal ? ` · ${done.subtotal}` : ""}. The business has your details and will confirm.
        </p>
      </div>
    );
  }
  if (!lines.length) {
    return <p style={{ fontSize: 14, fontStyle: "italic", margin: 0 }}>Your cart is empty — add something from the menu.</p>;
  }
  const problemFor = (id: string) => problems.find((p) => p.lineId === id)?.error;
  return (
    <div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {lines.map((l, i) => (
          <li key={l.lineId} style={{ padding: "8px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
            {editing === l.lineId ? (
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{l.item.name}</div>
                <Customizer
                  item={l.item}
                  initial={{ quantity: l.quantity, choices: l.choices, note: l.note }}
                  submitLabel="Save"
                  onSubmit={(quantity, choices, note) => {
                    store.update(l.lineId, { quantity, choices, note });
                    setEditing(null);
                  }}
                />
                <button onClick={() => setEditing(null)} style={{ ...textBtn, marginTop: 6 }}>
                  Cancel
                </button>
              </div>
            ) : (
              <LineRow line={l} problem={problemFor(l.lineId)} onEdit={() => setEditing(l.lineId)} />
            )}
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 4 }}>
        <span style={{ fontSize: 13 }}>Subtotal{total?.endsWith("+") ? " (from)" : ""}</span>
        <strong style={{ fontSize: 15 }}>{total ?? "—"}</strong>
      </div>
      {!checkingOut ? (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => setCheckingOut(true)}
            disabled={problems.length > 0}
            style={{ ...linkBtn, ...liveBtn, cursor: "pointer", padding: "10px 18px", opacity: problems.length ? 0.55 : 1 }}
          >
            Checkout
          </button>
          <button onClick={() => store.clear()} style={{ ...linkBtn, cursor: "pointer" }}>
            Empty cart
          </button>
          {problems.length > 0 && (
            <p style={{ fontSize: 12, color: "var(--danger-on-bg-soft)", margin: 0, width: "100%" }}>
              Finish the choices marked above before checking out.
            </p>
          )}
        </div>
      ) : (
        <CheckoutForm
          checkout={checkout}
          slug={slug}
          lines={lines}
          onBack={() => setCheckingOut(false)}
          onDone={(reply) => {
            setDone({ subtotal: reply.subtotal, count: lines.reduce((n, l) => n + l.quantity, 0) });
            store.clear();
          }}
        />
      )}
    </div>
  );
}

function LineRow({ line, problem, onEdit }: { line: CartLine; problem?: string; onEdit: () => void }) {
  const { store } = useCart();
  const summary = choiceSummary(line.choices);
  const total = line.unitPrice ? lineTotal(line) : "";
  const editable = line.item.modifiers.length > 0 || line.item.customization;
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{line.item.name}</span>
          {total && <span style={{ fontSize: 14, whiteSpace: "nowrap" }}>{total}</span>}
        </div>
        {(summary || line.note) && (
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
            {summary}
            {summary && line.note ? " · " : ""}
            {line.note && <em>{line.note}</em>}
          </div>
        )}
        {problem && <div style={{ fontSize: 12, color: "var(--danger-on-bg-soft)", marginTop: 2 }}>{problem}</div>}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
          <Stepper value={line.quantity} min={0} max={line.item.quantityMax} onChange={(n) => store.setQuantity(line.lineId, n)} />
          {editable && (
            <button onClick={onEdit} style={textBtn}>
              Edit
            </button>
          )}
          <button onClick={() => store.remove(line.lineId)} style={textBtn} aria-label={`Remove ${line.item.name}`}>
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

/** "$29 × 2 = $58" folded to the figure the visitor cares about. */
function lineTotal(line: CartLine): string {
  const floor = line.unitPrice.endsWith("+");
  const m = line.unitPrice.match(/(\p{Sc})?\s*(\d[\d,]*(?:\.\d{1,2})?)/u);
  if (!m) return line.unitPrice;
  const amount = Number.parseFloat(m[2].replace(/,/g, "")) * line.quantity;
  const n = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return `${m[1] ?? ""}${n}${floor ? "+" : ""}`;
}

function CheckoutForm({
  checkout,
  slug,
  lines,
  onBack,
  onDone,
}: {
  checkout: CartCheckout;
  slug: string;
  lines: CartLine[];
  onBack: () => void;
  onDone: (reply: { subtotal: string }) => void;
}) {
  const ways = Array.isArray(checkout?.fulfillment) ? checkout.fulfillment : [];
  const contact = checkout?.contact ?? { phone: "off", email: "required" };
  const [way, setWay] = useState<Fulfillment | "">(ways.length === 1 ? ways[0] : "");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [when, setWhen] = useState("");
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [error, setError] = useState("");

  const needsTime = way === "appointment" || way === "dine_in";
  const startsAt = when ? new Date(when) : null;
  const timeOk = !needsTime || (!!startsAt && !Number.isNaN(startsAt.getTime()) && startsAt.getTime() > Date.now());
  const contactOk =
    !!name.trim() &&
    (contact.phone !== "required" || !!phone.trim()) &&
    (contact.email !== "required" || !!email.trim()) &&
    (!!phone.trim() || !!email.trim());
  const canSend = contactOk && timeOk && (ways.length <= 1 || !!way) && state !== "sending";

  async function submit() {
    if (!canSend) return;
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          lines: lines.map((l) => ({ key: l.item.key, quantity: l.quantity, choices: l.choices, note: l.note })),
          contact: { name, phone, email },
          fulfillment: way || undefined,
          startsAt: startsAt && !Number.isNaN(startsAt.getTime()) ? startsAt.toISOString() : undefined,
          notes,
        }),
      });
      const data = (await res.json()) as OrderReply;
      if (!res.ok || !data.ok) {
        setError(!data.ok ? data.error : "Something went wrong.");
        setState("error");
        return;
      }
      onDone({ subtotal: data.subtotal });
    } catch {
      setError("Network error. Try again.");
      setState("error");
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      {ways.length > 1 && (
        <div role="radiogroup" aria-label="How would you like it?" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {ways.map((w) => (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={way === w}
              onClick={() => setWay(w)}
              style={{ ...linkBtn, cursor: "pointer", ...(way === w ? { borderColor: "var(--on-surface)", boxShadow: "inset 0 0 0 1px var(--on-surface)" } : {}) }}
            >
              {FULFILLMENT_LABELS[w] ?? w}
            </button>
          ))}
        </div>
      )}
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" style={cf} />
      {contact.phone !== "off" && (
        <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder={`Phone${contact.phone === "required" ? "" : " (optional)"}`} aria-label="Phone" style={cf} />
      )}
      {contact.email !== "off" && (
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder={`Email${contact.email === "required" ? "" : " (optional)"}`} aria-label="Email" style={cf} />
      )}
      {(needsTime || way === "pickup" || way === "delivery" || ways.length === 0) && (
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          aria-label={needsTime ? "When" : "When (optional)"}
          style={cf}
        />
      )}
      {when && !timeOk && <p style={{ color: "var(--danger-on-bg-soft)", fontSize: 13, margin: "0 0 8px" }}>Pick a time in the future.</p>}
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything else? (optional)" aria-label="Notes" rows={2} style={{ ...cf, resize: "vertical" }} />
      {state === "error" && <p style={{ color: "var(--danger-on-bg-soft)", fontSize: 13, margin: "0 0 8px" }}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onBack} style={{ ...linkBtn, cursor: "pointer" }}>
          Back
        </button>
        <button onClick={submit} disabled={!canSend} style={{ ...linkBtn, ...liveBtn, cursor: "pointer", padding: "10px 18px", opacity: canSend ? 1 : 0.55 }}>
          {state === "sending" ? "Placing order…" : "Place order"}
        </button>
      </div>
    </div>
  );
}
