/**
 * The A2UI card idiom, stated once: every card in Cards.tsx draws from these,
 * and the onboarding chat and admin forms import the same objects so their
 * controls match the cards.
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
