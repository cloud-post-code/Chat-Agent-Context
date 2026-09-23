import { PendingButton } from "./PendingButton";
import { panel, btnDanger, SectionTitle } from "./ui";

/** An order placed from the cart card, as the panel lists it. */
export type CalendarOrder = {
  id: string;
  createdAt: string;
  startsAt: string | null;
  lines: { name: string; quantity: number; choices: string; note: string; lineTotal: string }[];
  contact: { name: string; phone: string; email: string };
  fulfillment: string;
  notes: string;
  subtotal: string;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Orders placed from the cart card: what, for whom, how, when, and the total.
 * Its own Inbox sub-tab; it used to hang under the Calendar grid.
 */
export function OrdersPanel({
  orders,
  deleteAction,
}: {
  orders: CalendarOrder[];
  deleteAction?: (formData: FormData) => Promise<void>;
}) {
  return (
    <div data-fill="surface" style={panel}>
      <SectionTitle>Orders</SectionTitle>
      {orders.length === 0 && (
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 14 }}>
          No orders yet. They arrive here when a visitor checks out from the menu card.
        </p>
      )}
      {orders.map((o) => (
        <div key={o.id} style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <strong style={{ fontSize: 14 }}>
              {o.contact.name || "Order"}
              {o.subtotal ? ` · ${o.subtotal}` : ""}
              {o.fulfillment ? ` · ${o.fulfillment.replace("_", " ")}` : ""}
            </strong>
            {deleteAction && (
              <form action={deleteAction}>
                <input type="hidden" name="id" value={o.id} />
                <PendingButton pendingLabel="Removing…" style={btnDanger as React.CSSProperties}>
                  Remove
                </PendingButton>
              </form>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--on-surface)", marginTop: 2 }}>
            Placed {when(o.createdAt)}
            {o.startsAt ? ` · for ${when(o.startsAt)}` : ""}
            {[o.contact.phone, o.contact.email].filter(Boolean).length ? ` · ${[o.contact.phone, o.contact.email].filter(Boolean).join(" · ")}` : ""}
          </div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13 }}>
            {o.lines.map((l, i) => (
              <li key={i}>
                {l.quantity} × {l.name}
                {l.choices ? ` (${l.choices})` : ""}
                {l.note ? ` — ${l.note}` : ""}
                {l.lineTotal ? ` · ${l.lineTotal}` : ""}
              </li>
            ))}
          </ul>
          {o.notes && <p style={{ fontSize: 13, margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{o.notes}</p>}
        </div>
      ))}
    </div>
  );
}
