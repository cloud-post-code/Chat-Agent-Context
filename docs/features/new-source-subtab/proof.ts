/**
 * Primary proof for new-source-subtab (see PROOF.md).
 * Run: npx tsx --tsconfig tsconfig.proofs.json \
 *        docs/features/new-source-subtab/proof.ts
 *
 * Offline: pure tab resolution, server-rendered SubTabs markup, and
 * source-level wiring reads. No DB, no model calls.
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const { resolveAdminTab, NEW_SOURCE_TAB_KEY } = await import(
    "../../../app/admin/contentTabs"
  );
  const { SubTabs } = await import("../../../app/admin/SubTabs");

  // 1. The builder key resolves to Knowledge regardless of live source keys.
  check("NEW_SOURCE_TAB_KEY is the deep-link key", NEW_SOURCE_TAB_KEY === "new-source");
  const withKeys = resolveAdminTab(NEW_SOURCE_TAB_KEY, ["projects", "custom-x"]);
  check(
    "new-source resolves to knowledge with live keys",
    withKeys.nav === "knowledge" && withKeys.sub === NEW_SOURCE_TAB_KEY,
  );
  const noKeys = resolveAdminTab(NEW_SOURCE_TAB_KEY);
  check(
    "new-source resolves to knowledge with default keys",
    noKeys.nav === "knowledge" && noKeys.sub === NEW_SOURCE_TAB_KEY,
  );

  // 2. Existing deep links are untouched.
  check("a source key resolves to knowledge", resolveAdminTab("projects", ["projects"]).nav === "knowledge");
  check("answers still resolves to agent", resolveAdminTab("answers").nav === "agent");
  check("theme resolves to settings", resolveAdminTab("theme").nav === "settings");
  check("activity resolves to inbox", resolveAdminTab("activity").nav === "inbox");
  check(
    "unknown keys still pass through",
    resolveAdminTab("bogus").nav === "bogus" && resolveAdminTab("bogus").sub === undefined,
  );

  // 3. SubTabs opened on the builder key selects it and renders its panel
  //    below the tab bar, like any other Content sub-tab.
  const html = renderToStaticMarkup(
    h(SubTabs, {
      initial: NEW_SOURCE_TAB_KEY,
      tabs: [
        { key: "projects", label: "Projects", content: h("div", null, "PROJECTS-PANEL") },
        {
          key: NEW_SOURCE_TAB_KEY,
          label: "+ New source",
          content: h("div", null, "BUILDER-PANEL"),
        },
      ],
    }),
  );
  check(
    "builder tab renders selected in the strip",
    /aria-selected="true"[^>]*>\+ New source/.test(html),
  );
  check("builder panel populates below the tab bar", html.includes("BUILDER-PANEL"));
  check("sibling panel is not rendered", !html.includes("PROJECTS-PANEL"));

  // 4. NewSourcePanel carries the whole builder (SourceBuilder reused, manual
  //    fallback form intact).
  const panelSrc = readFileSync(path.join(root, "app/admin/NewSourcePanel.tsx"), "utf8");
  check("panel renders SourceBuilder", panelSrc.includes("SourceBuilder"));
  check("panel keeps the manual fallback form", panelSrc.includes("createIngestionSourceAction"));
  check("manual form posts panelHtml", panelSrc.includes('name="panelHtml"'));
  check("manual form posts splitMode", panelSrc.includes('name="splitMode"'));
  check("manual form renders the classification selector", panelSrc.includes("ClassificationSelect"));

  // 5. The panel set mounts the builder as a Knowledge sub-tab (the
  //    dashboard lays out what panels.tsx builds, in NAV_GROUPS order).
  const dash = readFileSync(path.join(root, "app/admin/dashboard/page.tsx"), "utf8");
  const panels = readFileSync(path.join(root, "app/admin/panels.tsx"), "utf8");
  const nav = readFileSync(path.join(root, "app/admin/contentTabs.ts"), "utf8");
  check("panel set renders NewSourcePanel", panels.includes("NewSourcePanel"));
  check("panel set keys the tab by NEW_SOURCE_TAB_KEY", panels.includes("[NEW_SOURCE_TAB_KEY]"));
  check("nav config labels the tab", nav.includes('label: "+ New source"'));
  check(
    "dashboard no longer links out to /admin/sources/new",
    !dash.includes('"/admin/sources/new"'),
  );

  // 6. No dead link: the old page redirects into the sub-tab, and the create
  //    action's error redirect lands there too.
  const newPage = readFileSync(path.join(root, "app/admin/sources/new/page.tsx"), "utf8");
  check(
    "/admin/sources/new redirects to the sub-tab",
    newPage.includes("redirect") && newPage.includes("tab=new-source"),
  );
  const actions = readFileSync(path.join(root, "app/admin/actions.ts"), "utf8");
  check(
    "create action error redirect lands on the sub-tab",
    /createIngestionSourceAction[\s\S]{0,1500}tab=new-source/.test(actions),
  );
  const lib = readFileSync(path.join(root, "lib/ingestionSources.ts"), "utf8");
  check(
    "a source keyed new-source suffixes instead of shadowing the builder tab",
    /key === "new-source"[\s\S]{0,400}\$\{key\}-\$\{n\}/.test(lib),
  );

  console.log(failures ? `\n${failures} assertion(s) failed` : "\nAll assertions passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("Proof crashed:", err);
  process.exit(1);
});
