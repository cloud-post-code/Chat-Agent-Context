/**
 * Primary proof for admin-nav-groups (see PROOF.md).
 * Run: npx tsx --tsconfig docs/features/admin-nav-groups/tsconfig.json \
 *        docs/features/admin-nav-groups/proof.ts
 *
 * Offline: pure nav config + resolver + Home item computation, server-rendered
 * panel markup, and source-level wiring reads. No DB, no model calls.
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
const src = (p: string) => readFileSync(path.join(root, p), "utf8");

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const tabs = await import("../../../app/admin/contentTabs");
  const { NAV_GROUPS, fixedPanelEntries, labelsFromNav, resolveAdminTab, NEW_SOURCE_TAB_KEY } = tabs;

  // ── 1. Nav config ──
  check(
    "six nav groups in order",
    JSON.stringify(NAV_GROUPS.map((g) => g.key)) ===
      JSON.stringify(["home", "inbox", "knowledge", "agent", "cards", "settings"]),
    NAV_GROUPS.map((g) => g.key).join(","),
  );
  const subKeys = NAV_GROUPS.flatMap((g) => g.subs.map((s) => s.key));
  check("sub keys are unique", new Set(subKeys).size === subKeys.length, subKeys.join(","));
  const fixedOwner = fixedPanelEntries(false).map((e) => e.key);
  const fixedOp = fixedPanelEntries(true).map((e) => e.key);
  check("fixed panels exclude home", !fixedOwner.includes("home"));
  check("fixed panels exclude users for owners", !fixedOwner.includes("users"));
  check("fixed panels include users for operators", fixedOp.includes("users"));
  check(
    "fixed panels cover the split calendar",
    ["appointments", "orders", "booking", "activity", "graph", "a2ui"].every((k) => fixedOwner.includes(k)),
    fixedOwner.join(","),
  );
  const labels = labelsFromNav();
  check("graph is labelled Health", labels.graph === "Health");
  check("a2ui is labelled Cards", labels.a2ui === "Cards");
  check("booking is labelled Booking", labels.booking === "Booking");

  // ── 2. Deep links ──
  const table: Array<[string, string, string | undefined]> = [
    ["activity", "inbox", "activity"],
    ["calendar", "inbox", "appointments"],
    ["orders", "inbox", "orders"],
    ["booking", "settings", "booking"],
    ["graph", "knowledge", "graph"],
    ["a2ui", "cards", "a2ui"],
    ["contacts", "settings", "contacts"],
    ["answers", "agent", "answers"],
    ["goals", "agent", "goals"],
    ["profile", "settings", "profile"],
    ["theme", "settings", "theme"],
    ["me", "settings", "profile"],
    ["users", "settings", "users"],
    [NEW_SOURCE_TAB_KEY, "knowledge", NEW_SOURCE_TAB_KEY],
  ];
  for (const [key, nav, sub] of table) {
    const r = resolveAdminTab(key);
    check(`"${key}" → ${nav}/${sub}`, r.nav === nav && r.sub === sub, JSON.stringify(r));
  }
  {
    const r = resolveAdminTab("custom-x", ["blog", "custom-x"]);
    check("live source key → knowledge", r.nav === "knowledge" && r.sub === "custom-x", JSON.stringify(r));
  }
  {
    const r = resolveAdminTab("content", ["blog", "custom-x"]);
    check("content → knowledge on first source", r.nav === "knowledge" && r.sub === "blog", JSON.stringify(r));
    const bare = resolveAdminTab("content", []);
    check("content with no sources → knowledge, no sub", bare.nav === "knowledge" && bare.sub === undefined);
  }
  {
    const r = resolveAdminTab("bogus");
    check("unknown key passes through", r.nav === "bogus" && r.sub === undefined);
    const none = resolveAdminTab(undefined);
    check("undefined → nothing", none.nav === undefined && none.sub === undefined);
  }

  // ── 3. Home items ──
  const { attentionItems, checklistItems } = await import("../../../app/admin/homeItems");
  const now = new Date("2026-09-23T12:00:00Z");
  const attention = attentionItems(
    {
      flaggedDown: 2,
      unreviewed: 3,
      appointments: [
        { id: "a1", startsAt: new Date("2026-09-24T10:00:00Z"), answers: { name: "Ann" } },
        { id: "a0", startsAt: new Date("2026-09-01T10:00:00Z"), answers: { name: "Old" } },
      ],
      orders: [
        { id: "o1", status: "new", contact: { name: "Bo" }, createdAt: now },
        { id: "o2", status: "done", contact: { name: "Cy" }, createdAt: now },
      ],
      topQuestions: [{ label: "Do you do walk-ins?", count: 4 }],
    },
    now,
  );
  const flagged = attention.find((a) => a.label.includes("flagged"));
  check("flagged answers → activity with count", flagged?.tab === "activity" && flagged.count === 2, JSON.stringify(flagged));
  const byTab = Object.fromEntries(attention.filter((a) => a.tab !== "activity").map((a) => [a.tab, a]));
  check("presets to review → answers", byTab.answers?.count === 3);
  check("only upcoming appointments counted", byTab.appointments?.count === 1, JSON.stringify(byTab.appointments));
  check("only new orders counted", byTab.orders?.count === 1, JSON.stringify(byTab.orders));
  check(
    "most-asked rides along",
    attention.some((a) => a.detail?.includes("walk-ins")),
    JSON.stringify(attention),
  );

  const todo = checklistItems({
    profile: { company_name: "Salon", owner_name: "", company_phone_number: "", company_email: "x@y", company_hours: "" },
    taglineSource: "suggested",
    cardCount: 0,
    bookingEnabled: false,
    sources: [
      { key: "blog", label: "Blog", count: 0 },
      { key: "services", label: "Services", count: 4 },
    ],
  });
  const todoByTab = Object.fromEntries(todo.map((c) => [c.tab, c]));
  check("profile incomplete → profile not done", todoByTab.profile?.done === false);
  check("suggested tagline → theme not done", todoByTab.theme?.done === false);
  check("no cards → a2ui not done", todoByTab.a2ui?.done === false);
  check("booking off → booking not done", todoByTab.booking?.done === false);
  check("empty source → its tab not done", todoByTab.blog?.done === false);
  check("filled source → done", todoByTab.services?.done === true);

  const allDone = checklistItems({
    profile: { company_name: "S", owner_name: "O", company_phone_number: "1", company_email: "e", company_hours: "h" },
    taglineSource: "extracted",
    cardCount: 2,
    bookingEnabled: true,
    sources: [{ key: "blog", label: "Blog", count: 1 }],
  });
  check("fully set up → everything done", allDone.every((c) => c.done), JSON.stringify(allDone));

  // ── 4. HomePanel markup ──
  const { HomePanel } = await import("../../../app/admin/HomePanel");
  const home = renderToStaticMarkup(h(HomePanel, { attention, checklist: todo }));
  for (const t of ["answers", "appointments", "booking"]) {
    check(`Home links to ?tab=${t}`, home.includes(`href="/admin/dashboard?tab=${t}"`));
  }
  check("Home shows the flagged count", />2</.test(home));

  // ── 5. Calendar split ──
  const { AppointmentsPanel } = await import("../../../app/admin/CalendarPanel");
  const { OrdersPanel } = await import("../../../app/admin/OrdersPanel");
  const { BookingSettings } = await import("../../../app/admin/BookingPanel");
  const noop = async () => {};
  const off = renderToStaticMarkup(
    h(AppointmentsPanel, { rows: [], fieldLabels: {}, cancelAction: noop, bookingEnabled: false }),
  );
  check("appointments hides the grid while booking is off", !/Mon<\/div>/.test(off));
  check("appointments points at Settings › Booking", off.includes("?tab=booking"));
  const on = renderToStaticMarkup(
    h(AppointmentsPanel, { rows: [], fieldLabels: {}, cancelAction: noop, bookingEnabled: true }),
  );
  check("appointments shows the grid while booking is on", /Mon<\/div>/.test(on) && /Tue/.test(on));
  const empty = renderToStaticMarkup(h(OrdersPanel, { orders: [], deleteAction: noop }));
  check("orders empty state", empty.includes("No orders yet"));
  const one = renderToStaticMarkup(
    h(OrdersPanel, {
      orders: [
        {
          id: "o1",
          createdAt: now.toISOString(),
          startsAt: null,
          lines: [{ name: "Latte", quantity: 2, choices: "", note: "", lineTotal: "$8" }],
          contact: { name: "Bo Diddley", phone: "", email: "" },
          fulfillment: "pickup",
          notes: "",
          subtotal: "$8",
        },
      ],
      deleteAction: noop,
    }),
  );
  check("orders lists the contact name", one.includes("Bo Diddley"));
  const booking = renderToStaticMarkup(
    h(BookingSettings, { config: { enabled: false, fields: [] } as never }),
  );
  check("booking settings render the toggle", /turn booking on/i.test(booking));

  // ── 6. Wiring ──
  const dash = src("app/admin/dashboard/page.tsx");
  check("dashboard renders from NAV_GROUPS", dash.includes("NAV_GROUPS"));
  check("dashboard has no literal calendar entry", !dash.includes('key: "calendar"'));
  const cal = src("app/admin/CalendarPanel.tsx");
  check("CalendarPanel no longer imports BookingSettings", !cal.includes("import { BookingSettings"));
  const brain = src("lib/adminBrain.ts");
  check("adminBrain has no literal FIXED_PANELS", !brain.includes("FIXED_PANELS"));
  check("adminBrain aliases legacy show_panel keys", brain.includes("TAB_ALIASES"));
  const panels = src("app/admin/panels.tsx");
  for (const k of ["home", "appointments", "orders", "booking"]) {
    check(`panels sets flat.${k}`, panels.includes(`flat.${k} =`));
  }
  const chat = src("app/admin/chat/AdminChat.tsx");
  check("chat starters no longer say ingestion sources", !chat.includes("ingestion sources"));

  console.log(failures ? `\n${failures} assertion(s) failed` : "\nAll assertions passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("Proof crashed:", err);
  process.exit(1);
});
