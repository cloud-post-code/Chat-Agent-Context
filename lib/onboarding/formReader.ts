import type { Frame, Page as BrowserPage } from "playwright";
import type { Element } from "domhandler";
import { BOOKING_HOSTS, FORM_HOSTS, isSafeExternalUrl } from "./bookingPage";
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

/**
 * Shared in-page helpers: visibility, label resolution, groups, tile lists,
 * calendars. Every script below is `(() => { LIB; <body> })()`.
 */
const LIB = String.raw`
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const PRICE = /[$£€]\s?\d/;
  const TILE_HEAD = /service|treatment|menu|staff|technician|stylist|therapist|provider|who|location|branch/i;
  const REQ_TAIL = /\s*(\*+|\(required\))\s*$/i;
  const isVisible = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const rect = (el) => el.getBoundingClientRect();
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
  const nearestAbove = (el, exclude, strict) => {
    const r = rect(el);
    let best = null;
    for (const c of textCandidates()) {
      if (c.el === el || c.el.contains(el)) continue;
      if (exclude && exclude.some((x) => x === c.el || x.contains(c.el))) continue;
      if (strict ? c.bottom > r.top + 8 : c.top > r.top + 4) continue;
      if (r.top - c.bottom > 120) continue;
      if (c.left > r.right + 40 || c.right < r.left - 400) continue;
      if (!precedes(c.el, el)) continue;
      if (!best || c.bottom > best.bottom || (c.bottom === best.bottom && precedes(best.el, c.el))) best = c;
    }
    return best ? best.t : "";
  };
  const marked = (raw) => /\*\s*$/.test(raw) || /\(required\)\s*$/i.test(raw) || /^\*/.test(raw);
  const strip = (raw) => norm(raw.replace(/^\*+\s*/, "").replace(REQ_TAIL, ""));
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
  const headingEls = () => [...document.querySelectorAll("h1, h2, h3, h4, [role=heading], legend")].filter(isVisible);
  // The last heading before an element that ends above it.
  const headingAbove = (el) => {
    const r = rect(el);
    let best = null;
    for (const h of headingEls()) {
      if (h.contains(el) || !precedes(h, el)) continue;
      const hr = rect(h);
      if (hr.bottom > r.top + 8 || r.top - hr.bottom > 600) continue;
      best = h;
    }
    return best ? norm(best.textContent) : "";
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
  const tileLists = () => {
    const groups = new Map();
    let n = 0;
    for (const el of document.querySelectorAll("a, button, li, div, [role=button], [role=option], [role=listitem]")) {
      if (++n > 5000) break;
      if (!el.parentElement || el.closest("nav, header, footer")) continue;
      if (!isVisible(el) || !clickable(el)) continue;
      const t = norm(el.innerText || el.textContent);
      if (!t || t.length > 200) continue;
      const list = groups.get(el.parentElement) || [];
      list.push({ el, t });
      groups.set(el.parentElement, list);
    }
    const out = [];
    const taken = [];
    for (const [parent, members] of groups) {
      if (members.length < 3) continue;
      if (taken.some((p) => p.contains(parent))) continue;
      const priced = members.filter((m) => PRICE.test(m.t)).length;
      const heading = headingAbove(members[0].el);
      if (priced < Math.ceil(members.length / 2) && !(heading && TILE_HEAD.test(heading))) continue;
      taken.push(parent);
      out.push({ parent, heading, members });
    }
    return out;
  };
  const buttonEls = () => [...document.querySelectorAll("button, input[type=submit], input[type=button], a[role=button], [role=button]")];
  const buttonText = (b) => norm(b.tagName === "INPUT" ? b.value : (b.innerText || b.textContent)) || ariaLabel(b);
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
    if (isDisabled(el) || isDisabled(target)) return false;
    if (/(^|[\s_-])(disabled|past|unavailable|outside|other-?month|muted|inactive)([\s_-]|$)/i.test(el.className + " " + target.className)) return false;
    return getComputedStyle(target).pointerEvents !== "none";
  };
  const fingerprintOf = (snap) => snap.headings.join("|") + "||" +
    snap.elements.filter((e) => e.tag !== "button").map((e) => e.tag + ":" + e.label + ":" + (e.options ? e.options.length : 0)).join("|");
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
      const options = [...el.options].map((o) => norm(o.textContent)).filter(Boolean).slice(0, ${OPTIONS_CAP});
      const sel = el.selectedOptions && el.selectedOptions[0];
      push(el, { tag: "select", label, inputType: el.multiple ? "select-multiple" : "select-one", required, options,
        value: el.value ? norm(sel && sel.textContent) : "", disabled });
    } else if (r === "combobox" && tag !== "input") {
      const box = byId(attr(el, "aria-controls") || attr(el, "aria-owns"));
      const options = box ? [...box.querySelectorAll("[role=option]")].map((o) => norm(o.textContent)).filter(Boolean).slice(0, ${OPTIONS_CAP}) : [];
      push(el, { tag: "select", label, inputType: "combobox", required, options, value: norm(el.value || el.textContent).slice(0, 80), disabled });
    } else if (tag === "textarea") {
      push(el, { tag: "textarea", label, required, placeholder: attr(el, "placeholder"), value: norm(el.value).slice(0, 80), disabled });
    } else if (tag !== "input") {
      push(el, { tag: "textarea", label, inputType: "contenteditable", required, placeholder: attr(el, "placeholder") || attr(el, "data-placeholder"),
        value: norm(el.textContent).slice(0, 80), disabled });
    } else {
      push(el, { tag: "input", label, inputType: type, required, placeholder: attr(el, "placeholder"),
        value: type === "password" ? "" : norm(el.value).slice(0, 80), disabled });
    }
  }
  const tileMembers = new Set();
  for (const list of tileLists()) {
    list.members.forEach((m) => tileMembers.add(m.el));
    const selected = list.members.filter((m) => isSelected(m.el)).map((m) => m.t);
    push(list.members[0].el, { tag: "tile_list", label: list.heading, required: false,
      options: list.members.map((m) => m.t).slice(0, ${OPTIONS_CAP}), value: selected.join(" | ") });
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
    push(b, { tag: "button", label: text.slice(0, 80), required: false, disabled: isDisabled(b) });
  }
  out.sort((a, b) => (a.el === b.el ? 0 : precedes(a.el, b.el) ? -1 : 1));
  const headings = headingEls().map((h) => norm(h.textContent).slice(0, 160)).filter(Boolean).slice(0, 30)
    .filter((h, i, arr) => i === 0 || arr[i - 1] !== h);
  const elements = out.map((x) => {
    const e = x.e;
    for (const k of Object.keys(e)) if (e[k] === "" || e[k] === undefined || e[k] === false && k !== "required") delete e[k];
    if (e.required === undefined) e.required = false;
    return e;
  });
  return { headings, elements, text: norm(document.body ? document.body.innerText : "").slice(0, ${TEXT_CAP}) };
`;

/** Marks the first tile when a tile list shows and nothing is picked yet. Evaluates to a bool. */
const PLAN_TILE_BODY = String.raw`
  const lists = tileLists();
  if (!lists.length || lists.some((l) => l.members.some((m) => isSelected(m.el)))) return false;
  lists[0].members[0].el.setAttribute("data-fr-target", "tile");
  return true;
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
      if (first) { first.click(); acted++; }
    } else if (el.tagName === "SELECT") {
      done.add(el);
      if (!(hasRequired(el) || resolveLabel(el, false).marked) || el.value || isDisabled(el)) continue;
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

/** Marks the first enabled day after today in a month grid. Evaluates to a bool. */
const PLAN_DAY_BODY = String.raw`
  const cells = calendarCells();
  if (!cells.length) return false;
  if (cells.some((c) => isSelected(c.el) || isSelected(c.el.parentElement))) return "selected";
  const todayAt = cells.findIndex((c) => /(^|[\s_-])today([\s_-]|$)/i.test(c.el.className + " " + (c.el.parentElement ? c.el.parentElement.className : ""))
    || c.el.getAttribute("aria-current") === "date" || (c.el.parentElement && c.el.parentElement.getAttribute("aria-current") === "date"));
  const dom = new Date().getDate();
  let pick = null;
  if (todayAt >= 0) pick = cells.slice(todayAt + 1).find(cellEnabled);
  if (!pick) pick = cells.find((c) => c.n > dom && cellEnabled(c));
  if (!pick) pick = cells.find(cellEnabled);
  if (!pick) return false;
  (pick.el.closest("button, td, a, [role=gridcell], [role=button]") || pick.el).setAttribute("data-fr-target", "day");
  return true;
`;

/** Marks the first enabled time slot ("9:15 AM"). Evaluates to a bool. */
const PLAN_SLOT_BODY = String.raw`
  const TIME = /\b\d{1,2}:\d{2}\b/;
  for (const el of document.querySelectorAll("button, a, li, div, span, label, [role=option], [role=button], [role=radio]")) {
    if (el.children.length > 2 || !isVisible(el) || !clickable(el) || isDisabled(el)) continue;
    const t = norm(el.textContent);
    if (t.length > 24 || !TIME.test(t) || isSelected(el)) continue;
    if (el.closest("[data-fr-target]")) continue;
    el.setAttribute("data-fr-target", "slot");
    return true;
  }
  return false;
`;

/** Marks the first enabled "next"-like button, never a "book"/"submit"-like one. Evaluates to the text or "". */
const PLAN_NEXT_BODY = String.raw`
  const GO = /^(next|continue|proceed|select|choose|go|ok)\b/i;
  const GO2 = /^(select|choose|confirm|book) (service|staff|provider|time|date)/i;
  const NEVER = /\b(book(ing)?( now| appointment)?|reserve|pay|submit|place|complete|finish|send|confirm booking|confirm appointment)\b/i;
  const filled = (form) => !!form && [...form.querySelectorAll("input[type=email], input[type=tel]")].some((i) => norm(i.value));
  for (const b of buttonEls()) {
    if (!isVisible(b) || isDisabled(b)) continue;
    const t = buttonText(b);
    if (!t || NEVER.test(t)) continue;
    if (!(GO.test(t) || GO2.test(t))) continue;
    if (b.tagName === "INPUT" || b.tagName === "BUTTON") {
      if ((b.type || "").toLowerCase() === "submit" && filled(b.form)) continue;
    }
    b.setAttribute("data-fr-target", "next");
    return t.slice(0, 80);
  }
  return "";
`;

const COUNT_INPUTS = String.raw`(() => {
  let n = 0;
  for (const el of document.querySelectorAll("input:not([type=hidden]), select, textarea")) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) n++;
  }
  return n;
})()`;

/** Installs a mutation counter once; evaluates to its current value. Our own marker attribute doesn't count. */
const MUTATION_COUNTER = String.raw`(() => {
  if (window.__frMut === undefined) {
    window.__frMut = 0;
    new MutationObserver((records) => {
      for (const r of records) if (!(r.type === "attributes" && r.attributeName === "data-fr-target")) { window.__frMut++; break; }
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  }
  return window.__frMut;
})()`;

const UNMARK = String.raw`(() => { for (const e of document.querySelectorAll("[data-fr-target]")) e.removeAttribute("data-fr-target"); })()`;

const script = (body: string) => `(() => {${LIB}\n${body}\n})()`;
const SNAPSHOT = script(SNAPSHOT_BODY);
const PLAN_TILE = script(PLAN_TILE_BODY);
const FILL_CHOICES = script(FILL_CHOICES_BODY);
const PLAN_DAY = script(PLAN_DAY_BODY);
const PLAN_SLOT = script(PLAN_SLOT_BODY);
const PLAN_NEXT = script(PLAN_NEXT_BODY);

// ── Driving ────────────────────────────────────────────────────────────────

type Shot = Omit<Screen, "index">;

/** What a screen IS, for telling one from the next: headings, labels, option counts. Buttons excluded — a slot list appearing is the same screen. */
export function fingerprint(s: Pick<Screen, "headings" | "elements">): string {
  return (
    s.headings.join("|") +
    "||" +
    s.elements
      .filter((e) => e.tag !== "button")
      .map((e) => `${e.tag}:${e.label}:${e.options?.length ?? 0}`)
      .join("|")
  );
}

/** One frame's visible screen as the reader sees it. Throws when the frame is gone. */
export async function snapshotFrame(frame: Frame): Promise<Shot> {
  const raw = (await frame.evaluate(SNAPSHOT)) as { headings: string[]; elements: SnapElement[]; text: string };
  return { url: frame.url(), headings: raw.headings, elements: raw.elements, text: raw.text };
}

async function clickMarked(frame: Frame): Promise<boolean> {
  const loc = frame.locator("[data-fr-target]").first();
  try {
    try {
      await loc.click({ timeout: 2500, noWaitAfter: true });
    } catch {
      await loc.dispatchEvent("click", undefined, { timeout: 1000 });
    }
    return true;
  } catch {
    return false;
  } finally {
    await frame.evaluate(UNMARK).catch(() => {});
  }
}

/** The mutation counter before an action, so `settle` can tell the action's own change from silence. */
async function mark(frame: Frame): Promise<number | null> {
  return (await frame.evaluate(MUTATION_COUNTER).catch(() => null)) as number | null;
}

/** Wait for the frame to react to an action taken after `before`: a DOM mutation, a navigation, or `ms`, then a beat for paint. */
async function settle(frame: Frame, ms: number, before: number | null): Promise<void> {
  const page = frame.page();
  if (before === null) {
    await page.waitForLoadState("domcontentloaded", { timeout: ms }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: ms }).catch(() => {});
    return;
  }
  await frame.waitForFunction(`window.__frMut > ${before}`, undefined, { timeout: ms }).catch(() => {});
  await page.waitForTimeout(250);
  await page.waitForLoadState("networkidle", { timeout: 1500 }).catch(() => {});
}

/**
 * Move the screen forward the way a customer would, without committing to
 * anything: pick the first tile, the first option of each required choice,
 * a day and a slot, then the "Next"-like button — never "Book", never
 * "Submit", never a keystroke into a text input. Stops as soon as the screen
 * changes so nothing is skipped. Returns the actions taken; empty means the
 * form offers nothing more to do here.
 */
export async function advanceFrame(frame: Frame): Promise<string[]> {
  const actions: string[] = [];
  const start = fingerprint(await snapshotFrame(frame));
  const changed = async () => fingerprint(await snapshotFrame(frame)) !== start;

  let before = await mark(frame);
  if ((await frame.evaluate(PLAN_TILE)) === true && (await clickMarked(frame))) {
    actions.push("tile");
    await settle(frame, 2500, before);
    if (await changed()) return actions;
  }
  before = await mark(frame);
  const filled = (await frame.evaluate(FILL_CHOICES)) as number;
  if (filled > 0) {
    actions.push(`choices:${filled}`);
    await settle(frame, 1500, before);
    if (await changed()) return actions;
  }
  before = await mark(frame);
  const day = await frame.evaluate(PLAN_DAY);
  if (day === true && (await clickMarked(frame))) {
    actions.push("day");
    await settle(frame, 2500, before);
  }
  if (day === true || day === "selected") {
    before = await mark(frame);
    if ((await frame.evaluate(PLAN_SLOT)) === true && (await clickMarked(frame))) {
      actions.push("slot");
      await settle(frame, 2500, before);
    }
    if (actions.length && (await changed())) return actions;
  }
  before = await mark(frame);
  const next = (await frame.evaluate(PLAN_NEXT)) as string;
  if (next && (await clickMarked(frame))) {
    actions.push(`next:${next}`);
    await settle(frame, 4000, before);
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
/** A frame the reader may look into: the widget's own, or the page's own. */
function frameReadable(frameUrl: string, entryUrl: string): boolean {
  if (frameUrl.startsWith("about:")) return true;
  if (sameOrigin(frameUrl, entryUrl)) return true;
  if (!isSafeExternalUrl(frameUrl)) return false;
  const host = hostOf(frameUrl);
  return BOOKING_HOSTS.test(host) || FORM_HOSTS.test(host);
}

/** The frame with the form: the main frame unless a booking/form iframe holds more inputs. */
async function pickFrame(page: BrowserPage, entryUrl: string): Promise<Frame> {
  const main = page.mainFrame();
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
const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new CapTimeout("screen cap")), ms);
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
 */
export async function readBookingForm(
  crawler: Crawler,
  url: string,
  onEvent?: (m: string) => void,
): Promise<FormSnapshot | null> {
  const safeHere = (u: string) => isSafeExternalUrl(u) || sameOrigin(u, url);
  try {
    return await crawler.drive(url, async (page) => {
      const deadline = Date.now() + TOTAL_TIMEOUT_MS;
      const screens: Screen[] = [];
      const seen = new Set<string>();
      let truncated = false;

      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
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
        const frame = await pickFrame(page, url);
        const shot = await snapshotFrame(frame);
        const fp = fingerprint(shot);
        const isNew = !seen.has(fp);
        if (isNew) {
          seen.add(fp);
          screens.push({ index: screens.length + 1, ...shot });
          onEvent?.(`Booking form screen ${screens.length}: ${shot.headings[0] ?? "(no heading)"}`);
        }
        if (screens.length >= MAX_SCREENS) return isNew ? "new" : "same";
        const actions = await advanceFrame(frame);
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
          outcome = await withTimeout(step(), Math.min(SCREEN_TIMEOUT_MS, left));
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
      return { url, screens, how: "playwright", truncated };
    });
  } catch (err) {
    onEvent?.(`Booking form could not be read: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
    return null;
  }
}

// ── Static fallback ────────────────────────────────────────────────────────

const REQ_TAIL = /\s*(\*+|\(required\))\s*$/i;
const isMarked = (raw: string) => /\*\s*$/.test(raw) || /\(required\)\s*$/i.test(raw) || /^\*/.test(raw);
const stripMark = (raw: string) => raw.replace(/^\*+\s*/, "").replace(REQ_TAIL, "").replace(/\s+/g, " ").trim();
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
      const options = opts.map((o) => norm($(o).text())).filter(Boolean).slice(0, OPTIONS_CAP);
      const sel = opts.find((o) => $(o).is("[selected]") && ($(o).attr("value") ?? norm($(o).text())) !== "");
      out.push({ el, e: clean({ tag: "select", label, inputType: $(el).is("[multiple]") ? "select-multiple" : "select-one", required, options, value: sel ? norm($(sel).text()) : "", disabled }) });
    } else if (tag !== "input" && ($(el).attr("role") ?? "").toLowerCase() === "combobox") {
      const boxId = $(el).attr("aria-controls") ?? $(el).attr("aria-owns") ?? "";
      const options = boxId ? $(`[id="${boxId.replace(/"/g, "")}"] [role=option]`).toArray().map((o) => norm($(o).text())).filter(Boolean).slice(0, OPTIONS_CAP) : [];
      out.push({ el, e: clean({ tag: "select", label, inputType: "combobox", required, options, value: norm($(el).text()).slice(0, 80), disabled }) });
    } else if (tag === "textarea") {
      out.push({ el, e: clean({ tag: "textarea", label, required, placeholder: norm($(el).attr("placeholder") ?? ""), value: norm($(el).text()).slice(0, 80), disabled }) });
    } else if (tag !== "input") {
      out.push({ el, e: clean({ tag: "textarea", label, inputType: "contenteditable", required, placeholder: norm($(el).attr("placeholder") ?? $(el).attr("data-placeholder") ?? ""), value: norm($(el).text()).slice(0, 80), disabled }) });
    } else {
      const type = typeOf(el);
      out.push({ el, e: clean({ tag: "input", label, inputType: type, required, placeholder: norm($(el).attr("placeholder") ?? ""), value: type === "password" ? "" : norm($(el).attr("value") ?? "").slice(0, 80), disabled }) });
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
const CUT = "…[cut]";

const cut = (s: string, max: number) => (s.length <= max ? s : s.slice(0, Math.max(0, max - CUT.length)) + CUT);

function serializeElement(e: SnapElement): string {
  const head = e.inputType && e.inputType !== e.tag ? `${e.tag}, ${e.inputType}` : e.tag;
  let line = `- [${head}] ${JSON.stringify(e.label)}`;
  if (e.required) line += ", required";
  if (e.disabled) line += ", disabled";
  if (e.placeholder) line += `, placeholder ${JSON.stringify(e.placeholder)}`;
  if (e.value) line += `, value ${JSON.stringify(e.value)}`;
  if (e.options?.length) line += `, options: ${e.options.join(" | ")}`;
  return line;
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
