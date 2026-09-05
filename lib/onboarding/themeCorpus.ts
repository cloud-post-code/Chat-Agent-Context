import type { Crawler, Page } from "./crawl";

/**
 * Builds the theme prompt's input. Kept out of extract.ts so proofs can run
 * it directly: extract.ts imports next/font at module load, which only works
 * inside the Next runtime.
 */

/** The RENDERED corpus section: computed styles measured in the browser. */
function renderedLines(home: Page | undefined): string {
  const r = home?.rendered;
  if (!r) return "";
  const fills = r.brandColors.map((c) => `${c.hex} (${c.count} elements)`).join(", ");
  return [
    `page background: ${r.bg}`,
    `page text color: ${r.text}`,
    `body font family: ${r.fontFamily}`,
    `body font size: ${r.fontSizePx}px`,
    r.headingWeight ? `heading font-weight: ${r.headingWeight}` : "",
    `control corner radius: ${r.radiusPx}px`,
    fills ? `saturated fills: ${fills}` : "saturated fills: none found",
  ].filter(Boolean).join("\n");
}

/**
 * The theme prompt's input: rendered computed styles, the site's own CSS
 * (inline <style> plus same-origin external stylesheets — most sites keep
 * their theme in linked files, which the old inline-only corpus never saw),
 * and the homepage's image candidates.
 */
export async function themeCorpus(
  crawler: Crawler,
  pages: Page[],
): Promise<{ corpus: string; imageUrls: string[] }> {
  let css = pages.map((p) => p.$("style").text()).join("\n");
  const home = pages[0];
  const sheetUrls: string[] = [];
  home?.$('link[rel="stylesheet"]').each((_, el) => {
    const href = home.$(el).attr("href");
    const abs = href ? crawler.resolve(href, home.url) : null;
    if (abs && sheetUrls.length < 4) sheetUrls.push(abs);
  });
  for (const u of sheetUrls) {
    if (css.length >= 30_000) break;
    css += `\n${(await crawler.loadText(u)) ?? ""}`;
  }
  css = css.slice(0, 30_000);

  const imageUrls: string[] = [];
  const lines: string[] = [];
  home?.$("img").each((_, el) => {
    if (lines.length >= 40) return;
    const $el = home.$(el);
    const src = $el.attr("data-crawl-src") || $el.attr("src");
    if (!src) return;
    imageUrls.push(src);
    lines.push(`${src} | ${$el.attr("class") || ""} | ${$el.attr("alt") || ""}`);
  });
  return {
    corpus: `RENDERED:\n${renderedLines(home)}\n\nCSS:\n${css}\n\nIMAGES:\n${lines.join("\n")}`,
    imageUrls,
  };
}
