/**
 * The number inside a price and whether the price is exactly that number.
 * "$24" is exact; "$40+", "from $40", "$30–45" are a floor; "market price"
 * has no amount. A leading "+" ("+$5", an add-on delta) is a plain amount.
 * Used by the menu, the appointment options and the service index alike.
 */
export function parsePrice(text: string | undefined): { amount: number; exact: boolean; symbol: string } | null {
  const t = (text ?? "").trim().replace(/^\+\s*/, "");
  if (!t) return null;
  if (/^free$/i.test(t)) return { amount: 0, exact: true, symbol: "" };
  const m = t.match(/(\p{Sc})?\s*(\d[\d,]*(?:\.\d{1,2})?)/u);
  if (!m) return null;
  const amount = Number.parseFloat(m[2].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  return { amount, exact: /^\p{Sc}?\s*\d[\d,]*(?:\.\d{1,2})?$/u.test(t), symbol: m[1] ?? "" };
}

/** The numeric amount a price states, or null when it states none. */
export function priceAmountOf(text: string | undefined): number | null {
  return parsePrice(text)?.amount ?? null;
}
