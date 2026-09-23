"use client";

import { useState } from "react";
import {
  displayPrice,
  groupMenu,
  resolveLine,
  type LineChoice,
  type MenuItemData,
  type Modifier,
} from "@/lib/menuTypes";
import type { CartCheckout } from "@/lib/menu";
import { useCart } from "./cart";
import { CartLines } from "./CartCard";
import { card, cf, chip, clamp2, linkBtn, liveBtn, stepBtn, textBtn } from "./styles";

/**
 * The menu card: the whole menu grouped by section — every section after the
 * first folded to a header and a count, so a hundred-item menu is one screen
 * — or a curated list under the agent's title. A row is compact (name,
 * price, one line, badges) and opens to everything the site said about the
 * item plus the customizer: modifiers drawn from their rules, a quantity
 * stepper, a note where the item takes requests. Add puts a line in the
 * shared cart; a row already in the cart shows a − n + stepper instead.
 *
 * The block is data: an unknown field is ignored, an unavailable item can't
 * be added, and nothing here is trusted by the server at checkout.
 */

export type MenuBlockView = {
  title: string;
  full: boolean;
  items: MenuItemData[];
  checkout: CartCheckout;
};

/** Rows past this many in one section fold behind "Show all". */
const ROWS_SHOWN = 8;

export function MenuCard({ block, slug }: { block: MenuBlockView; slug: string }) {
  const items = Array.isArray(block.items) ? block.items.filter((i) => i && typeof i.name === "string" && i.key) : [];
  const [cartOpen, setCartOpen] = useState(false);
  const { count, total } = useCart();
  if (!items.length) {
    return (
      <div data-fill="bg-soft" style={{ ...card, maxWidth: 480, fontStyle: "italic", fontSize: 14 }}>
        Nothing on the menu yet.
      </div>
    );
  }
  const groups = groupMenu(items);
  return (
    <div data-fill="bg-soft" style={{ ...card, maxWidth: 480 }}>
      <strong style={{ fontSize: 15, fontFamily: "var(--font-heading)" }}>{block.title || "Menu"}</strong>
      {block.full && groups.length > 1 ? (
        groups.map((g, i) => <Section key={g.name || i} name={g.name} items={g.items} open={i === 0} />)
      ) : (
        <Rows items={items} />
      )}
      <div style={footer}>
        <span style={{ fontSize: 13 }}>
          {count === 0 ? "Your cart is empty." : `${count} in cart${total ? ` · ${total}` : ""}`}
        </span>
        {(count > 0 || cartOpen) && (
          <button onClick={() => setCartOpen((v) => !v)} aria-expanded={cartOpen} style={{ ...linkBtn, cursor: "pointer" }}>
            {cartOpen ? "Hide cart ▴" : "View cart ▾"}
          </button>
        )}
      </div>
      {/* Stays open once opened, so the order confirmation isn't hidden the
          moment the cart empties. */}
      {cartOpen && (
        <div style={{ marginTop: 10 }}>
          <CartLines slug={slug} checkout={block.checkout} />
        </div>
      )}
    </div>
  );
}

function Section({ name, items, open: initiallyOpen }: { name: string; items: MenuItemData[]; open: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div style={{ marginTop: 10 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ ...sectionHead, cursor: "pointer" }}
      >
        <span>{name || "More"}</span>
        <span style={{ fontSize: 12, opacity: 0.75 }}>
          {items.length} · {open ? "▴" : "▾"}
        </span>
      </button>
      {open && <Rows items={items} />}
    </div>
  );
}

function Rows({ items }: { items: MenuItemData[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, ROWS_SHOWN);
  return (
    <ul style={{ listStyle: "none", margin: "4px 0 0", padding: 0 }}>
      {shown.map((it, i) => (
        <MenuRow key={it.key} item={it} first={i === 0} />
      ))}
      {items.length > ROWS_SHOWN && (
        <li style={{ paddingTop: 8 }}>
          <button onClick={() => setAll((v) => !v)} aria-expanded={all} style={{ ...linkBtn, cursor: "pointer" }}>
            {all ? "Show fewer ▴" : `Show all ${items.length} ▾`}
          </button>
        </li>
      )}
    </ul>
  );
}

/** "$24" with "$28" struck through beside it when the site shows a sale. */
function Price({ item }: { item: MenuItemData }) {
  const shown = displayPrice(item);
  const was = item.salePrice && item.originalPrice && item.originalPrice !== item.salePrice ? item.originalPrice : "";
  if (!shown) return null;
  return (
    <span style={{ fontSize: 14, whiteSpace: "nowrap" }}>
      {was && <s style={{ opacity: 0.6, marginRight: 6, fontSize: 12 }}>{was}</s>}
      {shown}
      {item.unit && <span style={{ fontSize: 11, opacity: 0.75 }}> / {item.unit}</span>}
    </span>
  );
}

function Badges({ item }: { item: MenuItemData }) {
  const marks = [
    item.popularity ? item.popularity.replace("_", " ") : "",
    ...item.dietaryTags,
    item.availability === "limited" ? (item.inventory || "limited") : "",
    item.availability === "unavailable" ? "unavailable" : "",
    item.availabilityWindow,
  ].filter(Boolean);
  if (!marks.length) return null;
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
      {marks.map((m) => (
        <span key={m} style={chip}>
          {m}
        </span>
      ))}
    </div>
  );
}

function MenuRow({ item, first }: { item: MenuItemData; first: boolean }) {
  const [open, setOpen] = useState(false);
  const { store, lines } = useCart();
  const mine = lines.filter((l) => l.item.key === item.key);
  const inCart = mine.reduce((n, l) => n + l.quantity, 0);
  const needsChoice = item.modifiers.some((m) => m.required);
  const unavailable = item.availability === "unavailable";
  const quickAdd = () => {
    if (needsChoice || unavailable) return setOpen(true);
    store.add(item, 1, defaultChoices(item), "");
  };
  const blurb = item.shortDescription || (item.fullDescription.length <= 200 ? item.fullDescription : "");
  return (
    <li style={{ padding: "10px 0", borderTop: first ? "none" : "1px solid var(--border)" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        {item.image && !open && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.image} alt="" style={thumb} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <button onClick={() => setOpen((v) => !v)} aria-expanded={open} style={rowTitle}>
            <span style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--font-heading)", textAlign: "left" }}>
              {item.name}
            </span>
            <Price item={item} />
          </button>
          {blurb && !open && (
            <p style={{ fontSize: 13, color: "var(--on-bg-soft)", lineHeight: 1.45, margin: "2px 0 0", ...clamp2 }}>{blurb}</p>
          )}
          {!open && <Badges item={item} />}
        </div>
        {!open && (
          <div style={{ flex: "0 0 auto" }}>
            {unavailable ? (
              <span style={{ ...chip, opacity: 0.8 }}>Unavailable</span>
            ) : inCart > 0 && !needsChoice ? (
              <Stepper
                value={inCart}
                min={0}
                onChange={(n) => {
                  const line = mine[0];
                  if (n > inCart) store.add(item, 1, defaultChoices(item), "");
                  else if (line) store.setQuantity(line.lineId, line.quantity - 1);
                }}
                max={item.quantityMax}
              />
            ) : (
              <button onClick={quickAdd} aria-label={`Add ${item.name}`} style={{ ...linkBtn, ...liveBtn, cursor: "pointer" }}>
                {inCart > 0 ? `+ Add (${inCart})` : needsChoice ? "Choose" : "+ Add"}
              </button>
            )}
          </div>
        )}
      </div>
      {open && <ItemDetail item={item} onClose={() => setOpen(false)} />}
    </li>
  );
}

/** The choices a modifier's defaults preselect, so a quick Add is a complete line. */
export function defaultChoices(item: MenuItemData): LineChoice[] {
  return item.modifiers
    .filter((m) => m.defaults.length)
    .map((m) => ({ modifier: m.name, picks: m.defaults.slice(0, m.max) }));
}

function Facts({ item }: { item: MenuItemData }) {
  const rows: [string, string][] = [
    ["Ingredients", item.ingredients.join(", ")],
    ["Allergens", item.allergens.join(", ")],
    ["Nutrition", item.nutrition],
    ["Serving", item.servingSize],
    ["Available", [item.availabilityWindow, ...item.locations].filter(Boolean).join(" · ")],
    ["Time", item.estimatedTime],
    ["Stock", item.inventory],
    ["Rating", item.rating ? `${item.rating}${item.reviewCount ? ` (${item.reviewCount} reviews)` : ""}` : ""],
    ["Fulfillment", item.fulfillment.map((f) => f.replace("_", " ")).join(", ")],
    ["Pairs well with", item.pairings.join(", ")],
    ["Goes with", item.upsells.join(", ")],
    ["Similar", item.related.join(", ")],
  ];
  const shown = rows.filter(([, v]) => v);
  if (!shown.length && !item.warnings.length) return null;
  return (
    <dl style={{ margin: "8px 0 0", fontSize: 12, display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 10px" }}>
      {shown.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt style={{ opacity: 0.7 }}>{k}</dt>
          <dd style={{ margin: 0 }}>{v}</dd>
        </div>
      ))}
      {item.warnings.map((w) => (
        <div key={w} style={{ display: "contents" }}>
          <dt style={{ color: "var(--danger-on-bg-soft)" }}>Note</dt>
          <dd style={{ margin: 0, color: "var(--danger-on-bg-soft)" }}>{w}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Everything the site said about the item, then the customizer. */
export function ItemDetail({ item, onClose }: { item: MenuItemData; onClose: () => void }) {
  const { store } = useCart();
  const [added, setAdded] = useState(false);
  const pictures = [item.image, ...item.gallery].filter(Boolean);
  return (
    <div style={{ marginTop: 8 }}>
      {pictures.length > 0 && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
          {pictures.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt={item.name} style={{ height: 120, width: "auto", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }} />
          ))}
        </div>
      )}
      {(item.subcategory || item.category) && (
        <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>{[item.category, item.subcategory].filter(Boolean).join(" › ")}</div>
      )}
      {(item.fullDescription || item.shortDescription) && (
        <p style={{ fontSize: 13, lineHeight: 1.5, margin: "4px 0 0" }}>{item.fullDescription || item.shortDescription}</p>
      )}
      <Badges item={item} />
      <Facts item={item} />
      {item.availability === "unavailable" ? (
        <p style={{ fontSize: 13, fontStyle: "italic", margin: "8px 0 0" }}>Not available right now.</p>
      ) : (
        <Customizer
          item={item}
          submitLabel={added ? "Added ✓ — add again" : "Add to cart"}
          onSubmit={(quantity, choices, note) => {
            store.add(item, quantity, choices, note);
            setAdded(true);
          }}
        />
      )}
      <button onClick={onClose} style={{ ...textBtn, marginTop: 8 }}>
        Close
      </button>
    </div>
  );
}

/**
 * Modifiers as the site states them: a pick-one is radios, a pick-many
 * checkboxes counted against min–max, defaults preselected, priced choices
 * show their delta; then quantity within the item's rules and a note when the
 * item takes requests. The line's verdict (the server's own rule) gates the
 * button and names what's missing.
 */
export function Customizer({
  item,
  initial,
  submitLabel,
  onSubmit,
}: {
  item: MenuItemData;
  initial?: { quantity: number; choices: LineChoice[]; note: string };
  submitLabel: string;
  onSubmit: (quantity: number, choices: LineChoice[], note: string) => void;
}) {
  const [quantity, setQuantity] = useState(initial?.quantity ?? item.quantityMin);
  const [choices, setChoices] = useState<LineChoice[]>(initial?.choices ?? defaultChoices(item));
  const [note, setNote] = useState(initial?.note ?? "");
  const verdict = resolveLine(item, { key: item.key, quantity, choices, note });
  const picksFor = (m: Modifier) => choices.find((c) => c.modifier === m.name)?.picks ?? [];
  const setPicks = (m: Modifier, picks: string[]) =>
    setChoices([...choices.filter((c) => c.modifier !== m.name), ...(picks.length ? [{ modifier: m.name, picks }] : [])]);
  const toggle = (m: Modifier, label: string) => {
    const picks = picksFor(m);
    if (m.max === 1) return setPicks(m, picks.includes(label) ? [] : [label]);
    if (picks.includes(label)) return setPicks(m, picks.filter((p) => p !== label));
    if (picks.length >= m.max) return;
    setPicks(m, [...picks, label]);
  };
  return (
    <div style={{ marginTop: 8 }}>
      {item.modifiers.map((m) => (
        <fieldset key={m.name} style={fieldset}>
          <legend style={legend}>
            {m.name}
            <span style={{ fontWeight: 400, opacity: 0.7 }}>
              {" "}
              · {m.required ? "required" : "optional"}
              {m.max > 1 ? ` · pick ${m.min === m.max ? m.min : `${m.min}–${m.max}`}` : ""}
            </span>
          </legend>
          {m.choices.map((c) => {
            const on = picksFor(m).includes(c.label);
            return (
              <label key={c.label} style={{ ...choiceRow, ...(on ? choiceOn : {}) }}>
                <input
                  type={m.max === 1 ? "radio" : "checkbox"}
                  name={`${item.key}:${m.name}`}
                  checked={on}
                  onChange={() => toggle(m, c.label)}
                  onClick={() => m.max === 1 && on && toggle(m, c.label)}
                  style={{ accentColor: "var(--on-surface)" }}
                />
                <span style={{ flex: 1 }}>{c.label}</span>
                {c.price && <span style={{ fontSize: 12 }}>{c.price}</span>}
              </label>
            );
          })}
        </fieldset>
      ))}
      {item.customization && (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Special requests (no onions, sauce on the side…)"
          aria-label={`Special requests for ${item.name}`}
          maxLength={300}
          style={{ ...cf, marginTop: 6 }}
        />
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
        <Stepper value={quantity} min={item.quantityMin} max={item.quantityMax} onChange={setQuantity} />
        <button
          onClick={() => verdict.ok && onSubmit(quantity, choices, note)}
          disabled={!verdict.ok}
          style={{ ...linkBtn, ...liveBtn, cursor: "pointer", opacity: verdict.ok ? 1 : 0.55 }}
        >
          {submitLabel}
          {verdict.ok && verdict.line.lineTotal ? ` · ${verdict.line.lineTotal}` : ""}
        </button>
      </div>
      {!verdict.ok && <p style={{ fontSize: 12, color: "var(--danger-on-bg-soft)", margin: "6px 0 0" }}>{verdict.error}</p>}
    </div>
  );
}

export function Stepper({
  value,
  min = 1,
  max,
  onChange,
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }} role="group" aria-label="Quantity">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label="One fewer" disabled={value <= min} style={{ ...stepBtn, opacity: value <= min ? 0.5 : 1 }}>
        −
      </button>
      <span style={{ minWidth: 20, textAlign: "center", fontSize: 14, fontWeight: 600 }} aria-live="polite">
        {value}
      </span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} aria-label="One more" disabled={value >= max} style={{ ...stepBtn, opacity: value >= max ? 0.5 : 1 }}>
        +
      </button>
    </div>
  );
}

const footer: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
  marginTop: 12,
  paddingTop: 10,
  borderTop: "1px solid var(--border)",
};
const sectionHead: React.CSSProperties = {
  width: "100%",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0 4px",
  background: "none",
  border: "none",
  borderBottom: "1px solid var(--border)",
  color: "var(--on-bg-soft)",
  fontSize: 11,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  fontWeight: 600,
};
const rowTitle: React.CSSProperties = {
  width: "100%",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: 10,
  background: "none",
  border: "none",
  padding: 0,
  color: "var(--on-bg-soft)",
  cursor: "pointer",
  textAlign: "left",
};
const thumb: React.CSSProperties = {
  width: 56,
  height: 56,
  objectFit: "cover",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  flex: "0 0 auto",
};
const fieldset: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "6px 10px 8px",
  margin: "6px 0 0",
};
const legend: React.CSSProperties = { fontSize: 12, fontWeight: 600, padding: "0 4px" };
const choiceRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  padding: "5px 6px",
  fontSize: 13,
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};
const choiceOn: React.CSSProperties = { background: "var(--surface)", color: "var(--on-surface)" };
