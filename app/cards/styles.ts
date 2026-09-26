/**
 * The card idiom, stated once: every card in Cards.tsx, MenuCard.tsx and
 * CartCard.tsx draws from these, and the onboarding chat and admin forms
 * import the same objects so their controls match the cards.
 */
export const card: React.CSSProperties = {
  background: "var(--bg-soft)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  color: "var(--on-bg-soft)",
  padding: 16,
};
export const linkBtn: React.CSSProperties = {
  fontSize: 13,
  padding: "7px 12px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  color: "var(--on-surface)",
  background: "var(--surface)",
  textDecoration: "none",
};
export const cf: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  marginBottom: 10,
  outline: "none",
  fontSize: 14,
  color: "var(--on-surface)",
};
export const liveBtn: React.CSSProperties = {
  background: "var(--primary)",
  color: "var(--on-primary)",
  border: "none",
};
export const textBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  fontSize: 13,
  color: "var(--accent-on-bg-soft)",
  textDecoration: "underline",
  cursor: "pointer",
};
export const clamp2: React.CSSProperties = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};
/** A small chip: a dietary tag, a section count, a "popular" mark. */
export const chip: React.CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  lineHeight: 1.4,
  padding: "1px 7px",
  borderRadius: "var(--radius-pill)",
  border: "1px solid var(--border)",
  color: "var(--on-bg-soft)",
  background: "var(--surface)",
  whiteSpace: "nowrap",
};
/** The − n + control shared by the menu row, the customizer and the cart. */
export const stepBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  flex: "0 0 auto",
  fontSize: 16,
  lineHeight: 1,
  padding: 0,
  background: "var(--surface)",
  color: "var(--on-surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};
