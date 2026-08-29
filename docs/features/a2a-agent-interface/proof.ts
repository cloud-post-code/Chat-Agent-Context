/**
 * Primary proof for a2a-agent-interface (see PROOF.md).
 * Run: npx tsx docs/features/a2a-agent-interface/proof.ts
 *
 * Drives the real A2A dispatcher over a seeded canned answer, so the whole
 * path — dispatch, task persistence, the brain, hydrate(), version rendering —
 * runs for real while the payload stays deterministic and no Anthropic request
 * is ever made. Every row it creates is deleted at the end.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

// Load .env ourselves (tsx doesn't); never override values already set.
const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}
// Deterministic guard settings for the rate-limit assertions.
process.env.A2A_RATE_LIMIT = "3";
process.env.NEXT_PUBLIC_SITE_URL = "https://proof.example";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const PREFIX = "a2aproof";
const Q_PLAIN = "What did Blake forge at Ninebark Foundry?";
const A_PLAIN = "He forged bells at Ninebark Foundry for six seasons.";
const Q_CARDS = "Which Ninebark builds are shipping?";
const A_CARDS = "These Ninebark builds are shipping right now.";

type Json = Record<string, unknown>;
const asJson = (v: unknown): Json => v as Json;

async function main() {
  const { prisma } = await import("../../../lib/db");
  const { dispatch, negotiateVersion } = await import("../../../lib/a2a/rpc");
  const { renderResult } = await import("../../../lib/a2a/transport");
  const { agentCardV1, agentCardV03 } = await import("../../../lib/a2a/card");
  const { agentFacts } = await import("../../../lib/a2a/facts");
  const { underRateLimit, authorize, resetGuards } = await import("../../../lib/a2a/guard");
  const { normalizeIncomingMessage, streamEventV03 } = await import(
    "../../../lib/a2a/downgrade"
  );
  const { saveCannedAnswer } = await import("../../../lib/canned");

  const baseCanned = await prisma.cannedAnswer.count();
  const baseProjects = await prisma.project.count();
  const baseTasks = await prisma.a2ATask.count();
  const contexts: string[] = [];

  const message = (text: string, extra: Json = {}): Json => ({
    messageId: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
    role: "ROLE_USER",
    parts: [{ text }],
    ...extra,
  });

  const send = async (text: string, version: "1.0" | "0.3", extra: Json = {}) => {
    const result = await dispatch("SendMessage", { message: message(text, extra) }, { version });
    if (result.type !== "result") throw new Error(`SendMessage failed: ${JSON.stringify(result)}`);
    const rendered = asJson(renderResult(result.value, version));
    const task = asJson(version === "1.0" ? rendered.task : rendered);
    if (typeof task.contextId === "string") contexts.push(task.contextId);
    return task;
  };

  async function cleanup() {
    const { normalizeQuestion } = await import("../../../lib/canned");
    await prisma.cannedAnswer.deleteMany({
      where: { matchKey: { in: [Q_PLAIN, Q_CARDS].map(normalizeQuestion) } },
    });
    await prisma.project.deleteMany({ where: { id: { startsWith: PREFIX } } });
    if (contexts.length) {
      await prisma.a2ATask.deleteMany({ where: { contextId: { in: contexts } } });
      // The brain logs A2A turns into Activity under the context id, the same
      // way it logs a browser visitor's session.
      await prisma.chatSession.deleteMany({ where: { visitorKey: { in: contexts } } });
    }
  }

  try {
    // ── Seed: one plain canned answer, one carrying a card, one project. ──
    await prisma.project.create({
      data: {
        id: `${PREFIX}-project`,
        name: "Ninebark Bell Rig",
        blurb: "A rig for tuning cast bells.",
        githubUrl: "https://github.com/example/ninebark",
      },
    });
    await saveCannedAnswer({ question: Q_PLAIN, answer: A_PLAIN, enabled: true });
    await saveCannedAnswer({
      question: Q_CARDS,
      answer: A_CARDS,
      enabled: true,
      cardTool: "show_projects",
    });

    // ── 1-4 ── The Agent Card. ──────────────────────────────────────────
    console.log("\n[card]");
    const card = await agentCardV1("https://proof.example");
    const required = [
      "name",
      "description",
      "supportedInterfaces",
      "version",
      "capabilities",
      "defaultInputModes",
      "defaultOutputModes",
      "skills",
    ];
    check(
      "card carries every REQUIRED v1.0 field",
      required.every((f) => asJson(card)[f] !== undefined),
      required.filter((f) => asJson(card)[f] === undefined).join(","),
    );
    check(
      "card has no top-level protocolVersion (removed in 1.0)",
      asJson(card).protocolVersion === undefined,
    );
    check("card declares at least one skill", card.skills.length > 0);

    const profile = await prisma.profile.findUnique({ where: { id: 1 } });
    check(
      "card name comes from the Profile, not a constant",
      !!profile && card.name.startsWith((profile.company_name || profile.owner_name)),
      `card="${card.name}"`,
    );
    check(
      "skill ids are derived from the profile name",
      card.skills.some((s) => s.id.startsWith("ask-about-")),
    );

    const preferred = card.supportedInterfaces[0];
    check(
      "preferred interface is JSONRPC at /api/a2a",
      preferred.protocolBinding === "JSONRPC" &&
        preferred.url === "https://proof.example/api/a2a" &&
        preferred.protocolVersion === "1.0",
      JSON.stringify(preferred),
    );
    check(
      "a 0.3 interface is advertised alongside it",
      card.supportedInterfaces.some((i) => i.protocolVersion === "0.3"),
    );
    check(
      "capabilities match what the endpoint actually implements",
      card.capabilities.streaming === true &&
        card.capabilities.pushNotifications === false &&
        card.capabilities.extendedAgentCard === false,
    );

    check(
      "card advertises the bearer scheme, so callers know to bring a token",
      asJson(asJson(asJson(card.securitySchemes ?? {}).bearer).httpAuthSecurityScheme).scheme ===
        "Bearer",
      JSON.stringify(card.securitySchemes),
    );
    check(
      "card requires that scheme rather than merely offering it",
      (card.securityRequirements ?? []).length === 1,
      JSON.stringify(card.securityRequirements),
    );

    const legacy = asJson(await agentCardV03("https://proof.example"));
    check(
      "legacy card uses the fields 1.0 removed",
      typeof legacy.protocolVersion === "string" &&
        typeof legacy.url === "string" &&
        legacy.preferredTransport === "JSONRPC",
    );
    check(
      "legacy card declares security the 0.3 way",
      (legacy.security as unknown[]).length === 1 &&
        asJson(asJson(legacy.securitySchemes).bearer).scheme === "bearer",
    );

    // ── 5-7 ── SendMessage. ─────────────────────────────────────────────
    console.log("\n[send]");
    const task = await send(Q_PLAIN, "1.0");
    const status = asJson(task.status);
    check("task completes", status.state === "TASK_STATE_COMPLETED", String(status.state));

    const artifacts = task.artifacts as Json[];
    const answerArtifact = artifacts.find((a) => a.name === "answer");
    const artifactText = answerArtifact
      ? (asJson((answerArtifact.parts as Json[])[0]).text as string)
      : "";
    check("artifact text is the canned answer verbatim", artifactText === A_PLAIN, artifactText);

    const statusText = (asJson((asJson(status.message).parts as Json[])[0]).text as string) ?? "";
    check("status.message carries the same answer", statusText === A_PLAIN);

    const history = task.history as Json[];
    check(
      "history holds the user question and the agent answer",
      history.length === 2 &&
        asJson((history[0].parts as Json[])[0]).text === Q_PLAIN &&
        history[1].role === "ROLE_AGENT",
      JSON.stringify(history.map((h) => h.role)),
    );

    const legacyTask = await send(Q_PLAIN, "0.3");
    check(
      "0.3 rendering uses kind + lowercase state",
      legacyTask.kind === "task" && asJson(legacyTask.status).state === "completed",
      JSON.stringify({ kind: legacyTask.kind, state: asJson(legacyTask.status).state }),
    );
    const legacyPart = asJson(((legacyTask.artifacts as Json[])[0].parts as Json[])[0]);
    check("0.3 parts are kind-tagged", legacyPart.kind === "text" && legacyPart.text === A_PLAIN);

    // ── 8 ── UI cards arrive as structured data, not prose. ─────────────
    console.log("\n[cards as data]");
    const cardTask = await send(Q_CARDS, "1.0");
    const dataArtifact = (cardTask.artifacts as Json[]).find((a) => a.name === "projects");
    check("a card artifact is emitted", !!dataArtifact);
    const dataPart = dataArtifact ? asJson((dataArtifact.parts as Json[])[0]) : {};
    check(
      "the card is a data part, not text",
      dataPart.data !== undefined && dataPart.text === undefined,
    );
    const block = asJson(dataPart.data ?? {});
    check("the data part is the real projects block", block.type === "projects");
    check(
      "the block was hydrated from the live database",
      Array.isArray(block.items) &&
        (block.items as Json[]).some((p) => p.id === `${PREFIX}-project`),
    );

    // ── 9-10 ── Streaming. ──────────────────────────────────────────────
    console.log("\n[streaming]");
    const streamed = await dispatch(
      "SendStreamingMessage",
      { message: message(Q_PLAIN) },
      { version: "1.0" },
    );
    if (streamed.type !== "stream") throw new Error("expected a stream");
    const events: Json[] = [];
    for await (const event of streamed.events) events.push(asJson(event));
    const firstTask = asJson(events[0].task);
    if (typeof firstTask.contextId === "string") contexts.push(firstTask.contextId);

    check("stream opens with the task", !!events[0].task);
    check(
      "a working status is emitted before content",
      asJson(asJson(events[1].statusUpdate).status).state === "TASK_STATE_WORKING",
    );
    check(
      "artifact updates carry the answer",
      events.some((e) => !!e.artifactUpdate),
    );
    const lastStatus = asJson(asJson(events[events.length - 1].statusUpdate).status);
    check(
      "stream ends on a terminal status",
      lastStatus.state === "TASK_STATE_COMPLETED",
      String(lastStatus.state),
    );

    const downgraded = events.map((e) => asJson(streamEventV03(e)));
    const finals = downgraded.filter((e) => e.kind === "status-update");
    check(
      "0.3 stream marks only the terminal event final",
      finals[finals.length - 1].final === true && finals.slice(0, -1).every((e) => e.final === false),
      JSON.stringify(finals.map((f) => f.final)),
    );

    // ── 11-13 ── Task lifecycle. ────────────────────────────────────────
    console.log("\n[task lifecycle]");
    const fetched = await dispatch(
      "GetTask",
      { id: task.id, historyLength: 0 },
      { version: "1.0" },
    );
    check("GetTask returns the persisted task", fetched.type === "result");
    const fetchedTask = fetched.type === "result" ? asJson(fetched.value) : {};
    check("GetTask historyLength 0 omits history", fetchedTask.history === undefined);
    check("GetTask keeps the artifacts", (fetchedTask.artifacts as Json[]).length > 0);

    const missing = await dispatch("GetTask", { id: "no-such-task" }, { version: "1.0" });
    check(
      "GetTask on an unknown id returns -32001",
      missing.type === "error" && missing.code === -32001,
    );

    const cancelDone = await dispatch("CancelTask", { id: task.id }, { version: "1.0" });
    check(
      "CancelTask on a completed task returns -32002",
      cancelDone.type === "error" && cancelDone.code === -32002,
    );

    // ── 14 ── Cancel a live task, then fail to subscribe to it. ─────────
    const { createTask } = await import("../../../lib/a2a/tasks");
    const liveContext = `${PREFIX}-live`;
    contexts.push(liveContext);
    const live = await createTask({ contextId: liveContext, history: [] });
    const canceled = await dispatch("CancelTask", { id: live.id }, { version: "1.0" });
    check(
      "a non-terminal task can be canceled",
      canceled.type === "result" &&
        asJson(asJson(asJson(canceled.value).status)).state === "TASK_STATE_CANCELED",
    );
    const subscribe = await dispatch("SubscribeToTask", { id: live.id }, { version: "1.0" });
    check(
      "subscribing to a terminal task returns -32004",
      subscribe.type === "error" && subscribe.code === -32004,
    );

    // ── 15-18 ── Capability gating and bad input. ───────────────────────
    console.log("\n[gating]");
    for (const method of [
      "CreateTaskPushNotificationConfig",
      "GetTaskPushNotificationConfig",
      "ListTaskPushNotificationConfigs",
      "DeleteTaskPushNotificationConfig",
    ]) {
      const res = await dispatch(method, {}, { version: "1.0" });
      check(`${method} returns -32003`, res.type === "error" && res.code === -32003);
    }
    const extended = await dispatch("GetExtendedAgentCard", {}, { version: "1.0" });
    check(
      "GetExtendedAgentCard returns -32004",
      extended.type === "error" && extended.code === -32004,
    );
    const unknown = await dispatch("Nope", {}, { version: "1.0" });
    check("an unknown method returns -32601", unknown.type === "error" && unknown.code === -32601);
    const empty = await dispatch(
      "SendMessage",
      { message: { role: "ROLE_USER", parts: [] } },
      { version: "1.0" },
    );
    check(
      "a message with no usable parts returns -32602",
      empty.type === "error" && empty.code === -32602,
    );

    // ── 19-20 ── Version negotiation. ───────────────────────────────────
    console.log("\n[versions]");
    const headers = (init: Record<string, string>) => new Headers(init);
    check(
      "no header means 0.3 (spec 3.6.2)",
      negotiateVersion(headers({}), "message/send") === "0.3",
    );
    check("patch versions are ignored", negotiateVersion(headers({ "A2A-Version": "1.0.1" })) === "1.0");
    check(
      "a 1.0-only method with no header is answered in 1.0",
      negotiateVersion(headers({}), "SendMessage") === "1.0",
    );
    check(
      "an unknown version is rejected",
      negotiateVersion(headers({ "A2A-Version": "9.9" })) === "unsupported",
    );

    const legacySend = await dispatch(
      "message/send",
      { message: message(Q_PLAIN) },
      { version: "0.3" },
    );
    check("the 0.3 method name dispatches", legacySend.type === "result");
    if (legacySend.type === "result") {
      const t = asJson(asJson(legacySend.value).task);
      if (typeof t.contextId === "string") contexts.push(t.contextId);
    }
    const legacyGet = await dispatch("tasks/get", { id: task.id }, { version: "0.3" });
    check("the 0.3 tasks/get name dispatches", legacyGet.type === "result");

    // ── 21-22 ── Conversation continuity and listing. ───────────────────
    console.log("\n[context]");
    const contextId = `${PREFIX}-conversation`;
    contexts.push(contextId);
    await send(Q_PLAIN, "1.0", { contextId });
    const second = await send(Q_CARDS, "1.0", { contextId });
    const secondHistory = second.history as Json[];
    check(
      "a reused contextId carries the earlier exchange forward",
      secondHistory.length >= 4 &&
        asJson((secondHistory[0].parts as Json[])[0]).text === Q_PLAIN,
      `history length ${secondHistory.length}`,
    );
    // Each task stores the whole conversation so far, so naively concatenating
    // tasks in a context replays the early turns once per later turn.
    const third = await send(Q_PLAIN, "1.0", { contextId });
    const thirdIds = (third.history as Json[]).map((m) => m.messageId as string);
    check(
      "history does not duplicate earlier turns as the conversation grows",
      new Set(thirdIds).size === thirdIds.length && thirdIds.length === 6,
      `ids=${JSON.stringify(thirdIds.map((i) => i.slice(0, 6)))}`,
    );

    // A completed task is a record. Referencing it continues the conversation
    // in a new task rather than overwriting what it already says.
    const reused = await send(Q_PLAIN, "1.0", { contextId, taskId: task.id });
    check(
      "referencing a completed task starts a new one instead of clobbering it",
      reused.id !== task.id,
      `reused=${reused.id} original=${task.id}`,
    );
    const original = await dispatch("GetTask", { id: task.id }, { version: "1.0" });
    check(
      "the original task's artifacts are untouched",
      original.type === "result" &&
        (asJson(asJson(original.value).artifacts as Json[])[0] as unknown as Json) !== undefined &&
        ((asJson(original.value).artifacts as Json[])[0].parts as Json[])[0].text === A_PLAIN,
    );

    const listed = await dispatch("ListTasks", { contextId, pageSize: 10 }, { version: "1.0" });
    check("ListTasks filters by context", listed.type === "result");
    if (listed.type === "result") {
      const value = asJson(listed.value);
      check(
        "ListTasks reports the tasks in that context",
        (value.tasks as Json[]).length === 4 && value.totalSize === 4,
        JSON.stringify({ n: (value.tasks as Json[]).length, total: value.totalSize }),
      );
    }

    // ── 23-25 ── The AgentFacts document. ───────────────────────────────
    console.log("\n[agent facts]");
    const facts = await agentFacts("https://proof.example");
    const factsRequired = [
      "id",
      "agent_name",
      "label",
      "description",
      "version",
      "provider",
      "endpoints",
      "capabilities",
      "skills",
    ];
    check(
      "every field the AgentFacts schema requires is present",
      factsRequired.every((f) => facts[f] !== undefined && facts[f] !== ""),
      factsRequired.filter((f) => facts[f] === undefined).join(","),
    );
    check(
      "skills carry the fields the schema requires of them",
      (facts.skills as Json[]).every(
        (s) => s.id && s.description && Array.isArray(s.inputModes) && Array.isArray(s.outputModes),
      ),
    );
    check("no fabricated evaluations block", facts.evaluations === undefined);
    check(
      "facts tell a reader the endpoint needs a token",
      (asJson(asJson(facts.capabilities).authentication).methods as string[])[0] === "bearer",
    );
    check(
      "certification is honestly self-declared",
      asJson(facts.certification).level === "self-declared",
    );
    check(
      "provider identity is the domain that serves the file",
      asJson(facts.provider).did === "did:web:proof.example",
    );
    check(
      "endpoints match the card's interfaces",
      (asJson(facts.endpoints).static as string[])[0] === card.supportedInterfaces[0].url,
    );
    check(
      "facts point back at the agent card",
      asJson(facts.a2a).agentCardUrl === "https://proof.example/.well-known/agent-card.json",
    );

    // ── 26 ── Rate limiting. ────────────────────────────────────────────
    console.log("\n[guard: rate limit]");
    const ip = `${PREFIX}-1.2.3.4`;
    const verdicts = [1, 2, 3, 4].map(() => underRateLimit(ip));
    check(
      "calls past the limit are rejected",
      verdicts.slice(0, 3).every(Boolean) && verdicts[3] === false,
      JSON.stringify(verdicts),
    );
    check("a different caller is unaffected", underRateLimit(`${PREFIX}-5.6.7.8`) === true);

    // ── 27 ── The endpoint is closed. ───────────────────────────────────
    console.log("\n[guard: credentials]");
    const adminPassword = process.env.ADMIN_PASSWORD ?? "";
    const from = (init: Record<string, string>) =>
      new Headers({ "x-forwarded-for": `${PREFIX}-auth-${Math.random()}`, ...init });

    check("no Authorization header is refused", authorize(from({})) === "unauthorized");
    check(
      "a wrong token is refused",
      authorize(from({ Authorization: "Bearer not-the-password" })) === "unauthorized",
    );
    check(
      "a non-bearer scheme is refused",
      authorize(from({ Authorization: `Basic ${adminPassword}` })) === "unauthorized",
    );
    check(
      "the admin password is accepted",
      authorize(from({ Authorization: `Bearer ${adminPassword}` })) === "ok",
    );

    process.env.A2A_API_KEY = `${PREFIX}-dedicated-key`;
    check(
      "a dedicated A2A_API_KEY is accepted too",
      authorize(from({ Authorization: `Bearer ${PREFIX}-dedicated-key` })) === "ok",
    );
    check(
      "the admin password still works alongside a dedicated key",
      authorize(from({ Authorization: `Bearer ${adminPassword}` })) === "ok",
    );
    delete process.env.A2A_API_KEY;

    // The endpoint validates the admin password, so it is a guessing oracle
    // unless failures are budgeted separately from ordinary traffic.
    const attacker = { "x-forwarded-for": `${PREFIX}-attacker` };
    const guesses = [1, 2, 3, 4, 5, 6].map(
      (n) => authorize(new Headers({ ...attacker, Authorization: `Bearer guess-${n}` })),
    );
    check(
      "a guessing loop is locked out after 5 failures",
      guesses.slice(0, 5).every((g) => g === "unauthorized") && guesses[5] === "locked-out",
      JSON.stringify(guesses),
    );
    check(
      "lockout holds even when the right password finally arrives",
      authorize(new Headers({ ...attacker, Authorization: `Bearer ${adminPassword}` })) ===
        "locked-out",
    );
    check(
      "a different address is not locked out by someone else's guessing",
      authorize(
        new Headers({ "x-forwarded-for": `${PREFIX}-bystander`, Authorization: `Bearer ${adminPassword}` }),
      ) === "ok",
    );
    resetGuards();

    // ── 27 ── Part normalization across generations. ────────────────────
    console.log("\n[normalization]");
    const fromV03 = normalizeIncomingMessage({
      kind: "message",
      messageId: "x",
      role: "user",
      parts: [{ kind: "text", text: "hello" }],
    });
    const fromV1 = normalizeIncomingMessage({
      messageId: "x",
      role: "ROLE_USER",
      parts: [{ text: "hello" }],
    });
    check(
      "0.3 and 1.0 messages normalize identically",
      JSON.stringify(fromV03) === JSON.stringify(fromV1) && fromV03?.role === "ROLE_USER",
      JSON.stringify({ fromV03, fromV1 }),
    );
    check(
      "a message with no parts is rejected",
      normalizeIncomingMessage({ role: "user", parts: [] }) === null,
    );
  } finally {
    // ── 28 ── Cleanup. ──────────────────────────────────────────────────
    console.log("\n[cleanup]");
    await cleanup();
    check("canned answers cleaned up", (await prisma.cannedAnswer.count()) === baseCanned);
    check("projects cleaned up", (await prisma.project.count()) === baseProjects);
    check("tasks cleaned up", (await prisma.a2ATask.count()) === baseTasks);
    await prisma.$disconnect();
  }

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log("\nAll proof assertions passed");
}

main().catch((e) => {
  console.error("Proof run errored:", e);
  process.exit(1);
});
