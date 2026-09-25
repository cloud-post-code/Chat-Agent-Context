"use client";

import { useEffect, useState } from "react";

/**
 * The one sealed renderer for model- or owner-written HTML: coded cards in
 * the chat (`tone="bg-soft"`) and a source's custom page in the admin
 * (`tone="surface"`). The markup was validated by safeCardHtml at save; this
 * sandbox is the second wall — a CSP of default-src 'none' (inline styles and
 * same-origin/data images only) and a sandbox with no scripts — so stored
 * HTML can never execute or phone out even if a validator regression let
 * something through.
 *
 * Theme variables are read from the live document and injected, because a
 * sandboxed iframe inherits nothing; the frame stays on-palette when the
 * site theme changes.
 */
const THEME_VARS = [
  "--bg", "--bg-soft", "--surface", "--border", "--text",
  "--primary", "--accent", "--on-primary", "--on-accent",
  "--on-surface", "--on-bg-soft",
  "--accent-on-bg", "--accent-on-bg-soft", "--accent-on-surface",
  "--danger-on-bg-soft", "--danger-on-surface",
  "--success-on-bg-soft", "--success-on-surface",
  "--font-heading", "--heading-weight",
  "--radius-sm", "--radius-md", "--radius-lg", "--radius-pill",
];

export function HtmlFrame({
  html,
  height,
  title,
  tone,
  style,
}: {
  html: string;
  height: number;
  title: string;
  /** Which fill the frame sits on: picks the readable text and link colors. */
  tone: "bg-soft" | "surface";
  style?: React.CSSProperties;
}) {
  const [themeCss, setThemeCss] = useState("");
  useEffect(() => {
    const root = getComputedStyle(document.documentElement);
    const vars = THEME_VARS.map((n) => `${n}:${root.getPropertyValue(n)};`).join("");
    const font = getComputedStyle(document.body).fontFamily;
    // Base element styles mirroring the site's card idiom, so even markup the
    // model leaves unstyled lands on-theme.
    setThemeCss(
      `:root{${vars}}` +
        `body{margin:0;background:transparent;color:var(--on-${tone});font-family:${font};font-size:14px;line-height:1.55;}` +
        `h1,h2,h3,h4{font-family:var(--font-heading),${font};font-weight:var(--heading-weight,700);margin:0 0 8px;}` +
        `h1{font-size:17px}h2{font-size:15px}h3,h4{font-size:14px}` +
        `a{color:var(--accent-on-${tone});}` +
        `img{max-width:100%;}`,
    );
  }, [tone]);

  const doc =
    `<!doctype html><html><head>` +
    // img-src also allows this origin, so a frame can show a real photo from
    // the owner's library or one the builder generated — both are served from
    // /api/uploads on our own host. Everything else stays denied.
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: 'self';">` +
    `<style>${themeCss}</style></head><body>${html}</body></html>`;

  return (
    <iframe
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      title={title}
      style={{
        width: "100%",
        height,
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        display: "block",
        ...style,
      }}
    />
  );
}
