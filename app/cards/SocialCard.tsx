"use client";

// Explicit default import, not just the ReactElement type: the ICONS map
// below builds its JSX at module load time, and some proof harnesses (e.g.
// docs/features/services-card/proof.ts, docs/features/menu-cart/proof.ts)
// import this file — via app/cards/Cards.tsx's social dispatch — under a
// tsx transform that does not reliably apply the automatic JSX runtime to a
// nested .tsx module, falling back to bare `React.createElement` calls that
// need `React` as an actual binding rather than only a global one proof
// happens to set. Importing it here removes the dependency on any global.
import React, { type ReactElement } from "react";
import { card, linkBtn } from "./styles";

void React;

/**
 * The social-links A2UI element: one button per profile the visitor asked
 * about (or every one on file when they didn't narrow it), each opening the
 * real profile in a new tab. Small and composable like ServicesCard — a
 * handful of buttons, not a whole "connect with us" section.
 */

const ICONS: Record<string, ReactElement> = {
  instagram: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="2" />
      <circle cx="17.3" cy="6.7" r="1.2" fill="currentColor" />
    </svg>
  ),
  facebook: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15 3h-2.5A4.5 4.5 0 0 0 8 7.5V10H6v3h2v8h3v-8h2.5l.5-3H11V7.5c0-.6.4-1 1-1H15V3Z"
        fill="currentColor"
      />
    </svg>
  ),
  twitter: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 3l7.5 9.4L3.4 21H6l5.8-6.6L16.5 21H21l-7.8-9.8L20.6 3H18l-5.3 6L8 3H3Z"
        fill="currentColor"
      />
    </svg>
  ),
  tiktok: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 3v10.2a2.8 2.8 0 1 1-2-2.68V8.4a5 5 0 1 0 4 4.9V9.6a6.6 6.6 0 0 0 4-1.4V5.8a3.6 3.6 0 0 1-2.6-1.2A3.3 3.3 0 0 1 16.6 3H14Z"
        fill="currentColor"
      />
    </svg>
  ),
  youtube: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="4" stroke="currentColor" strokeWidth="2" />
      <path d="M10.5 9.2v5.6l5-2.8-5-2.8Z" fill="currentColor" />
    </svg>
  ),
  linkedin: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="3" stroke="currentColor" strokeWidth="2" />
      <circle cx="7" cy="8" r="1.3" fill="currentColor" />
      <path d="M6 11h2v7H6v-7Zm4 0h2v1.2c.5-.9 1.4-1.4 2.5-1.4 2 0 2.5 1.3 2.5 3V18h-2v-3.6c0-1-.4-1.6-1.3-1.6-1 0-1.5.7-1.5 1.7V18h-2v-7Z" fill="currentColor" />
    </svg>
  ),
};

/** Platform label from the link, or the URL's host when the platform is blank. */
function labelFor(platform: string, url: string): string {
  const p = platform.trim();
  if (p) return p[0].toUpperCase() + p.slice(1);
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function SocialCard({
  title,
  items,
}: {
  title?: string;
  items: { platform: string; url: string }[];
}) {
  if (items.length === 0) return null;
  return (
    <div data-fill="bg-soft" style={{ ...card, maxWidth: 440 }}>
      {title && (
        <strong style={{ fontSize: 15, fontFamily: "var(--font-heading)" }}>{title}</strong>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: title ? 10 : 0 }}>
        {items.map((it, i) => {
          const icon = ICONS[it.platform.trim().toLowerCase()];
          return (
            <a
              key={`${it.platform}-${i}`}
              href={it.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...linkBtn, display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {icon}
              {labelFor(it.platform, it.url)}
            </a>
          );
        })}
      </div>
    </div>
  );
}
