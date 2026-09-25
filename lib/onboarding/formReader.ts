import type { ElementHandle, Frame, Page as BrowserPage } from "playwright";
import type { Element } from "domhandler";
import { BOOKING_HOSTS, FORM_HOSTS, isReadableUrl, isSafeExternalUrl } from "./bookingPage";
import { pageDiagnostics, type Crawler, type Page } from "./crawl";

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

type SnapElement = {
  tag: "input" | "select" | "textarea" | "radio_group" | "checkbox_group" | "checkbox" | "button" | "tile_list" | "calendar";
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
const MAX_SCREENS = 6;
const SCREEN_TIMEOUT_MS = 12_000;
const TOTAL_TIMEOUT_MS = 60_000;
/** Extra grace on the very first screen only, for a client-rendered booking
 *  app that finishes its network activity before it finishes painting. */
const FIRST_SCREEN_GRACE_MS = 6_000;

/** True when there is nothing a transcriber could copy: no inputs, no choices, no tiles. */
export function snapshotIsEmpty(s: FormSnapshot | null): boolean {
  if (!s) return true;
  return !s.screens.some((sc) => sc.elements.some((e) => e.tag !== "button"));
}

// ── In-page scripts ────────────────────────────────────────────────────────
// Plain-JS STRINGS, not functions (see crawl.ts): Playwright serializes a
// function via toString(), and tsx / Next's bundler inject module-scope
// helpers into compiled functions that don't exist inside the page. String.raw
// keeps the regex backslashes as written; the scripts use no backticks.

/** Text-only cap on a screen's visible text. */
const TEXT_CAP = 2000;
/** Options kept per select / group / tile list. */
const OPTIONS_CAP = 80;
const BUTTONS_CAP = 40;
const ELEMENTS_CAP = 120;
// Every string a page hands over is cut INSIDE the page, before it crosses to
// Node: a label, option or placeholder is the page's to write and it could
// write a megabyte of it.
const LABEL_CAP = 200;
const PLACEHOLDER_CAP = 120;
const OPTION_CAP = 200;
const HEADING_CAP = 160;
const VALUE_CAP = 80;
/** The most a screen may hand over, as JSON, elements dropped from the end past it. */
const SCREEN_BYTES = 64 * 1024;

/**
 * Shared in-page helpers: visibility, label resolution, groups, tile lists,
 * calendars. Every script below is `(() => { LIB; <body> })()`.
 */
const LIB = String.raw`
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const PRICE = /[$£€]\s?\d/;
  const TILE_HEAD = /service|treatment|menu|staff|technician|stylist|therapist|provider|who|location|branch/i;
  const REQ_TAIL = /\s*(\*+|\(\*\)|\(required\))\s*$/i;
  // A blank-filling mask in a placeholder ("(___) ___-____"): a format hint, not the field's name.
  const MASK = /\s*\(?_{2,}[\s()_\-\/.:]*/g;
  // Words on a control that commit a customer to something: never clicked,
  // whether on a button or a tile.
  const NEVER = /\b(book(ing)?( now| appointment)?|reserve|pay\w*|submit|place|complete|finish|send|confirm booking|confirm appointment|checkout|check out|purchase|buy|order|request|get (a )?quote|apply|register|sign ?up|subscribe|donate|rsvp|save|done|agree|accept)\b/i;
  // Words on a button that steer rather than offer: a calendar's paging,
  // going back, undoing — never a tile, never a way forward as a last resort.
  const CONTROL = /^((next|previous|prev)\s+(month|year|week|day|page)|next|continue|proceed|back|previous|prev|cancel|close|clear|reset|reload|remove|delete|edit|change|ok|okay|done|add (more|another)\b.*)$/i;
  // What an ancestor does to everything inside it, read once per script run:
  // faded out (opacity 0 — a modal parked off-stage), or clipped to nothing
  // (overflow hidden on a box with no height — a collapsed accordion panel).
  // Boxes that scroll are not clipping: a customer can scroll to what's below.
  const boxCache = new Map();
  const hides = (a) => {
    let h = boxCache.get(a);
    if (h === undefined) {
      const cs = getComputedStyle(a);
      h = Number(cs.opacity) === 0;
      const clips = (o) => o === "hidden" || o === "clip";
      if (!h && (clips(cs.overflowX) || clips(cs.overflowY))) {
        const r = a.getBoundingClientRect();
        h = r.width === 0 || r.height === 0;
      }
      boxCache.set(a, h);
    }
    return h;
  };
  const hiddenAbove = (el) => {
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      if (hides(a)) return true;
    }
    return false;
  };
  const isVisible = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    return !hiddenAbove(el);
  };
  const rect = (el) => el.getBoundingClientRect();
  // The sheet or dialog an element sits in (a fixed-position ancestor), or
  // null: what is inside one is read against the sheet, not the page under it.
  const overlayOf = (el) => {
    for (let a = el; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).position === "fixed") return a;
    return null;
  };
  const attr = (el, name) => norm(el.getAttribute(name));
  const role = (el) => attr(el, "role").toLowerCase();
  const typeOf = (el) => (el.tagName === "INPUT" ? norm(el.getAttribute("type") || "text").toLowerCase() : "");
  const byId = (id) => { try { return document.getElementById(id); } catch (e) { return null; } };
  const precedes = (a, b) => !!(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_PRECEDING);
  // A label's words without the controls it wraps.
  const labelText = (l) => {
    const c = l.cloneNode(true);
    for (const x of c.querySelectorAll("input, select, textarea, button, option, script, style")) x.remove();
    return norm(c.textContent);
  };
  const labelEls = (el) => {
    const out = [];
    if (el.id) for (const l of document.querySelectorAll("label")) if (l.getAttribute("for") === el.id) out.push(l);
    const w = el.closest("label");
    if (w) out.push(w);
    return out;
  };
  const labelFor = (el) => {
    if (!el.id) return "";
    for (const l of document.querySelectorAll("label")) if (l.getAttribute("for") === el.id) return labelText(l);
    return "";
  };
  const ariaLabel = (el) => attr(el, "aria-label");
  const labelledBy = (el) => norm(attr(el, "aria-labelledby").split(" ").filter(Boolean)
    .map((id) => { const n = byId(id); return n ? n.textContent : ""; }).join(" "));
  const wrapLabel = (el) => { const l = el.closest("label"); return l ? labelText(l) : ""; };
  // A radio's or checkbox's words when they are a bare text node beside it.
  const adjacentText = (el) => {
    const grab = (start, dir) => {
      let out = "";
      for (let n = start; n; n = n[dir]) {
        if (n.nodeType === 3) out = dir === "nextSibling" ? out + " " + n.nodeValue : n.nodeValue + " " + out;
        else if (n.nodeType === 1) {
          if (n.matches("input, select, textarea, button, br")) break;
          out = dir === "nextSibling" ? out + " " + n.textContent : n.textContent + " " + out;
        }
        if (norm(out).length > 80) break;
      }
      return norm(out);
    };
    return grab(el.nextSibling, "nextSibling") || grab(el.previousSibling, "previousSibling");
  };
  // An element's words as shown: text nodes under it whose elements are on
  // screen — a collapsed panel's rows, clipped to nothing, are not its words.
  // Stops early once past max, which callers treat as "too long anyway".
  const visibleText = (el, max) => {
    let out = "";
    let n = 0;
    const walk = (node) => {
      if (out.length > max || ++n > 400) return;
      if (node.nodeType === 3) { out += " " + node.nodeValue; return; }
      if (node.nodeType !== 1 || !isVisible(node)) return;
      for (const c of node.childNodes) walk(c);
    };
    for (const c of el.childNodes) walk(c);
    return norm(out);
  };
  const TEXTY = "h1,h2,h3,h4,h5,h6,p,span,div,label,legend,strong,b,dt,td,th,li,small,em";
  let textEls = null;
  const textCandidates = () => {
    if (textEls) return textEls;
    textEls = [];
    let n = 0;
    for (const el of document.querySelectorAll(TEXTY)) {
      if (++n > 4000) break;
      if (el.children.length > 3) continue;
      if (el.querySelector("input, select, textarea, button")) continue;
      const t = norm(el.textContent);
      if (!t || t.length > 120) continue;
      if (!isVisible(el)) continue;
      const r = rect(el);
      textEls.push({ el, t, top: r.top, bottom: r.bottom, left: r.left, right: r.right });
    }
    return textEls;
  };
  // The nearest short text that starts at or above the element, within ~120px.
  // strict demands it sit wholly above (a group's caption, never a member's label).
  const nearestAboveInfo = (el, exclude, strict) => {
    const r = rect(el);
    const scope = overlayOf(el);
    let best = null;
    for (const c of textCandidates()) {
      if (c.el === el || c.el.contains(el)) continue;
      if (scope && !scope.contains(c.el)) continue;
      if (exclude && exclude.some((x) => x === c.el || x.contains(c.el))) continue;
      if (strict ? c.bottom > r.top + 8 : c.top > r.top + 4) continue;
      if (r.top - c.bottom > 120) continue;
      if (c.left > r.right + 40 || c.right < r.left - 400) continue;
      if (!precedes(c.el, el)) continue;
      if (!best || c.bottom > best.bottom || (c.bottom === best.bottom && precedes(best.el, c.el))) best = c;
    }
    return best ? { t: best.t, dist: Math.max(0, r.top - best.bottom) } : null;
  };
  const nearestAbove = (el, exclude, strict) => { const n = nearestAboveInfo(el, exclude, strict); return n ? n.t : ""; };
  const marked = (raw) => /(\*|\(\*\))\s*$/.test(raw) || /\(required\)\s*$/i.test(raw) || /^\*/.test(raw);
  const strip = (raw) => norm(raw.replace(/^\*+\s*/, "").replace(REQ_TAIL, "").replace(MASK, " ")).slice(0, ${LABEL_CAP});
  const placeholderOf = (el) => (attr(el, "placeholder") || attr(el, "data-placeholder")).slice(0, ${PLACEHOLDER_CAP});
  const optionText = (o) => norm(o.textContent).slice(0, ${OPTION_CAP});
  const resolveLabel = (el, choice) => {
    const tries = [labelFor(el), ariaLabel(el), labelledBy(el), wrapLabel(el), attr(el, "placeholder")];
    if (choice) tries.push(adjacentText(el));
    tries.push(nearestAbove(el, null, false));
    const raw = tries.find(Boolean) || "";
    return { label: strip(raw), marked: marked(raw) };
  };
  const hasRequired = (el) => el.required === true || el.hasAttribute("required") || attr(el, "aria-required") === "true";
  const isDisabled = (el) => el.disabled === true || el.hasAttribute("disabled") || attr(el, "aria-disabled") === "true";
  const isChecked = (el) => el.checked === true || attr(el, "aria-checked") === "true";
  // Styled radios and checkboxes hide the native input and show its label.
  const ctlVisible = (el) => {
    if (isVisible(el)) return true;
    const t = typeOf(el);
    return (t === "radio" || t === "checkbox") && labelEls(el).some(isVisible);
  };
  const CONTROLS = "input, select, textarea, [contenteditable], [role=radio], [role=checkbox], [role=combobox]";
  const controls = () => [...document.querySelectorAll(CONTROLS)].filter((el) => {
    const t = typeOf(el);
    if (t === "hidden" || t === "submit" || t === "button" || t === "reset" || t === "image") return false;
    if (el.tagName !== "INPUT" && el.getAttribute("contenteditable") === "false") return false;
    return ctlVisible(el);
  });
  const isChoice = (el, kind) => typeOf(el) === kind || (el.tagName !== "INPUT" && role(el) === kind);
  // Members of a radio/checkbox group: shared name, else a shared fieldset /
  // radiogroup / group, else the element alone.
  const groupOf = (el, kind, all) => {
    const name = attr(el, "name");
    let members = name ? all.filter((m) => isChoice(m, kind) && attr(m, "name") === name) : [];
    if (members.length < 2) {
      const box = el.closest("fieldset, [role=radiogroup], [role=group]");
      if (box) members = all.filter((m) => isChoice(m, kind) && box.contains(m));
    }
    if (members.length < 2) members = [el];
    return members;
  };
  const groupLabel = (members) => {
    const box = members[0].closest("fieldset, [role=radiogroup], [role=group]");
    if (box && members.every((m) => box.contains(m))) {
      const legend = box.querySelector("legend");
      const raw = (legend && norm(legend.textContent)) || ariaLabel(box) || labelledBy(box);
      if (raw) return { label: strip(raw), marked: marked(raw) };
    }
    const exclude = members.flatMap(labelEls);
    const raw = nearestAbove(members[0], exclude, true);
    return { label: strip(raw), marked: marked(raw) };
  };
  // "I have read and agree to …" beside a small clickable thing that isn't a
  // real checkbox: a widget's own agreement toggle. Read as a checkbox with
  // those words; never ticked by the reader.
  const AGREE = /^(i (have read and )?(agree|accept|acknowledge|consent|understand)\b|by (checking|ticking|signing)\b)/i;
  const agreementRows = () => {
    const out = [];
    let n = 0;
    for (const el of document.querySelectorAll("p, span, div, label, li")) {
      if (++n > 4000) break;
      if (el.children.length > 4 || !isVisible(el)) continue;
      const t = norm(el.textContent);
      if (t.length > 400 || !AGREE.test(t)) continue;
      const parent = el.parentElement;
      if (!parent || parent.querySelector("input[type=checkbox], input[type=radio], [role=checkbox], [role=radio]")) continue;
      const toggle = [...parent.children].find((c) => c !== el && !c.contains(el) && precedes(c, el) && isVisible(c) && clickable(c) && rect(c).width <= 48 && rect(c).height <= 48);
      if (!toggle) continue;
      if (out.some((o) => o.el.contains(el) || el.contains(o.el))) continue;
      out.push({ el, t, toggle });
    }
    return out;
  };
  const headingEls = () => [...document.querySelectorAll("h1, h2, h3, h4, [role=heading], legend")].filter(isVisible);
  // The last heading before an element that ends above it.
  const headingAboveInfo = (el) => {
    const r = rect(el);
    const scope = overlayOf(el);
    let best = null;
    for (const h of headingEls()) {
      if (h.contains(el) || !precedes(h, el)) continue;
      if (scope && !scope.contains(h)) continue;
      const hr = rect(h);
      if (hr.bottom > r.top + 8 || r.top - hr.bottom > 600) continue;
      best = h;
    }
    return best ? { t: norm(best.textContent), dist: Math.max(0, r.top - rect(best).bottom) } : null;
  };
  const headingAbove = (el) => { const h = headingAboveInfo(el); return h ? h.t : ""; };
  // What a list is called: the page's own words nearest above it — a heading
  // when one is as close as any short text (a category's own name, a sheet's
  // title), else that text, else the nearest heading further up.
  const listLabel = (el) => {
    const h = headingAboveInfo(el);
    const n = nearestAboveInfo(el, null, true);
    if (h && (!n || h.dist <= n.dist + 8)) return h.t;
    return n ? n.t : "";
  };
  // A calendar's name: the words above it that aren't the grid's own
  // furniture (weekday letters, a month, a year), looked for from the grid
  // outwards.
  const FURNITURE = /^(su|mo|tu|we|th|fr|sa|sun|mon|tue|wed|thu|fri|sat|[a-z]{3,9}\.? ?\d{4}|\d{4}|[a-z]{3,9})$/i;
  const calendarLabel = (cell) => {
    let anchor = cell;
    for (let i = 0; i < 5 && anchor && anchor !== document.body; i++, anchor = anchor.parentElement) {
      const t = listLabel(anchor);
      if (t && !FURNITURE.test(t)) return t;
    }
    return "";
  };
  const isSelected = (el) =>
    el.matches('[aria-selected="true"], [aria-pressed="true"], [aria-checked="true"]') ||
    /(^|[\s_-])(selected|active|checked|chosen)([\s_-]|$)/i.test(el.className || "") ||
    !!el.querySelector("input:checked");
  const clickable = (el) => {
    const t = el.tagName.toLowerCase();
    if (t === "a" || t === "button") return true;
    const r = role(el);
    if (r === "button" || r === "option" || r === "menuitem" || r === "tab") return true;
    return el.hasAttribute("onclick") || getComputedStyle(el).cursor === "pointer";
  };
  // Sibling clickables that read as a menu: priced, or under a heading naming
  // services / staff / locations. Each list carries its members for the caller.
  // A tile a customer clicks through what's inside it: a row whose only
  // clickable part is a child filling it, or that carries its own radio or
  // checkbox — the row is what the customer sees and what gets picked.
  // The one button a row is picked by ("Book" beside a name), or null.
  const memberButton = (el) => {
    const bs = el.querySelectorAll("button, [role=button], input[type=button], input[type=submit]");
    if (bs.length !== 1) return null;
    const b = bs[0];
    return isVisible(b) && !isDisabled(b) && !submits(b) ? b : null;
  };
  const tileClickable = (el) => {
    if (clickable(el)) return true;
    if (el.querySelector("input[type=radio], input[type=checkbox], [role=radio], [role=checkbox]")) return true;
    const r = rect(el);
    for (const c of el.children) {
      if (!clickable(c)) continue;
      const cr = rect(c);
      if (cr.width * cr.height >= r.width * r.height * 0.6) return true;
    }
    return false;
  };
  const tileLists = () => {
    const groups = new Map();
    let n = 0;
    for (const el of document.querySelectorAll("a, button, li, div, [role=button], [role=option], [role=listitem]")) {
      if (++n > 5000) break;
      if (!el.parentElement || el.closest("nav, header, footer")) continue;
      if (!isVisible(el)) continue;
      const btn = memberButton(el);
      if (!btn && !tileClickable(el)) continue;
      let t = visibleText(el, 200);
      // A button that steers (Next, Back, Add more…) is a control, never a tile.
      if ((el.tagName === "BUTTON" || role(el) === "button") && CONTROL.test(t)) continue;
      // The row's own words, without the button's ("Katherine", not "Katherine Book").
      if (btn) t = norm(t.replace(buttonText(btn), ""));
      if (!t || t.length > 200) continue;
      const list = groups.get(el.parentElement) || [];
      list.push({ el, t, btn });
      groups.set(el.parentElement, list);
    }
    const out = [];
    const taken = [];
    for (const [parent, members] of groups) {
      if (members.length < 3) continue;
      if (taken.some((p) => p.contains(parent))) continue;
      const priced = members.filter((m) => PRICE.test(m.t)).length;
      // A menu-ish word counts only on a real heading: a tab strip or a
      // caption that happens to say "Staff" makes no list of what's under it.
      const realHeading = headingAbove(members[0].el);
      // Every row carrying the same one-word button ("Book" beside each
      // name) is a list picked by its buttons: no single one of three
      // identical buttons can be the booking's own submit.
      const word = members[0].btn ? buttonText(members[0].btn) : "";
      const buttoned = !!word && members.every((m) => m.btn && buttonText(m.btn) === word);
      if (priced < Math.ceil(members.length / 2) && !(realHeading && TILE_HEAD.test(realHeading)) && !buttoned) continue;
      taken.push(parent);
      out.push({ parent, heading: listLabel(members[0].el), members, buttoned });
    }
    return out;
  };
  // Time slots as a page lists them ("9:15 AM"): short clickable texts with a clock time.
  const slotEls = () => {
    const TIME = /\b\d{1,2}:\d{2}\b/;
    const out = [];
    let n = 0;
    for (const el of document.querySelectorAll("button, a, li, div, span, label, [role=option], [role=button], [role=radio]")) {
      if (++n > 6000) break;
      if (el.children.length > 2 || !isVisible(el) || !clickable(el)) continue;
      const t = norm(el.textContent);
      if (t.length > 24 || !TIME.test(t)) continue;
      if (out.some((o) => o.el.contains(el))) continue;
      out.push({ el, t });
    }
    return out;
  };
  const buttonEls = () => [...document.querySelectorAll("button, input[type=submit], input[type=button], a[role=button], [role=button]")];
  const buttonText = (b) => (norm(b.tagName === "INPUT" ? b.value : (b.innerText || b.textContent)) || ariaLabel(b)).slice(0, 80);
  // A control the browser itself would submit a form for: input[type=submit|image],
  // a <button> in a form whose type isn't "button" (no type means submit), a reset.
  const submits = (b) => {
    const type = (b.getAttribute("type") || "").toLowerCase();
    if (b.tagName === "INPUT") return type !== "button";
    if (b.tagName === "BUTTON") return type === "reset" || (type !== "button" && !!b.form);
    return false;
  };
  // Setting a choice inside this control's form would submit it: an onchange
  // handler attribute anywhere up the chain, or a form with an onsubmit one.
  const changeSubmits = (el) => !!el.closest("[onchange]") || !!(el.form && el.form.hasAttribute("onsubmit"))
    || !!el.closest("form[onsubmit]");
  // A month grid: 20+ short numeric cells sharing a parent or grandparent.
  const calendarCells = () => {
    const cells = [];
    let n = 0;
    for (const el of document.querySelectorAll("td, button, div, span, a, li")) {
      if (++n > 6000) break;
      if (el.children.length > 1 || !isVisible(el)) continue;
      const t = norm(el.textContent);
      if (!/^\d{1,2}$/.test(t)) continue;
      if (cells.some((c) => c.el.contains(el))) continue;
      cells.push({ el, n: Number(t) });
    }
    const tally = new Map();
    for (const c of cells) for (const p of [c.el.parentElement, c.el.parentElement && c.el.parentElement.parentElement]) {
      if (!p) continue;
      const list = tally.get(p) || [];
      list.push(c);
      tally.set(p, list);
    }
    let best = null;
    for (const [, list] of tally) if (list.length >= 20 && (!best || list.length > best.length)) best = list;
    return best || [];
  };
  const cellEnabled = (c) => {
    const el = c.el;
    const target = el.closest("button, td, a, [role=gridcell], [role=button]") || el;
    // A grid cell's one child often carries the day's state (a datepicker's inner cell).
    const inner = el.children.length === 1 ? el.firstElementChild : el;
    if (isDisabled(el) || isDisabled(target) || isDisabled(inner)) return false;
    const names = el.className + " " + target.className + " " + inner.className;
    if (/(^|[\s_-])(disabled|past|unavailable|outside|offset|other-?month|muted|inactive)([\s_-]|$)/i.test(names)) return false;
    return getComputedStyle(target).pointerEvents !== "none" && getComputedStyle(inner).pointerEvents !== "none";
  };
`;

/** Evaluates to `{ headings, elements, text }` for the frame's visible screen. */
const SNAPSHOT_BODY = String.raw`
  const all = controls();
  const out = [];
  const done = new Set();
  const push = (el, e) => { if (out.length < ${ELEMENTS_CAP}) out.push({ el, e }); };
  for (const el of all) {
    if (done.has(el)) continue;
    done.add(el);
    const tag = el.tagName.toLowerCase();
    const type = typeOf(el);
    const r = role(el);
    const kind = isChoice(el, "radio") ? "radio" : isChoice(el, "checkbox") ? "checkbox" : "";
    if (kind) {
      const members = groupOf(el, kind, all).filter((m) => !done.has(m) || m === el);
      members.forEach((m) => done.add(m));
      const labels = members.map((m) => resolveLabel(m, true));
      if (kind === "checkbox" && members.length === 1) {
        push(el, { tag: "checkbox", label: labels[0].label, inputType: "checkbox",
          required: hasRequired(el) || labels[0].marked, value: isChecked(el) ? "checked" : "", disabled: isDisabled(el) });
        continue;
      }
      const g = groupLabel(members);
      const checked = members.filter(isChecked).map((m, i) => labels[members.indexOf(m)].label);
      push(members[0], { tag: kind === "radio" ? "radio_group" : "checkbox_group", label: g.label, inputType: kind,
        required: g.marked || members.some(hasRequired) || labels.some((l) => l.marked),
        options: labels.map((l) => l.label).filter(Boolean).slice(0, ${OPTIONS_CAP}),
        value: checked.join(" | "), disabled: members.every(isDisabled) });
      continue;
    }
    const { label, marked: m } = resolveLabel(el, false);
    const required = hasRequired(el) || m;
    const disabled = isDisabled(el);
    if (tag === "select") {
      const options = [...el.options].slice(0, ${OPTIONS_CAP} * 2).map(optionText).filter(Boolean).slice(0, ${OPTIONS_CAP});
      const sel = el.selectedOptions && el.selectedOptions[0];
      push(el, { tag: "select", label, inputType: el.multiple ? "select-multiple" : "select-one", required, options,
        value: el.value ? optionText(sel || { textContent: "" }).slice(0, ${VALUE_CAP}) : "", disabled });
    } else if (r === "combobox" && tag !== "input") {
      const box = byId(attr(el, "aria-controls") || attr(el, "aria-owns"));
      const options = box ? [...box.querySelectorAll("[role=option]")].slice(0, ${OPTIONS_CAP} * 2).map(optionText).filter(Boolean).slice(0, ${OPTIONS_CAP}) : [];
      push(el, { tag: "select", label, inputType: "combobox", required, options, value: norm(el.value || el.textContent).slice(0, ${VALUE_CAP}), disabled });
    } else if (tag === "textarea") {
      push(el, { tag: "textarea", label, required, placeholder: placeholderOf(el), value: norm(el.value).slice(0, ${VALUE_CAP}), disabled });
    } else if (tag !== "input") {
      push(el, { tag: "textarea", label, inputType: "contenteditable", required, placeholder: placeholderOf(el),
        value: norm(el.textContent).slice(0, ${VALUE_CAP}), disabled });
    } else {
      push(el, { tag: "input", label, inputType: type, required, placeholder: placeholderOf(el),
        value: type === "password" ? "" : norm(el.value).slice(0, ${VALUE_CAP}), disabled });
    }
  }
  for (const row of agreementRows()) {
    push(row.el, { tag: "checkbox", label: strip(row.t), inputType: "checkbox", required: marked(row.t), value: isSelected(row.toggle) ? "checked" : "" });
  }
  const tileMembers = new Set();
  for (const list of tileLists()) {
    list.members.forEach((m) => tileMembers.add(m.el));
    const selected = list.members.filter((m) => isSelected(m.el)).map((m) => m.t);
    push(list.members[0].el, { tag: "tile_list", label: list.heading, required: false,
      options: list.members.map((m) => m.t).slice(0, ${OPTIONS_CAP}), value: selected.join(" | ") });
  }
  // A month grid is a screen of its own kind: the calendar and the slots it
  // offers, named by the text above it ("Select Date/Time").
  const cells = calendarCells();
  if (cells.length) {
    push(cells[0].el, { tag: "calendar", label: calendarLabel(cells[0].el), required: false, options: slotEls().map((o) => o.t).slice(0, ${OPTIONS_CAP}) });
  }
  let buttons = 0;
  const seenBtn = new Set();
  for (const b of buttonEls()) {
    if (buttons >= ${BUTTONS_CAP} || seenBtn.has(b) || tileMembers.has(b) || !isVisible(b)) continue;
    if ([...tileMembers].some((t) => t.contains(b))) continue;
    seenBtn.add(b);
    const text = buttonText(b);
    if (!text || /^\d{1,2}$/.test(text)) continue;
    buttons++;
    push(b, { tag: "button", label: text, required: false, disabled: isDisabled(b) });
  }
  out.sort((a, b) => (a.el === b.el ? 0 : precedes(a.el, b.el) ? -1 : 1));
  const headings = headingEls().slice(0, 60).map((h) => norm(h.textContent).slice(0, ${HEADING_CAP})).filter(Boolean).slice(0, 30)
    .filter((h, i, arr) => i === 0 || arr[i - 1] !== h);
  const elements = out.map((x) => {
    const e = x.e;
    for (const k of Object.keys(e)) if (e[k] === "" || e[k] === undefined || e[k] === false && k !== "required") delete e[k];
    if (e.required === undefined) e.required = false;
    return e;
  });
  // The screen's size cap: elements go from the end until the JSON fits.
  const text = norm(document.body ? document.body.innerText : "").slice(0, ${TEXT_CAP});
  let budget = ${SCREEN_BYTES} - JSON.stringify({ headings, text }).length;
  const kept = [];
  for (const e of elements) {
    budget -= JSON.stringify(e).length + 1;
    if (budget < 0) break;
    kept.push(e);
  }
  return { headings, elements: kept, text };
`;

// Each plan script evaluates to { el, state }: the element to click (or null)
// and a word about it. The element crosses to Node as a handle — never as a
// marker attribute the page could move onto a button of its own choosing.

/** The first tile when a tile list shows and nothing is picked yet — never one whose words commit ("Pay $25"). */
const PLAN_TILE_BODY = String.raw`
  const picked = new Set(__PICKED__);
  const lists = tileLists();
  // A list in an overlay (a "Select Staff" sheet over the menu) is the one
  // in front of the customer; the menu behind it is done with.
  const front = lists.filter((l) => !!overlayOf(l.members[0].el));
  const pool = front.length ? front : lists;
  if (!pool.length || pool.some((l) => l.members.some((m) => isSelected(m.el) || picked.has(m.t)))) return { el: null, state: "", text: "" };
  const pick = pool[0].members.find((m) => !NEVER.test(m.t));
  if (!pick) return { el: null, state: "", text: "" };
  return { el: pool[0].buttoned ? pick.btn : pick.el, state: "tile", text: pick.t };
`;

/** Picks the first option of every required, still-empty radio group / select. Evaluates to a count. */
const FILL_CHOICES_BODY = String.raw`
  const all = controls();
  const done = new Set();
  let acted = 0;
  for (const el of all) {
    if (done.has(el)) continue;
    if (isChoice(el, "radio")) {
      const members = groupOf(el, "radio", all);
      members.forEach((m) => done.add(m));
      const g = groupLabel(members);
      const required = g.marked || members.some(hasRequired) || members.some((m) => resolveLabel(m, true).marked);
      if (!required || members.some(isChecked)) continue;
      const first = members.find((m) => !isDisabled(m));
      if (first && !changeSubmits(first)) { first.click(); acted++; }
    } else if (el.tagName === "SELECT") {
      done.add(el);
      if (!(hasRequired(el) || resolveLabel(el, false).marked) || el.value || isDisabled(el)) continue;
      // A select whose change would submit the form is left as it is.
      if (changeSubmits(el)) continue;
      const opt = [...el.options].find((o) => o.value && !o.disabled);
      if (!opt) continue;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
      if (setter && setter.set) setter.set.call(el, opt.value); else el.value = opt.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      acted++;
    }
  }
  return acted;
`;

/** The first enabled day after today in a month grid; state "selected" when one already is. */
const PLAN_DAY_BODY = String.raw`
  const cells = calendarCells();
  if (!cells.length) return { el: null, state: "" };
  const cellSelected = (c) => isSelected(c.el) || isSelected(c.el.parentElement) || (c.el.children.length === 1 && isSelected(c.el.firstElementChild));
  const selectedAt = cells.findIndex(cellSelected);
  // LATER: the day already chosen offers nothing — the next enabled day after it.
  if (__LATER__) {
    const later = selectedAt >= 0 ? cells.slice(selectedAt + 1).find(cellEnabled) : null;
    if (!later) return { el: null, state: "" };
    return { el: later.el.closest("button, td, a, [role=gridcell], [role=button]") || later.el, state: "day" };
  }
  if (selectedAt >= 0) return { el: null, state: "selected" };
  const todayAt = cells.findIndex((c) => {
    const inner = c.el.children.length === 1 ? c.el.firstElementChild : c.el;
    const names = c.el.className + " " + inner.className + " " + (c.el.parentElement ? c.el.parentElement.className : "");
    return /(^|[\s_-])today([\s_-]|$)/i.test(names)
      || [c.el, inner, c.el.parentElement].some((e) => e && e.getAttribute("aria-current") === "date");
  });
  const dom = new Date().getDate();
  let pick = null;
  if (todayAt >= 0) pick = cells.slice(todayAt + 1).find(cellEnabled);
  if (!pick) pick = cells.find((c) => c.n > dom && cellEnabled(c));
  if (!pick) pick = cells.find(cellEnabled);
  if (!pick) return { el: null, state: "" };
  return { el: pick.el.closest("button, td, a, [role=gridcell], [role=button]") || pick.el, state: "day" };
`;

/** The first enabled time slot ("9:15 AM"). */
const PLAN_SLOT_BODY = String.raw`
  for (const { el } of slotEls()) {
    if (isDisabled(el) || isSelected(el)) continue;
    return { el, state: "slot" };
  }
  return { el: null, state: "" };
`;

/**
 * The first enabled "next"-like button; state is its text. Never a
 * "book"/"pay"/"submit"-like one, and never a control the browser would submit
 * a form for (`submits`): a widget whose Next is a submit button is left where
 * it stands rather than risk sending what a customer would have sent. "OK"
 * counts only inside a dialog, where it dismisses rather than commits.
 */
const PLAN_NEXT_BODY = String.raw`
  const GO = /^(next|continue|proceed|select|choose)\b/i;
  const GO2 = /^(select|choose|confirm|book) (service|staff|provider|time|date)/i;
  const DISMISS = /^(ok|okay|close|dismiss|got it)$/i;
  // A calendar's own paging is not a way forward.
  const PAGING = /^(next|previous|prev)\s+(month|year|week|day|page)\b/i;
  // "Continue booking" goes on with the booking: behind a forward word, the
  // booking word is the topic, not a commit. Any other committing word
  // ("Next: Request quote") still refuses the button.
  const FORWARD = /^(next|continue|proceed)\b/i;
  const TOPIC = /\b(book(ing)?|appointments?|reserv(e|ation)|schedul(e|ing))\b/gi;
  const commits = (t) => NEVER.test(t) && !(FORWARD.test(t) && !NEVER.test(t.replace(TOPIC, " ")));
  for (const b of buttonEls()) {
    if (!isVisible(b) || isDisabled(b) || submits(b)) continue;
    const t = buttonText(b);
    if (!t || PAGING.test(t) || commits(t)) continue;
    const inDialog = !!b.closest("dialog, [role=dialog], [role=alertdialog], [aria-modal=true]");
    if (!(GO.test(t) || GO2.test(t) || (inDialog && DISMISS.test(t)))) continue;
    return { el: b, state: t };
  }
  return { el: null, state: "" };
`;

/** Whether the screen has shown anything a customer could act on yet — an
 *  input, a tile to pick, a calendar, or even just a heading. False means the
 *  page answered but a client-rendered app hasn't painted its form yet. */
const HAS_CONTENT_BODY = String.raw`
  return controls().length > 0 || tileLists().length > 0 || calendarCells().length > 0 || headingEls().length > 0;
`;

/**
 * Last resort, tried only once every other plan has found nothing: the first
 * enabled, visible button whose text doesn't read like a commitment (the
 * same `NEVER` list `PLAN_NEXT` refuses) and that the browser wouldn't
 * submit a form for. Some widgets show their menu as an accordion of plain
 * category buttons — no shared parent for `tileLists()` to group, no
 * "next"/"continue" wording for `PLAN_NEXT` to match, nothing to fill or
 * pick — so a customer's only way forward is to click the category itself.
 * Since this runs after every other plan came up empty, it can never
 * preempt a real tile, choice, day, slot or Next button.
 */
const PLAN_EXPAND_BODY = String.raw`
  for (const b of buttonEls()) {
    if (!isVisible(b) || isDisabled(b) || submits(b)) continue;
    const t = buttonText(b);
    if (!t || NEVER.test(t) || CONTROL.test(t)) continue;
    return { el: b, state: t };
  }
  return { el: null, state: "" };
`;

const COUNT_INPUTS = String.raw`(() => {
  let n = 0;
  for (const el of document.querySelectorAll("input:not([type=hidden]), select, textarea")) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) n++;
  }
  return n;
})()`;

/** Installs a mutation counter once; evaluates to its current value. */
const MUTATION_COUNTER = String.raw`(() => {
  if (window.__frMut === undefined) {
    window.__frMut = 0;
    new MutationObserver(() => { window.__frMut++; })
      .observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  }
  return window.__frMut;
})()`;

const script = (body: string) => `(() => {${LIB}\n${body}\n})()`;
const SNAPSHOT = script(SNAPSHOT_BODY);
const HAS_CONTENT = script(HAS_CONTENT_BODY);
const FILL_CHOICES = script(FILL_CHOICES_BODY);
const PLAN_DAY = script(PLAN_DAY_BODY.replace("__LATER__", "false"));
const PLAN_LATER_DAY = script(PLAN_DAY_BODY.replace("__LATER__", "true"));
const PLAN_SLOT = script(PLAN_SLOT_BODY);
const PLAN_NEXT = script(PLAN_NEXT_BODY);
const PLAN_EXPAND = script(PLAN_EXPAND_BODY);

// ── Driving ────────────────────────────────────────────────────────────────

type Shot = Omit<Screen, "index">;

/** Whether the frame's visible screen has shown anything a customer could act
 *  on yet (used directly by tests; `readBookingForm` waits on the same script). */
export async function hasVisibleContent(frame: Frame): Promise<boolean> {
  return (await frame.evaluate(HAS_CONTENT).catch(() => false)) as boolean;
}

/** What a screen IS, for telling one from the next: headings, labels, option counts. Buttons and a calendar's slots excluded — a slot list appearing is the same screen. */
export function fingerprint(s: Pick<Screen, "headings" | "elements">): string {
  return (
    s.headings.map((h) => h.slice(0, HEADING_CAP)).join("|") +
    "||" +
    s.elements
      .filter((e) => e.tag !== "button")
      // A calendar's slots come and go with the day picked; the grid itself is the screen.
      .map((e) => `${e.tag}:${e.label.slice(0, LABEL_CAP)}:${e.tag === "calendar" ? 0 : (e.options?.length ?? 0)}`)
      .join("|")
  );
}

/** One frame's visible screen as the reader sees it. Throws when the frame is gone. */
export async function snapshotFrame(frame: Frame): Promise<Shot> {
  const raw = (await frame.evaluate(SNAPSHOT)) as { headings: string[]; elements: SnapElement[]; text: string };
  return { url: frame.url(), headings: raw.headings, elements: raw.elements, text: raw.text };
}

type Plan = { el: ElementHandle | null; state: string; text: string };

/** Run a plan script: the element it chose, as a handle the caller disposes, its word, and (for a tile) the tile's text. */
async function plan(frame: Frame, script: string): Promise<Plan> {
  const h = await frame.evaluateHandle(script);
  try {
    const elH = await h.getProperty("el");
    const el = elH.asElement();
    if (!el) await elH.dispose();
    const state = String((await (await h.getProperty("state")).jsonValue()) ?? "");
    const text = String((await (await h.getProperty("text")).jsonValue()) ?? "");
    return { el, state, text };
  } finally {
    await h.dispose().catch(() => {});
  }
}

/** What one read has already picked, so a menu that stays on screen after a pick is not picked from twice. */
export type ReadMemory = { picked: Set<string> };

/** The tile plan with the read's own picks written in — as a JSON literal, never as a marker on the page. */
const planTile = (memory: ReadMemory) => script(PLAN_TILE_BODY.replace("__PICKED__", JSON.stringify([...memory.picked].slice(0, 200))));

/**
 * Click the element a plan chose, as a customer would: Playwright's own
 * actionability checks, and nothing else — an element that can't be clicked
 * (covered by an overlay, gone, off-screen for good) is skipped, never
 * clicked through by a synthetic event.
 */
async function clickPlanned(el: ElementHandle): Promise<boolean> {
  try {
    await el.click({ timeout: 2500, noWaitAfter: true });
    return true;
  } catch {
    return false;
  } finally {
    await el.dispose().catch(() => {});
  }
}

/** The mutation counter before an action, so `settle` can tell the action's own change from silence. */
async function mark(frame: Frame): Promise<number | null> {
  return (await frame.evaluate(MUTATION_COUNTER).catch(() => null)) as number | null;
}

/** Nothing moved for this long: the page has finished reacting. */
const QUIET_MS = 400;
/** How long to keep listening after the page went quiet, for a reaction that
 *  comes late — a sheet that opens only once a request the click started
 *  has answered. */
const LATE_MS = 1500;

/**
 * Wait for the frame to react to an action taken after `before`: the first
 * DOM mutation, then quiet (no mutation for QUIET_MS and no request in
 * flight), plus LATE_MS of listening for a late reaction — all within `ms`.
 * With no counter (`before` null) it waits for a navigation to load instead.
 */
async function settle(frame: Frame, ms: number, before: number | null): Promise<void> {
  const page = frame.page();
  if (before === null) {
    await page.waitForLoadState("domcontentloaded", { timeout: ms }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: ms }).catch(() => {});
    return;
  }
  const deadline = Date.now() + ms;
  const left = () => Math.max(1, deadline - Date.now());
  await frame.waitForFunction(`window.__frMut > ${before}`, undefined, { timeout: left() }).catch(() => {});
  let last = await mark(frame);
  while (last !== null && Date.now() < deadline) {
    await page.waitForTimeout(Math.min(QUIET_MS, left()));
    await page.waitForLoadState("networkidle", { timeout: left() }).catch(() => {});
    let now = await mark(frame);
    if (now !== last) {
      last = now;
      continue;
    }
    await frame.waitForFunction(`window.__frMut > ${last}`, undefined, { timeout: Math.min(LATE_MS, left()) }).catch(() => {});
    now = await mark(frame);
    if (now === last) break;
    last = now;
  }
}

/**
 * Move the screen forward the way a customer would, without committing to
 * anything: pick the first tile, the first option of each required choice,
 * a day and a slot, then the "Next"-like button — never "Book", never
 * "Submit", never a keystroke into a text input. Stops as soon as the screen
 * changes so nothing is skipped. Returns the actions taken; empty means the
 * form offers nothing more to do here. `halted` is asked before every action:
 * once it says so (the caller's clock ran out) nothing more is clicked.
 */
export async function advanceFrame(
  frame: Frame,
  halted: () => boolean = () => false,
  memory: ReadMemory = { picked: new Set() },
): Promise<string[]> {
  const actions: string[] = [];
  const start = fingerprint(await snapshotFrame(frame));
  const changed = async () => fingerprint(await snapshotFrame(frame)) !== start;
  // The plan's element, clicked unless the clock ran out meanwhile.
  const act = async (p: Plan): Promise<boolean> => {
    if (!p.el) return false;
    if (halted()) {
      await p.el.dispose().catch(() => {});
      return false;
    }
    return clickPlanned(p.el);
  };

  if (halted()) return actions;
  let before = await mark(frame);
  const tile = await plan(frame, planTile(memory));
  if (await act(tile)) {
    actions.push("tile");
    if (tile.text) memory.picked.add(tile.text);
    await settle(frame, 4000, before);
    if (await changed()) return actions;
  }
  if (halted()) return actions;
  before = await mark(frame);
  const filled = (await frame.evaluate(FILL_CHOICES)) as number;
  if (filled > 0) {
    actions.push(`choices:${filled}`);
    await settle(frame, 1500, before);
    if (await changed()) return actions;
  }
  if (halted()) return actions;
  before = await mark(frame);
  const day = await plan(frame, PLAN_DAY);
  if (day.state === "day" && (await act(day))) {
    actions.push("day");
    await settle(frame, 2500, before);
  }
  if (day.state === "day" || day.state === "selected") {
    if (halted()) return actions;
    before = await mark(frame);
    let slotTaken = await act(await plan(frame, PLAN_SLOT));
    // A day the widget picked for us (today, say) may offer no slot that
    // can still be taken; a customer would move to the next day that does.
    if (!slotTaken && day.state === "selected" && !halted()) {
      const later = await plan(frame, PLAN_LATER_DAY);
      if (later.state === "day" && (await act(later))) {
        actions.push("day");
        await settle(frame, 2500, before);
        if (halted()) return actions;
        before = await mark(frame);
        slotTaken = await act(await plan(frame, PLAN_SLOT));
      }
    }
    if (slotTaken) {
      actions.push("slot");
      await settle(frame, 2500, before);
    }
    if (actions.length && (await changed())) return actions;
  }
  if (halted()) return actions;
  before = await mark(frame);
  const next = await plan(frame, PLAN_NEXT);
  if (next.state && (await act(next))) {
    actions.push(`next:${next.state}`);
    await settle(frame, 4000, before);
    return actions;
  }
  // Nothing to fill, pick or advance with: some widgets show their menu as
  // an accordion of plain category buttons with no shared parent and no
  // "next"-like wording, so the only way forward is the button itself.
  if (!actions.length) {
    if (halted()) return actions;
    before = await mark(frame);
    const expand = await plan(frame, PLAN_EXPAND);
    if (expand.state && (await act(expand))) {
      actions.push(`expand:${expand.state}`);
      await settle(frame, 2500, before);
    }
  }
  return actions;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};
const sameOrigin = (a: string, b: string): boolean => {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
};
/**
 * Where the main frame may be for the reader to look: the booking page's own
 * origin (a public host — the origin is what the tenant typed, so it earns no
 * trust of its own) or a public https host it redirected to.
 */
function pageReadable(pageUrl: string, entryUrl: string): boolean {
  return sameOrigin(pageUrl, entryUrl) ? isReadableUrl(pageUrl) : isSafeExternalUrl(pageUrl);
}
/** A child frame the reader may look into: the page's own, or a booking/form product's. */
function frameReadable(frameUrl: string, entryUrl: string): boolean {
  if (frameUrl.startsWith("about:")) return true;
  if (sameOrigin(frameUrl, entryUrl)) return isReadableUrl(frameUrl);
  if (!isSafeExternalUrl(frameUrl)) return false;
  const host = hostOf(frameUrl);
  return BOOKING_HOSTS.test(host) || FORM_HOSTS.test(host);
}

/**
 * The frame with the form: the main frame unless a booking/form iframe holds
 * more inputs. Null when the main frame itself is somewhere the reader may
 * not look — a frame is never read on the strength of where the page started.
 */
async function pickFrame(page: BrowserPage, entryUrl: string): Promise<Frame | null> {
  const main = page.mainFrame();
  if (!pageReadable(main.url(), entryUrl)) return null;
  let best = main;
  let bestN = -1;
  for (const f of page.frames()) {
    if (f !== main && !frameReadable(f.url(), entryUrl)) continue;
    const n = (await f.evaluate(COUNT_INPUTS).catch(() => -1)) as number;
    if (n > bestN) {
      best = f;
      bestN = n;
    }
  }
  return best;
}

class CapTimeout extends Error {}
/** Rejects with CapTimeout after `ms`, telling `onTimeout` first so the work still running stops acting. */
const withTimeout = <T>(work: Promise<T>, ms: number, onTimeout: () => void): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      onTimeout();
      reject(new CapTimeout("screen cap"));
    }, ms);
    work.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });

/**
 * Drive the booking page in the browser and snapshot each screen a customer
 * meets. Null when the page can't be driven at all (the caller falls back to
 * `snapshotStatic`). Never throws.
 *
 * Where the page IS is checked before every snapshot, not after: the browser
 * context refuses to load anything off the public internet (crawl.ts
 * guardedContext), and on top of that a screen is only ever taken from a frame
 * whose url the reader may read, and only such screens are returned.
 *
 * `referer` is the page a real visitor would have clicked through from (the
 * business's own homepage) — some booking widgets refuse to render for a
 * cold, referrer-less navigation the way ours otherwise is.
 */
export async function readBookingForm(
  crawler: Crawler,
  url: string,
  onEvent?: (m: string) => void,
  referer?: string,
): Promise<FormSnapshot | null> {
  const safeHere = (u: string) => pageReadable(u, url);
  const screenOk = (s: Screen) => safeHere(s.url) || frameReadable(s.url, url);
  try {
    return await crawler.drive(url, async (page) => {
      const deadline = Date.now() + TOTAL_TIMEOUT_MS;

      // One full pass: navigate (a plain reload on a retry — nothing carries
      // over from a prior pass), then walk screens until the form ends, the
      // clock runs out, or nothing changes twice in a row.
      const once = async (): Promise<FormSnapshot | null> => {
        const memory: ReadMemory = { picked: new Set() };
        const screens: Screen[] = [];
        const seen = new Set<string>();
        let truncated = false;
        // Set when a screen's clock runs out: the step still running must then
        // neither click nor add to `screens`, which the caller has taken.
        let aborted = false;
        const halted = () => aborted;
        const finish = (): FormSnapshot => ({ url, screens: screens.filter(screenOk), how: "playwright", truncated });

        const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000, ...(referer ? { referer } : {}) });
        if (res && !res.ok()) {
          onEvent?.(`Booking page answered ${res.status()}`);
          return null;
        }
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
        if (!safeHere(page.url())) {
          onEvent?.("Booking page redirected somewhere the reader doesn't follow");
          return null;
        }

        // One screen: snapshot it (new fingerprint → a Screen), then try to advance.
        const step = async (): Promise<"new" | "same" | "end" | "unsafe"> => {
          if (!safeHere(page.url())) return "unsafe";
          const frame = await pickFrame(page, url);
          if (!frame) return "unsafe";
          // A client-rendered booking app can finish its network activity
          // before it finishes painting; give the very first screen one more
          // bounded wait for anything a customer could actually see. Later
          // screens already wait on their own action's mutation (`settle`).
          if (screens.length === 0) {
            const left = deadline - Date.now();
            if (left > 0) {
              await frame.waitForFunction(HAS_CONTENT, undefined, { timeout: Math.min(FIRST_SCREEN_GRACE_MS, left) }).catch(() => {});
            }
          }
          const shot = await snapshotFrame(frame);
          // The frame may have moved under the snapshot: a screen from anywhere
          // the reader may not look is not a screen.
          if (aborted || !screenOk({ index: 0, ...shot }) || !safeHere(page.url())) return aborted ? "same" : "unsafe";
          const fp = fingerprint(shot);
          const isNew = !seen.has(fp);
          if (isNew) {
            seen.add(fp);
            screens.push({ index: screens.length + 1, ...shot });
            onEvent?.(`Booking form screen ${screens.length}: ${shot.headings[0] ?? "(no heading)"}`);
          }
          if (screens.length >= MAX_SCREENS) return isNew ? "new" : "same";
          const actions = await advanceFrame(frame, halted, memory);
          if (!actions.length) return "end";
          if (!safeHere(page.url())) return "unsafe";
          return isNew ? "new" : "same";
        };

        let stale = 0;
        for (;;) {
          const left = deadline - Date.now();
          if (left <= 0) {
            truncated = true;
            break;
          }
          let outcome: Awaited<ReturnType<typeof step>>;
          try {
            outcome = await withTimeout(step(), Math.min(SCREEN_TIMEOUT_MS, left), () => (aborted = true));
          } catch (err) {
            if (err instanceof CapTimeout) {
              truncated = true;
              break;
            }
            throw err;
          }
          if (outcome === "unsafe") {
            onEvent?.("Booking form left for a host the reader doesn't follow");
            return null;
          }
          if (outcome === "end") break;
          if (screens.length >= MAX_SCREENS) {
            truncated = true;
            break;
          }
          stale = outcome === "same" ? stale + 1 : 0;
          if (stale >= 2) break;
        }
        aborted = true;
        return finish();
      };

      const first = await once();
      // A page that answered but never showed anything a customer could act
      // on is more often a slow first paint than an actual empty form — one
      // more full reload, while there's still time left, before giving up.
      // Either way the line says what the page's own requests ran into, so a
      // blocked or failing widget is named rather than guessed at.
      const why = () => {
        const d = pageDiagnostics(page);
        return d ? ` — ${d}` : "";
      };
      if (first && snapshotIsEmpty(first) && Date.now() < deadline) {
        onEvent?.(`Booking page loaded but showed nothing yet${why()} — trying once more`);
        const second = await once();
        if (second && !snapshotIsEmpty(second)) return second;
        onEvent?.(`Booking page showed nothing twice${why()}`);
      }
      return first;
    });
  } catch (err) {
    onEvent?.(`Booking form could not be read: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
    return null;
  }
}

// ── Static fallback ────────────────────────────────────────────────────────

const REQ_TAIL = /\s*(\*+|\(\*\)|\(required\))\s*$/i;
/** A blank-filling mask in a placeholder ("(___) ___-____"): a format hint, not the field's name. */
const MASK = /\s*\(?_{2,}[\s()_\-\/.:]*/g;
const isMarked = (raw: string) => /(\*|\(\*\))\s*$/.test(raw) || /\(required\)\s*$/i.test(raw) || /^\*/.test(raw);
const stripMark = (raw: string) =>
  raw.replace(/^\*+\s*/, "").replace(REQ_TAIL, "").replace(MASK, " ").replace(/\s+/g, " ").trim().slice(0, LABEL_CAP);
const PRICE = /[$£€]\s?\d/;
const TILE_HEAD = /service|treatment|menu|staff|technician|stylist|therapist|provider|who|location|branch/i;

/** One screen, read from a parsed page: inputs, labels, selects, required attributes. */
export function snapshotStatic(page: Page): FormSnapshot {
  const $ = page.$;
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const hiddenInline = (el: Element): boolean =>
    $(el)
      .parents()
      .addBack()
      .toArray()
      .some((p) => /display\s*:\s*none/i.test($(p).attr("style") ?? "") || $(p).is("script, style, noscript, template"));
  const labelText = (l: Element) => {
    const c = $(l).clone();
    c.find("input, select, textarea, button, option").remove();
    return norm(c.text());
  };
  const labelEls = (el: Element): Element[] => {
    const out: Element[] = [];
    const id = $(el).attr("id");
    if (id) $("label").each((_, l) => { if ($(l).attr("for") === id) out.push(l); });
    const w = $(el).closest("label");
    if (w.length) out.push(w[0] as Element);
    return out;
  };
  const labelledBy = (el: Element) =>
    norm(($(el).attr("aria-labelledby") ?? "").split(/\s+/).filter(Boolean).map((id) => $(`[id="${id.replace(/"/g, "")}"]`).first().text()).join(" "));
  // Every element in document order, so "the nearest preceding text" has a meaning without geometry.
  const flow = $("body *").toArray();
  const at = new Map(flow.map((el, i) => [el, i] as const));
  const TEXTY = "h1,h2,h3,h4,h5,h6,p,span,div,label,legend,strong,b,dt,td,th,li,small,em";
  const nearestAbove = (el: Element, exclude: Element[]): string => {
    const i = at.get(el) ?? -1;
    for (let j = i - 1; j >= 0 && j >= i - 40; j--) {
      const c = flow[j];
      if (!$(c).is(TEXTY) || $(c).find("input, select, textarea, button").length) continue;
      if ($(c).find(el).length || exclude.some((x) => x === c || $(x).find(c).length)) continue;
      if ($(c).children().length > 3 || hiddenInline(c)) continue;
      const t = norm($(c).text());
      if (t && t.length <= 120) return t;
    }
    return "";
  };
  const adjacentText = (el: Element): string => {
    const grab = (dir: "next" | "prev") => {
      let out = "";
      let n = dir === "next" ? el.next : el.prev;
      while (n) {
        if (n.type === "text") out = dir === "next" ? `${out} ${n.data}` : `${n.data} ${out}`;
        else if (n.type === "tag") {
          if ($(n).is("input, select, textarea, button, br")) break;
          out = dir === "next" ? `${out} ${$(n).text()}` : `${$(n).text()} ${out}`;
        }
        if (norm(out).length > 80) break;
        n = dir === "next" ? n.next : n.prev;
      }
      return norm(out);
    };
    return grab("next") || grab("prev");
  };
  const resolveLabel = (el: Element, choice: boolean) => {
    const id = $(el).attr("id");
    let forText = "";
    if (id) $("label").each((_, l) => { if (!forText && $(l).attr("for") === id) forText = labelText(l); });
    const wrap = $(el).closest("label");
    const tries = [forText, norm($(el).attr("aria-label") ?? ""), labelledBy(el), wrap.length ? labelText(wrap[0] as Element) : "", norm($(el).attr("placeholder") ?? "")];
    if (choice) tries.push(adjacentText(el));
    tries.push(nearestAbove(el, []));
    const raw = tries.find(Boolean) ?? "";
    return { label: stripMark(raw), marked: isMarked(raw) };
  };
  const hasRequired = (el: Element) => $(el).is("[required], [aria-required=true]");
  const isDisabled = (el: Element) => $(el).is("[disabled], [aria-disabled=true]");
  const isChecked = (el: Element) => $(el).is("[checked], [aria-checked=true]");
  const typeOf = (el: Element) => (el.tagName.toLowerCase() === "input" ? ($(el).attr("type") ?? "text").toLowerCase() : "");
  const isChoice = (el: Element, kind: string) =>
    typeOf(el) === kind || (el.tagName.toLowerCase() !== "input" && ($(el).attr("role") ?? "").toLowerCase() === kind);

  const controls = $("input, select, textarea, [contenteditable], [role=radio], [role=checkbox], [role=combobox]")
    .toArray()
    .filter((el) => {
      const t = typeOf(el);
      if (["hidden", "submit", "button", "reset", "image"].includes(t)) return false;
      if (el.tagName.toLowerCase() !== "input" && $(el).attr("contenteditable") === "false") return false;
      return !hiddenInline(el);
    });
  const groupOf = (el: Element, kind: string): Element[] => {
    const name = $(el).attr("name");
    let members = name ? controls.filter((m) => isChoice(m, kind) && $(m).attr("name") === name) : [];
    if (members.length < 2) {
      const box = $(el).closest("fieldset, [role=radiogroup], [role=group]");
      if (box.length) members = controls.filter((m) => isChoice(m, kind) && box.find(m).length > 0);
    }
    return members.length < 2 ? [el] : members;
  };
  const groupLabel = (members: Element[]) => {
    const box = $(members[0]).closest("fieldset, [role=radiogroup], [role=group]");
    if (box.length && members.every((m) => box.find(m).length)) {
      const raw = norm(box.find("legend").first().text()) || norm(box.attr("aria-label") ?? "") || labelledBy(box[0] as Element);
      if (raw) return { label: stripMark(raw), marked: isMarked(raw) };
    }
    const raw = nearestAbove(members[0], members.flatMap(labelEls));
    return { label: stripMark(raw), marked: isMarked(raw) };
  };

  const out: { el: Element; e: SnapElement }[] = [];
  const done = new Set<Element>();
  const clean = (e: SnapElement): SnapElement => {
    const r = e as Record<string, unknown>;
    for (const k of Object.keys(r)) if (r[k] === "" || r[k] === undefined || (r[k] === false && k !== "required")) delete r[k];
    return e;
  };
  for (const el of controls) {
    if (done.has(el)) continue;
    done.add(el);
    const tag = el.tagName.toLowerCase();
    const kind = isChoice(el, "radio") ? "radio" : isChoice(el, "checkbox") ? "checkbox" : "";
    if (kind) {
      const members = groupOf(el, kind).filter((m) => !done.has(m) || m === el);
      members.forEach((m) => done.add(m));
      const labels = members.map((m) => resolveLabel(m, true));
      if (kind === "checkbox" && members.length === 1) {
        out.push({ el, e: clean({ tag: "checkbox", label: labels[0].label, inputType: "checkbox", required: hasRequired(el) || labels[0].marked, value: isChecked(el) ? "checked" : "", disabled: isDisabled(el) }) });
        continue;
      }
      const g = groupLabel(members);
      out.push({
        el: members[0],
        e: clean({
          tag: kind === "radio" ? "radio_group" : "checkbox_group",
          label: g.label,
          inputType: kind,
          required: g.marked || members.some(hasRequired) || labels.some((l) => l.marked),
          options: labels.map((l) => l.label).filter(Boolean).slice(0, OPTIONS_CAP),
          value: members.filter(isChecked).map((m) => labels[members.indexOf(m)].label).join(" | "),
          disabled: members.every(isDisabled),
        }),
      });
      continue;
    }
    const { label, marked } = resolveLabel(el, false);
    const required = hasRequired(el) || marked;
    const disabled = isDisabled(el);
    if (tag === "select") {
      const opts = $(el).find("option").toArray();
      const options = opts.map((o) => norm($(o).text()).slice(0, OPTION_CAP)).filter(Boolean).slice(0, OPTIONS_CAP);
      const sel = opts.find((o) => $(o).is("[selected]") && ($(o).attr("value") ?? norm($(o).text())) !== "");
      out.push({ el, e: clean({ tag: "select", label, inputType: $(el).is("[multiple]") ? "select-multiple" : "select-one", required, options, value: sel ? norm($(sel).text()) : "", disabled }) });
    } else if (tag !== "input" && ($(el).attr("role") ?? "").toLowerCase() === "combobox") {
      const boxId = $(el).attr("aria-controls") ?? $(el).attr("aria-owns") ?? "";
      const options = boxId ? $(`[id="${boxId.replace(/"/g, "")}"] [role=option]`).toArray().map((o) => norm($(o).text()).slice(0, OPTION_CAP)).filter(Boolean).slice(0, OPTIONS_CAP) : [];
      out.push({ el, e: clean({ tag: "select", label, inputType: "combobox", required, options, value: norm($(el).text()).slice(0, 80), disabled }) });
    } else if (tag === "textarea") {
      out.push({ el, e: clean({ tag: "textarea", label, required, placeholder: norm($(el).attr("placeholder") ?? "").slice(0, PLACEHOLDER_CAP), value: norm($(el).text()).slice(0, 80), disabled }) });
    } else if (tag !== "input") {
      out.push({ el, e: clean({ tag: "textarea", label, inputType: "contenteditable", required, placeholder: norm($(el).attr("placeholder") ?? $(el).attr("data-placeholder") ?? "").slice(0, PLACEHOLDER_CAP), value: norm($(el).text()).slice(0, 80), disabled }) });
    } else {
      const type = typeOf(el);
      out.push({ el, e: clean({ tag: "input", label, inputType: type, required, placeholder: norm($(el).attr("placeholder") ?? "").slice(0, PLACEHOLDER_CAP), value: type === "password" ? "" : norm($(el).attr("value") ?? "").slice(0, 80), disabled }) });
    }
  }

  // Tile lists: three or more clickable siblings, priced or under a menu-ish heading.
  const headingsAll = $("h1, h2, h3, h4, [role=heading], legend").toArray().filter((h) => !hiddenInline(h));
  const headingAbove = (el: Element): string => {
    const i = at.get(el) ?? -1;
    let best: Element | null = null;
    for (const h of headingsAll) {
      const j = at.get(h) ?? -1;
      if (j < i && !$(h).find(el).length) best = h;
    }
    return best ? norm($(best).text()) : "";
  };
  // A plain div's cursor:pointer lives in a stylesheet cheerio never sees, so
  // divs count only through the priced rule — a row of priced siblings is a
  // menu whatever its cursor.
  const groups = new Map<Element, { el: Element; t: string; plain: boolean }[]>();
  $("a, button, li, div, [role=button], [role=option], [role=listitem]").each((_, el) => {
    const parent = el.parent && el.parent.type === "tag" ? (el.parent as Element) : null;
    if (!parent || $(el).closest("nav, header, footer").length || hiddenInline(el)) return;
    if ($(el).find("input, select, textarea, h1, h2, h3, h4, p").length) return;
    const t = norm($(el).text());
    if (!t || t.length > 200) return;
    const plain = el.tagName.toLowerCase() === "div" && !$(el).is("[onclick], [role]");
    const list = groups.get(parent) ?? [];
    list.push({ el, t, plain });
    groups.set(parent, list);
  });
  const tileMembers = new Set<Element>();
  const taken: Element[] = [];
  for (const [parent, members] of groups) {
    if (members.length < 3 || taken.some((p) => $(p).find(parent).length)) continue;
    const priced = members.filter((m) => PRICE.test(m.t)).length >= Math.ceil(members.length / 2);
    const heading = headingAbove(members[0].el);
    const clickable = members.filter((m) => !m.plain).length >= 3;
    if (!priced && !(clickable && heading && TILE_HEAD.test(heading))) continue;
    taken.push(parent);
    members.forEach((m) => tileMembers.add(m.el));
    out.push({ el: members[0].el, e: clean({ tag: "tile_list", label: heading, required: false, options: members.map((m) => m.t).slice(0, OPTIONS_CAP) }) });
  }

  let buttons = 0;
  $("button, input[type=submit], input[type=button], a[role=button]").each((_, b) => {
    if (buttons >= BUTTONS_CAP || tileMembers.has(b) || hiddenInline(b)) return;
    if ([...tileMembers].some((t) => $(t).find(b).length)) return;
    const text = norm(b.tagName.toLowerCase() === "input" ? ($(b).attr("value") ?? "") : $(b).text()) || norm($(b).attr("aria-label") ?? "");
    if (!text || /^\d{1,2}$/.test(text)) return;
    buttons++;
    out.push({ el: b, e: clean({ tag: "button", label: text.slice(0, 80), required: false, disabled: isDisabled(b) }) });
  });
  // A booking or form widget embedded in the page: its questions live in the frame.
  $("iframe[src]").each((_, f) => {
    const src = $(f).attr("src") ?? "";
    if (!isSafeExternalUrl(src)) return;
    const host = hostOf(src);
    if (BOOKING_HOSTS.test(host) || FORM_HOSTS.test(host)) out.push({ el: f, e: { tag: "button", label: `iframe: ${src.slice(0, 200)}`, required: false } });
  });

  out.sort((a, b) => (at.get(a.el) ?? 0) - (at.get(b.el) ?? 0));
  const headings = headingsAll.map((h) => norm($(h).text()).slice(0, 160)).filter(Boolean).slice(0, 30).filter((h, i, arr) => i === 0 || arr[i - 1] !== h);
  const body = $("body").clone();
  body.find("script, style, noscript, template").remove();
  const text = norm(body.text()).slice(0, TEXT_CAP);
  return {
    url: page.url,
    screens: [{ index: 1, url: page.url, headings, elements: out.slice(0, ELEMENTS_CAP).map((x) => x.e), text }],
    how: "static",
    truncated: false,
  };
}

// ── Serialization ──────────────────────────────────────────────────────────

const SCREEN_CHARS = 12_000;
const TOTAL_CHARS = 40_000;
/** One element's line: a label, a placeholder and a long option list fit; nothing needs more. */
const ELEMENT_CHARS = 4_000;
const CUT = "…[cut]";

const cut = (s: string, max: number) => (s.length <= max ? s : s.slice(0, Math.max(0, max - CUT.length)) + CUT);

function serializeElement(e: SnapElement): string {
  const head = e.inputType && e.inputType !== e.tag ? `${e.tag}, ${e.inputType}` : e.tag;
  let line = `- [${head}] ${JSON.stringify(e.label.slice(0, LABEL_CAP))}`;
  if (e.required) line += ", required";
  if (e.disabled) line += ", disabled";
  if (e.placeholder) line += `, placeholder ${JSON.stringify(e.placeholder.slice(0, PLACEHOLDER_CAP))}`;
  if (e.value) line += `, value ${JSON.stringify(e.value.slice(0, VALUE_CAP))}`;
  if (e.options?.length) line += `, options: ${e.options.slice(0, OPTIONS_CAP).map((o) => o.slice(0, OPTION_CAP)).join(" | ")}`;
  return cut(line, ELEMENT_CHARS);
}

/** The snapshot as the transcriber's corpus: `=== SCREEN n <url>` blocks. */
export function serializeSnapshot(s: FormSnapshot): string {
  const blocks = s.screens.map((sc) => {
    const lines = [`=== SCREEN ${sc.index} ${sc.url}`];
    if (sc.headings.length) lines.push("HEADINGS:", ...sc.headings.map((h) => `- ${h}`));
    const fields = sc.elements.filter((e) => e.tag !== "button");
    const buttons = sc.elements.filter((e) => e.tag === "button");
    if (fields.length) lines.push("ELEMENTS:", ...fields.map(serializeElement));
    if (buttons.length) lines.push("BUTTONS:", ...buttons.map((b) => `- ${b.label}${b.disabled ? " (disabled)" : ""}`));
    if (sc.text) lines.push("TEXT:", sc.text);
    return cut(lines.join("\n"), SCREEN_CHARS);
  });
  return cut(blocks.join("\n\n"), TOTAL_CHARS);
}
