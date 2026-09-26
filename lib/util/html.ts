const MAX_HTML_LENGTH = 40_000;

/**
 * Whether owner- or model-written HTML is storable. The sandboxed iframe it
 * renders in (app/cards/HtmlFrame.tsx) refuses to execute anything anyway —
 * no scripts, sealed CSP — so this check is defense in depth: markup that even
 * LOOKS executable never reaches the database, and a renderer regression can't
 * turn a stored page into an attack. Used for an ingestion source's custom
 * page code (IngestionSource.panelHtml).
 */
export function safeHtml(html: unknown): html is string {
  if (typeof html !== "string" || !html.trim() || html.length > MAX_HTML_LENGTH) return false;
  return !/<\s*(script|iframe|object|embed|link|meta|base|form)\b|javascript:|\bon[a-z]+\s*=|srcdoc\s*=/i.test(
    html,
  );
}
