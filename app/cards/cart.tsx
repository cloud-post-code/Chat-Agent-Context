"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { cartTotal, resolveLine, type LineChoice, type MenuItemData } from "@/lib/menuTypes";

/**
 * The visitor's cart: one per agent, shared by every menu and cart card in
 * the thread, kept in localStorage so a reload keeps it. A small external
 * store rather than React state, because cards in different messages must
 * see one cart and the chat page must be able to apply a change the agent
 * asked for (add_to_cart) without re-rendering every bubble.
 *
 * A line keeps a snapshot of its item so the cart card can reopen the
 * customizer and re-check the line's rules without the menu card that added
 * it. Prices here are for the visitor's eyes; the server recomputes at
 * checkout from the menu on file.
 */

export type CartLine = {
  lineId: string;
  item: MenuItemData;
  quantity: number;
  choices: LineChoice[];
  note: string;
  /** The unit price as the rules computed it ("$29", "$29+"), "" when unpriced. */
  unitPrice: string;
};

type Listener = () => void;

export class CartStore {
  private lines: CartLine[] = [];
  private listeners = new Set<Listener>();
  private storageKey: string | null;

  constructor(slug: string | null) {
    this.storageKey = slug ? `cart:${slug}` : null;
    this.lines = this.load();
  }

  private load(): CartLine[] {
    if (!this.storageKey || typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed.filter((l): l is CartLine => !!l && typeof l === "object" && !!(l as CartLine).item?.key)
        : [];
    } catch {
      return [];
    }
  }

  private save() {
    if (!this.storageKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(this.lines));
    } catch {
      /* private mode or quota — the live cart still works */
    }
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  get = () => this.lines;

  private set(next: CartLine[]) {
    this.lines = next;
    this.save();
    for (const l of this.listeners) l();
  }

  /** Put an item in, merging with a line that has the same choices and note. */
  add(item: MenuItemData, quantity = 1, choices: LineChoice[] = [], note = "") {
    const same = (l: CartLine) =>
      l.item.key === item.key && l.note === note && JSON.stringify(l.choices) === JSON.stringify(choices);
    const existing = this.lines.find(same);
    if (existing) return this.setQuantity(existing.lineId, existing.quantity + quantity);
    const verdict = resolveLine(item, { key: item.key, quantity, choices, note });
    const unitPrice = verdict.ok ? verdict.line.unitPrice : "";
    const lineId = `${item.key}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.set([...this.lines, { lineId, item, quantity, choices, note, unitPrice }]);
  }

  /** Replace a line's choices and note (the customizer's Save). */
  update(lineId: string, patch: { choices?: LineChoice[]; note?: string; quantity?: number }) {
    this.set(
      this.lines.map((l) => {
        if (l.lineId !== lineId) return l;
        const next = { ...l, ...patch };
        const verdict = resolveLine(next.item, { key: next.item.key, quantity: next.quantity, choices: next.choices, note: next.note });
        return { ...next, unitPrice: verdict.ok ? verdict.line.unitPrice : "" };
      }),
    );
  }

  setQuantity(lineId: string, quantity: number) {
    const line = this.lines.find((l) => l.lineId === lineId);
    if (!line) return;
    const max = line.item.quantityMax;
    const n = Math.min(max, Math.max(0, Math.round(quantity)));
    if (n === 0) return this.remove(lineId);
    this.set(this.lines.map((l) => (l.lineId === lineId ? { ...l, quantity: n } : l)));
  }

  remove(lineId: string) {
    this.set(this.lines.filter((l) => l.lineId !== lineId));
  }

  clear() {
    this.set([]);
  }
}

const CartContext = createContext<CartStore | null>(null);

/** Cards outside a provider (the admin preview) get a throwaway in-memory cart. */
let fallback: CartStore | null = null;

export function CartProvider({ slug, children }: { slug: string; children: React.ReactNode }) {
  const store = useMemo(() => new CartStore(slug), [slug]);
  return <CartContext.Provider value={store}>{children}</CartContext.Provider>;
}

function useCartStore(): CartStore {
  const ctx = useContext(CartContext);
  if (ctx) return ctx;
  if (!fallback) fallback = new CartStore(null);
  return fallback;
}

const EMPTY: CartLine[] = [];

export function useCart() {
  const store = useCartStore();
  const lines = useSyncExternalStore(store.subscribe, store.get, () => EMPTY);
  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const total = cartTotal(lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity })));
  /** Lines that break their item's rules (a required choice not made). */
  const problems = lines
    .map((l) => ({ line: l, verdict: resolveLine(l.item, { key: l.item.key, quantity: l.quantity, choices: l.choices, note: l.note }) }))
    .filter((x) => !x.verdict.ok)
    .map((x) => ({ lineId: x.line.lineId, error: (x.verdict as { error: string }).error }));
  return { store, lines, count, total, problems };
}

/** What the chat request carries so the agent can talk about the cart. */
export function cartSummary(lines: CartLine[]): { name: string; quantity: number; unitPrice?: string }[] {
  return lines.map((l) => ({ name: l.item.name, quantity: l.quantity, unitPrice: l.unitPrice || undefined }));
}
