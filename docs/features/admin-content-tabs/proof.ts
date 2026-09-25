/**
 * Proof for admin-content-tabs — see PROOF.md for the contract.
 *
 * Renders the SubTabs switcher server-side and checks the deep-link mapping;
 * no auth, DB, or network. Uses createElement (not JSX) so tsx runs it as .ts.
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SubTabs } from "../../../app/admin/SubTabs";
import { CONTENT_TAB_KEYS, resolveAdminTab } from "../../../app/admin/contentTabs";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 1. The built-in sub-tab keys are the four starter ingestion sources. ──
check(
  "CONTENT_TAB_KEYS is the four starter sources",
  JSON.stringify([...CONTENT_TAB_KEYS]) ===
    JSON.stringify(["blog", "testimonials", "about-team", "services"]),
  JSON.stringify(CONTENT_TAB_KEYS),
);

// ── 2. Deep-link resolution. ──
for (const key of CONTENT_TAB_KEYS) {
  const r = resolveAdminTab(key);
  check(
    `resolveAdminTab("${key}") opens Knowledge on ${key}`,
    r.nav === "knowledge" && r.sub === key,
    JSON.stringify(r),
  );
}
{
  // "knowledge" is the nav key itself now: opens the section on its default.
  const r = resolveAdminTab("knowledge");
  check(
    'resolveAdminTab("knowledge") opens the Knowledge nav',
    r.nav === "knowledge" && r.sub === undefined,
    JSON.stringify(r),
  );
}
{
  const r = resolveAdminTab(undefined);
  check(
    "resolveAdminTab(undefined) yields no nav and no sub",
    r.nav === undefined && r.sub === undefined,
    JSON.stringify(r),
  );
}

// ── 3–5. SubTabs rendering. ──
const tabs = [
  { key: "projects", label: "Projects", content: h("p", null, "PROJECTS-PANEL") },
  { key: "knowledge", label: "Knowledge", content: h("p", null, "KNOWLEDGE-PANEL") },
  { key: "photos", label: "Photos", content: h("p", null, "PHOTOS-PANEL") },
];

function render(initial?: string): string {
  return renderToStaticMarkup(h(SubTabs, { tabs, initial }));
}

{
  const html = render();
  check(
    "SubTabs renders all three tab buttons",
    ["Projects", "Knowledge", "Photos"].every((l) => html.includes(`>${l}</button>`)),
    html,
  );
  check(
    "SubTabs with no initial shows the first panel only",
    html.includes("PROJECTS-PANEL") && !html.includes("KNOWLEDGE-PANEL") && !html.includes("PHOTOS-PANEL"),
    html,
  );
  check(
    "exactly one tab is aria-selected",
    (html.match(/aria-selected="true"/g) ?? []).length === 1,
    html,
  );
}
check(
  'SubTabs with initial="photos" shows the Photos panel only',
  (() => {
    const html = render("photos");
    return html.includes("PHOTOS-PANEL") && !html.includes("PROJECTS-PANEL");
  })(),
);
check(
  "SubTabs with an unknown initial falls back to the first panel",
  render("bogus").includes("PROJECTS-PANEL"),
);

// ── 6. Dashboard wiring (source-level: the page needs auth + Postgres to render). ──
const page = readFileSync(
  path.join(__dirname, "../../../app/admin/dashboard/page.tsx"),
  "utf8",
);
const panels = readFileSync(path.join(__dirname, "../../../app/admin/panels/index.tsx"), "utf8");
check("dashboard mounts SubTabs", page.includes("SubTabs"));
check("dashboard lays out NAV_GROUPS", page.includes("NAV_GROUPS"));
check("dashboard splices live source keys into Knowledge", page.includes('g.key === "knowledge"'));
check("dashboard resolves the initial tab via resolveAdminTab", page.includes("resolveAdminTab"));
check("Knowledge tabs render from the IngestionSource mapping", panels.includes("contentTabsFromSources"));
check(
  "the six builtin panels are wired into the mapping",
  [
    "projects: projectsTab",
    "links: linksTab",
    "pdfs: pdfsTab",
    "text: textTab",
    "photos: photosSection",
    "persona: personaTab",
  ].every((s) => panels.includes(s)),
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll assertions passed.");
