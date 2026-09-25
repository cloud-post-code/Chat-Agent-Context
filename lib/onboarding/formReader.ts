import type { Crawler, Page } from "./crawl";

/**
 * The business's own booking form, read as it renders: screen by screen,
 * every input with its label, type, required mark and options, exactly as a
 * customer would meet them. This is what the transcriber (formTranscribe.ts)
 * copies into the tenant's form — nothing is normalized here, and nothing is
 * dropped except what a customer can't see.
 *
 * `readBookingForm` drives the page in the job's Playwright browser
 * (Crawler.drive) and clicks through the widget's screens; `snapshotStatic`
 * is the fallback over an already-loaded cheerio page when the browser can't
 * (a plain HTML form embed, or a widget that refuses headless Chromium).
 */

export type SnapElement = {
  tag: "input" | "select" | "textarea" | "radio_group" | "checkbox_group" | "checkbox" | "button" | "tile_list";
  /** label[for] → aria-label → placeholder → wrapping <label> → nearest text above. */
  label: string;
  /** The input's own type attribute: text, email, tel, number, date, file… */
  inputType?: string;
  required: boolean;
  /** select options, radio/checkbox group members, tile texts ("Gel Manicure — $35.00"). */
  options?: string[];
  placeholder?: string;
  value?: string;
  disabled?: boolean;
};

export type Screen = {
  index: number;
  url: string;
  headings: string[];
  elements: SnapElement[];
  /** Visible text, capped — where a policy paragraph or a step's help text lives. */
  text: string;
};

export type FormSnapshot = {
  url: string;
  screens: Screen[];
  how: "playwright" | "static";
  /** True when a cap (screens, time) stopped the read before the form ended. */
  truncated: boolean;
};

/** Screens read per form; past this a customer would have given up too. */
export const MAX_SCREENS = 6;
export const SCREEN_TIMEOUT_MS = 12_000;
export const TOTAL_TIMEOUT_MS = 60_000;

/** True when there is nothing a transcriber could copy: no inputs, no choices, no tiles. */
export function snapshotIsEmpty(s: FormSnapshot | null): boolean {
  if (!s) return true;
  return !s.screens.some((sc) => sc.elements.some((e) => e.tag !== "button"));
}

/**
 * Drive the booking page in the browser and snapshot each screen a customer
 * meets. Null when the page can't be driven at all (the caller falls back to
 * `snapshotStatic`). Never throws.
 */
export async function readBookingForm(
  crawler: Crawler,
  url: string,
  onEvent?: (m: string) => void,
): Promise<FormSnapshot | null> {
  void crawler;
  void url;
  void onEvent;
  // Contract stub — implemented in the reader phase.
  return null;
}

/** One screen, read from a parsed page: inputs, labels, selects, required attributes. */
export function snapshotStatic(page: Page): FormSnapshot {
  return { url: page.url, screens: [], how: "static", truncated: false };
}

/** The snapshot as the transcriber's corpus: `=== SCREEN n <url>` blocks. */
export function serializeSnapshot(s: FormSnapshot): string {
  void s;
  return "";
}
