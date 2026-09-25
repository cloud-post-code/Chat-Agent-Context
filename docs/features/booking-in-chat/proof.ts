/**
 * Primary proof for booking-in-chat (see PROOF.md).
 * Run: npx tsx docs/features/booking-in-chat/proof.ts
 *
 * Section A pins the pure sequencing rules in lib/booking/session.ts — the
 * message ids, the step ids, the intro lines, the fold the model is sent.
 * Section B runs proof/chat-thread.ts as a child process (it mounts the real
 * visitor Chat in jsdom and needs the react-jsx tsconfig override) and
 * inherits its PASS/FAIL lines. Fully client-side: no database, zero model
 * calls, nothing to clean up. Exit 1 on any failure.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const S = await import("../../../lib/booking/session");
  type Flow = import("../../../lib/booking/types").BookingFlow;
  const noFlow = {} as Flow; // intro() takes the flow for a future override; today it reads the step alone

  // ══ A. The pure rules (lib/booking/session.ts) ═══════════════════════════
  console.log("A. The sequencing rules (lib/booking/session.ts)");
  const ids = S.ids("s1");
  check("A1 ask / reply / confirmed ids are <sessionId>:<stepId>:ask|reply and <sessionId>:confirmed:ask",
    ids.ask("service") === "s1:service:ask" && ids.reply("screen:2") === "s1:screen:2:reply" && ids.confirmedAsk === "s1:confirmed:ask");
  check("A1 a session owns exactly its own ids", ids.owns("s1:time:ask") && ids.owns("s1:start") && !ids.owns("s10:time:ask") && !ids.owns(undefined));
  check("A2 step ids: engine steps by kind, a screen by its number, review",
    S.stepId({ kind: "service" }) === "service" && S.stepId({ kind: "screen", screen: 2, title: "", fields: [] }) === "screen:2" && S.stepId({ kind: "review", title: "" }) === "review");
  check("A3 the intros are the fixed lines",
    S.intro({ kind: "service" }, noFlow) === "Which service would you like?" &&
      S.intro({ kind: "options" }, noFlow) === "Any options or add-ons?" &&
      S.intro({ kind: "provider" }, noFlow) === "Who would you like to see?" &&
      S.intro({ kind: "location" }, noFlow) === "Where?" &&
      S.intro({ kind: "time" }, noFlow) === "When works for you?" &&
      S.intro({ kind: "review", title: "" }, noFlow) === "Here's your booking — check it over.");
  check("A3 a screen's intro is the business's own title; a titled review keeps its title",
    S.intro({ kind: "screen", screen: 1, title: "How do we say hello?", fields: [] }, noFlow) === "How do we say hello?" &&
      S.intro({ kind: "review", title: "Check and confirm" }, noFlow) === "Check and confirm");
  check("A4 nextUnasked walks the plan in the business's order",
    S.nextUnasked([{ kind: "provider" }, { kind: "service" }, { kind: "review", title: "" }], ["provider"])?.kind === "service" &&
      S.nextUnasked([{ kind: "service" }], ["service"]) === null);

  const thread = [
    { id: "m1", role: "user" as const, content: "Can I book something?" },
    { id: "m2", role: "assistant" as const, content: "Sure — let's book you in." },
    { id: "s1:start", role: "assistant" as const, content: "" },
    { id: "s1:service:ask", role: "assistant" as const, content: "Which service would you like?" },
    { id: "s1:service:reply", role: "user" as const, content: "Picked: Gel Manicure · $35" },
    { id: "s1:provider:ask", role: "assistant" as const, content: "Who would you like to see?" },
    { id: "s1:provider:reply", role: "user" as const, content: "Provider: Katherine" },
    { id: "s1:time:ask", role: "assistant" as const, content: "When works for you?" },
    { id: "m3", role: "user" as const, content: "do you do gel?" },
  ];
  const folded = S.foldBookingLines(thread);
  const folds = folded.filter((m) => m.role === "user" && m.content.startsWith("Booking so far:"));
  check("A5 a session's ask/reply lines fold into ONE user line 'Booking so far: …'", folds.length === 1, JSON.stringify(folded));
  check("A5 the fold carries what was picked", /Gel Manicure/.test(folds[0]?.content ?? "") && /Katherine/.test(folds[0]?.content ?? ""), folds[0]?.content);
  check("A5 the fold sits where the session's last reply was — after the opener, before the new question",
    folded.map((m) => m.content).join("\n") ===
      ["Can I book something?", "Sure — let's book you in.", folds[0]?.content ?? "", "do you do gel?"].join("\n"),
    JSON.stringify(folded.map((m) => m.content)));
  check("A5 no empty turn and no bare ask/reply line reaches the model",
    folded.every((m) => m.content.trim()) && !folded.some((m) => /^(Picked|Provider|When|Details|Options):/.test(m.content) || m.content.endsWith("?") && m.role === "assistant"));
  const plain = S.foldBookingLines([
    { role: "user", content: "hi" },
    { role: "assistant", content: "" },
    { role: "assistant", content: "hello" },
  ]);
  check("A6 a thread with no booking passes through, empties dropped", plain.length === 2 && plain[0].content === "hi" && plain[1].content === "hello");
  const two = S.foldBookingLines([
    { id: "s1:service:ask", role: "assistant", content: "Which service would you like?" },
    { id: "s1:service:reply", role: "user", content: "Picked: Gel Manicure · $35" },
    { id: "m1", role: "user", content: "actually, start over" },
    { id: "s2:service:ask", role: "assistant", content: "Which service would you like?" },
    { id: "s2:service:reply", role: "user", content: "Picked: Long Hair Cut · $45" },
  ]);
  check("A7 two sessions fold into two lines, each at its own place",
    two.filter((m) => m.content.startsWith("Booking so far:")).length === 2 && two.length === 3 && two[1].content === "actually, start over", JSON.stringify(two));

  // ══ B. The thread, in a real Chat under jsdom ════════════════════════════
  console.log("B. The conversation of cards (proof/chat-thread.ts, jsdom, the real Chat)");
  const dir = __dirname;
  const repoRoot = path.resolve(dir, "../../..");
  // The shared root tsconfig.proofs.json (jsx: react-jsx for every proof that
  // mounts real .tsx components) replaced each feature's own
  // tsconfig.proof.json — matches the command PROOF.md documents.
  const child = spawnSync(
    "npx",
    ["tsx", "--tsconfig", path.join(repoRoot, "tsconfig.proofs.json"), path.join(dir, "proof", "chat-thread.ts")],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, TZ: "UTC" },
    },
  );
  check("B the chat-thread proof is green", child.status === 0, `exit ${child.status ?? child.signal}`);

  console.log(failures ? `\n${failures} check(s) failed (${passes} passed).` : `\nAll checks passed.`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
