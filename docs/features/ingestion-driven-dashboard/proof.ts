/**
 * Primary proof for ingestion-driven-dashboard (see PROOF.md).
 * Run: npx tsx docs/features/ingestion-driven-dashboard/proof.ts
 *
 * Fully offline: pure mapping + resolver + source-level wiring checks.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { contentTabsFromSources, resolveAdminTab } from "../../../app/admin/contentTabs";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const rows = [
  { key: "photos", label: "Photos", enabled: true },
  { key: "links", label: "Links", enabled: true },
  { key: "drafts", label: "Drafts", enabled: false },
  { key: "custom-notes", label: "Notes", enabled: true },
];
const panels = { photos: "PHOTOS", links: "LINKS", drafts: "DRAFTS" };

// 1. Rows map in row order — DB order is display order.
const tabs = contentTabsFromSources(rows, panels);
check(
  "rows map in row order with their panels",
  JSON.stringify(tabs.map((t) => [t.key, t.label, t.content])) ===
    JSON.stringify([
      ["photos", "Photos", "PHOTOS"],
      ["links", "Links", "LINKS"],
    ]),
  JSON.stringify(tabs),
);

// 2. Disabled rows are dropped.
check("disabled row dropped", !tabs.some((t) => t.key === "drafts"));

// 3. Rows with no panel are dropped (custom rows can't crash the dashboard).
check("panel-less row dropped", !tabs.some((t) => t.key === "custom-notes"));

// 4. Deep-link resolution.
{
  const r = resolveAdminTab("custom-notes", ["photos", "custom-notes"]);
  check(
    "custom key resolves into Knowledge with a live key list",
    r.nav === "knowledge" && r.sub === "custom-notes",
    JSON.stringify(r),
  );
}
const builtin = ["projects", "links", "pdfs", "text", "photos", "persona"];
for (const key of builtin) {
  const r = resolveAdminTab(key, builtin);
  check(`builtin "${key}" resolves into Knowledge`, r.nav === "knowledge" && r.sub === key);
}
{
  // "knowledge" is now the nav key itself: it opens the section on its default.
  const r = resolveAdminTab("knowledge");
  check('"knowledge" opens the Knowledge nav', r.nav === "knowledge" && r.sub === undefined);
}
{
  const r = resolveAdminTab("graph");
  check("graph resolves to Knowledge › Health", r.nav === "knowledge" && r.sub === "graph");
}
{
  const r = resolveAdminTab("bogus");
  check("unknown key passes through", r.nav === "bogus" && r.sub === undefined);
}

// 5. Dashboard wiring (source-level: the page needs auth + Postgres to render).
const page = readFileSync(path.join(__dirname, "../../../app/admin/dashboard/page.tsx"), "utf8");
const panelsSrc = readFileSync(path.join(__dirname, "../../../app/admin/panels/index.tsx"), "utf8");
// Seeding moved to server start (deploy-db-bootstrap): instrumentation.ts
// runs bootstrapDatabase, so the dashboard is a plain reader.
const bootstrap = readFileSync(path.join(__dirname, "../../../lib/bootstrap.ts"), "utf8");
check("boot bootstrap seeds the starter sources", bootstrap.includes("seedStarterIngestionSources"));
check("panel set lists ingestion sources", panelsSrc.includes("listIngestionSources"));
check("Knowledge tabs render from the mapping", panelsSrc.includes("contentTabsFromSources(ingestionSources"));
check("dashboard lays panels out from NAV_GROUPS", page.includes("NAV_GROUPS"));
check('no hardcoded label: "PDFs" literal remains', !page.includes('label: "PDFs"') && !panelsSrc.includes('label: "PDFs"'));

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll assertions passed.");
