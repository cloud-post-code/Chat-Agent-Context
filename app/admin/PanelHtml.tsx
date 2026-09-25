"use client";

import { HtmlFrame } from "@/app/cards/HtmlFrame";

/** A source's custom page code, in the shared sealed frame on the admin's surface fill. */
export function PanelHtml({ html, height = 520 }: { html: string; height?: number }) {
  return <HtmlFrame html={html} height={height} title="Custom ingestion page" tone="surface" style={{ background: "transparent", marginBottom: 14 }} />;
}
