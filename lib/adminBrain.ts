import type Anthropic from "@anthropic-ai/sdk";
import { claude, claudeModel } from "@/lib/claude";
import type { ModelClient, Msg } from "@/lib/brain";
import { prisma } from "@/lib/db";
import { saveDirective } from "@/lib/directives";
import {
  asClassification,
  CLASSIFICATIONS,
  getIngestionSource,
  ingestFormsFor,
  listIngestionSources,
  type IngestionSourceRow,
} from "@/lib/ingestionSources";
import {
  ingestCustomFile,
  ingestCustomImage,
  ingestCustomText,
  ingestCustomUrl,
  type SplitClient,
} from "@/lib/customIngest";
import { extractDocument, extractLink, extractText } from "@/lib/scrape";
import { indexSource } from "@/lib/retrieval/indexer";
import { getBookingConfig } from "@/lib/appointments";
import { NEW_SOURCE_TAB_KEY } from "@/app/admin/contentTabs";

/**
 * The admin copilot: the chat-first surface's brain, sibling to lib/brain.ts
 * (the visitor chatbot). Same shape on purpose — injectable ModelClient,
 * bounded tool loop, NDJSON-ready events — but its tools act on the admin's
 * own dashboard: reveal a panel inline, save a goal for real, or draft an
 * ingestion for one-click approval. Transports stay thin; nothing here knows
 * about HTTP.
 */

/** A proposed ingestion, filled in by the model and approved by a click. */
export type IngestMethod = "url" | "text" | "file" | "image";
export type IngestProposal = {
  sourceKey: string;
  method: IngestMethod;
  title?: string;
  url?: string;
  text?: string;
  caption?: string;
  classification?: string;
};

/** What the admin brain emits. The transport writes these out as NDJSON. */
export type AdminEvent =
  | { t: "text"; v: string }
  | { t: "panel"; v: string }
  | { t: "goal"; v: { id: string; text: string } }
  | { t: "approve"; v: IngestProposal };

export type AdminInput = {
  userId: string;
  message: string;
  history?: Msg[];
  operator?: boolean;
};

export type AdminDeps = { client?: ModelClient };

/**
 * Panels the chat can reveal that aren't ingestion-source tabs. Content tabs
 * come from the live IngestionSource rows; these are the dashboard's fixed
 * sections, labels matching the dashboard strip.
 */
const FIXED_PANELS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "profile", label: "Profile" },
  { key: "theme", label: "Theme" },
  { key: "graph", label: "Knowledge" },
  { key: "activity", label: "Activity" },
  { key: "answers", label: "Presets" },
  { key: "goals", label: "Goals" },
  { key: "rules", label: "Rules" },
  { key: "contacts", label: "Contacts" },
  { key: "a2ui", label: "A2UI cards" },
  { key: "booking", label: "Appointments" },
  { key: NEW_SOURCE_TAB_KEY, label: "New ingestion source" },
];

/**
 * Every panel the chat may reveal for this user, derived the same way the
 * dashboard derives its strip: enabled IngestionSource rows in row order,
 * then the fixed sections, then Users for operators only.
 */
export async function adminPanelKeys(
  userId: string,
  operator = false,
): Promise<Array<{ key: string; label: string }>> {
  const [sources, booking] = await Promise.all([
    listIngestionSources(userId),
    getBookingConfig(userId),
  ]);
  return [
    ...sources.filter((s) => s.enabled).map((s) => ({ key: s.key, label: s.label })),
    ...FIXED_PANELS,
    // The Calendar exists only while booking does; the Appointments settings
    // panel (key "booking") is fixed so there is always a place to enable it.
    ...(booking.enabled ? [{ key: "calendar", label: "Calendar" }] : []),
    ...(operator ? [{ key: "users", label: "Users" }] : []),
  ];
}

/**
 * Whether (and how) a source can take this kind of input, from the same
 * ingestFormsFor mapping that decides which controls its panel renders.
 * Built-in sources route to the classic Knowledge write path; only the three
 * document-shaped ones are chat-ingestable — the rest have bespoke panels.
 */
export type IngestPlan = { ok: true; path: "custom" | "builtin" } | { ok: false; error: string };

const BUILTIN_INGESTABLE: ReadonlySet<string> = new Set(["links", "pdfs", "text"]);

export function ingestPlanFor(
  row: Pick<IngestionSourceRow, "key" | "builtin" | "uploadMethod" | "storageKinds">,
  method: IngestMethod,
): IngestPlan {
  const forms = ingestFormsFor(row.uploadMethod, row.storageKinds);
  const allowed =
    method === "url"
      ? forms.url
      : method === "file"
        ? forms.docFile
        : method === "text"
          ? forms.textarea
          : forms.image;
  if (!allowed) {
    return { ok: false, error: `The "${row.key}" source doesn't take ${method} input.` };
  }
  if (row.builtin && !BUILTIN_INGESTABLE.has(row.key)) {
    return { ok: false, error: `The "${row.key}" section has its own panel — use that instead.` };
  }
  return { ok: true, path: row.builtin ? "builtin" : "custom" };
}

/** Extraction seams, injectable so proofs stay offline (mirrors lib/customIngest). */
export type ApproveDeps = {
  textExtract?: typeof extractText;
  linkExtract?: typeof extractLink;
  docExtract?: typeof extractDocument;
  splitClient?: SplitClient;
  /// The uploaded document, when the proposal's method is "file" or "image".
  file?: { bytes: Buffer; filename: string; contentType?: string };
};

/**
 * Execute an approved ingestion proposal through the real write paths:
 * custom sources via lib/customIngest (rows marked ingest:<key>), built-in
 * links/pdfs/text via the same scan-then-index flow their panels use.
 * Returns an error string, or null on success.
 */
export async function approveIngestion(
  userId: string,
  proposal: IngestProposal,
  deps: ApproveDeps = {},
): Promise<string | null> {
  const row = await getIngestionSource(userId, proposal.sourceKey);
  if (!row || !row.enabled) return "That ingestion source doesn't exist any more.";
  const plan = ingestPlanFor(row, proposal.method);
  if (!plan.ok) return plan.error;
  const classification = asClassification(proposal.classification) ?? row.classification;

  if (plan.path === "custom") {
    switch (proposal.method) {
      case "text":
        return ingestCustomText(
          userId,
          row.key,
          { title: proposal.title ?? "", text: proposal.text ?? "", classification },
          deps.textExtract,
          deps.splitClient,
        );
      case "url":
        return ingestCustomUrl(
          userId,
          row.key,
          (proposal.url ?? "").trim(),
          deps.linkExtract,
          deps.splitClient,
          classification,
        );
      case "file":
        if (!deps.file) return "Pick the document file first.";
        return ingestCustomFile(
          userId,
          row.key,
          deps.file.bytes,
          deps.file.filename,
          deps.docExtract,
          deps.splitClient,
          classification,
        );
      case "image":
        if (!deps.file) return "Pick the image first.";
        return ingestCustomImage(
          userId,
          row.key,
          deps.file.bytes,
          deps.file.contentType ?? "image/jpeg",
          proposal.caption ?? "",
          undefined,
          classification,
        );
    }
  }

  return approveBuiltin(userId, row.key, proposal, deps);
}

/**
 * The built-in Knowledge write path, matching the dashboard's addSource:
 * scan, store an unmarked Source row (so it shows on its classic tab), then
 * index best-effort.
 */
async function approveBuiltin(
  userId: string,
  key: string,
  proposal: IngestProposal,
  deps: ApproveDeps,
): Promise<string | null> {
  const err = (e: unknown) => (e instanceof Error ? e.message : String(e));
  let src: { id: string };
  let extracted: {
    title?: string | null;
    rawText?: string | null;
    summary?: string | null;
    tags?: string[];
    imageUrl?: string | null;
  };
  try {
    if (key === "links") {
      const url = (proposal.url ?? "").trim();
      if (!/^https?:\/\//i.test(url)) return "That doesn't look like a link.";
      src = await prisma.source.upsert({
        where: { userId_url: { userId, url } },
        update: { status: "pending", error: null, type: "link" },
        create: { userId, url, type: "link", status: "pending" },
      });
      extracted = await (deps.linkExtract ?? extractLink)(url);
    } else if (key === "pdfs") {
      if (!deps.file) return "Pick the document file first.";
      const isWord = /\.docx$/i.test(deps.file.filename);
      src = await prisma.source.create({
        data: {
          userId,
          type: isWord ? "doc" : "pdf",
          filename: deps.file.filename,
          status: "pending",
        },
      });
      extracted = await (deps.docExtract ?? extractDocument)(deps.file.bytes, deps.file.filename);
    } else {
      const text = (proposal.text ?? "").trim();
      if (text.length < 2) return "Nothing to ingest.";
      const title = (proposal.title ?? "").trim() || null;
      src = await prisma.source.create({
        data: { userId, type: "text", title, status: "pending" },
      });
      extracted = await (deps.textExtract ?? extractText)(text, title);
    }
  } catch (e) {
    return err(e);
  }

  try {
    await prisma.source.update({
      where: { id: src.id },
      data: {
        title: extracted.title ?? null,
        rawText: extracted.rawText ?? null,
        summary: extracted.summary ?? null,
        tags: JSON.stringify(extracted.tags ?? []),
        imageUrl: extracted.imageUrl ?? null,
        status: "scanned",
        error: null,
      },
    });
    // Best-effort, like the dashboard: an index failure never un-scans.
    await indexSource(userId, src.id).catch((e) => console.error(`index ${src.id} failed:`, e));
  } catch (e) {
    await prisma.source
      .update({ where: { id: src.id }, data: { status: "failed", error: err(e) } })
      .catch(() => {});
    return err(e);
  }
  return null;
}

// ── The tool loop ───────────────────────────────────────────────────────────

function adminTools(
  panelKeys: string[],
  ingestable: Array<{ key: string }>,
): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [
    {
      name: "show_panel",
      description:
        "Reveal one of the admin dashboard's panels inline in the chat, fully interactive. " +
        "Use it whenever the admin asks to see, open, edit, or work with a section — " +
        "showing the real panel beats describing it.",
      input_schema: {
        type: "object",
        properties: {
          key: { type: "string", enum: panelKeys, description: "The panel's key" },
        },
        required: ["key"],
      },
    },
    {
      name: "save_goal",
      description:
        "Create an agent goal directly, without a form. Use ONLY when the admin has stated " +
        "the goal's actual text; if they just want to add or browse goals, show the goals panel.",
      input_schema: {
        type: "object",
        properties: { text: { type: "string", description: "The goal, exactly as it should read" } },
        required: ["text"],
      },
    },
  ];
  if (ingestable.length) {
    tools.push({
      name: "propose_ingestion",
      description:
        "Draft an ingestion for one-click approval: pick the best-matching source for what " +
        "the admin wants to ingest and pre-fill every field you can. An approval card is " +
        "shown; nothing is written until the admin clicks Approve.",
      input_schema: {
        type: "object",
        properties: {
          sourceKey: {
            type: "string",
            enum: ingestable.map((s) => s.key),
            description: "The ingestion source to write into",
          },
          method: { type: "string", enum: ["url", "text", "file", "image"] },
          title: { type: "string" },
          url: { type: "string" },
          text: { type: "string", description: "The full text to ingest, for method 'text'" },
          caption: { type: "string" },
          classification: { type: "string", enum: [...CLASSIFICATIONS] },
        },
        required: ["sourceKey", "method"],
      },
    });
  }
  return tools;
}

function systemPrompt(
  panels: Array<{ key: string; label: string }>,
  sources: IngestionSourceRow[],
): string {
  const panelLines = panels.map((p) => `- ${p.key}: ${p.label}`).join("\n");
  const sourceLines = sources
    .map((s) => {
      const forms = ingestFormsFor(s.uploadMethod, s.storageKinds);
      const takes = [
        forms.url && "url",
        forms.docFile && "file",
        forms.textarea && "text",
        forms.image && "image",
      ]
        .filter(Boolean)
        .join("/");
      return `- ${s.key} (takes ${takes || "nothing"}): ${s.description || s.label}`;
    })
    .join("\n");
  return [
    "You are the admin copilot for this account's agent page. The admin talks to you",
    "instead of clicking through the dashboard. Your job is to cut clicks: act, or put",
    "the exact right panel in front of them, in as few steps as possible.",
    "",
    "PANELS you can reveal with show_panel (fully interactive, inline):",
    panelLines,
    "",
    "INGESTION SOURCES for propose_ingestion (pick the best match for the content):",
    sourceLines,
    "",
    "Rules:",
    "- Asked to see or work with a section: call show_panel with its key. Keep any",
    "  accompanying text to one short sentence.",
    "- Asked to add a goal WITH its text given: call save_goal, then confirm.",
    "- Asked to add a goal without the text: show the goals panel.",
    "- Asked to ingest something: pick the best source, pre-fill everything you can",
    "  (title, text, url, classification), and call propose_ingestion. For a document",
    "  or image file, still propose — the card exposes the file picker.",
    "- Never invent panel keys or source keys beyond the lists above.",
  ].join("\n");
}

/** Run one tool call for real; returns the events to emit and the tool_result text. */
async function execute(
  userId: string,
  name: string,
  input: Record<string, unknown>,
  panelKeys: Set<string>,
  sources: IngestionSourceRow[],
): Promise<{ events: AdminEvent[]; result: string }> {
  switch (name) {
    case "show_panel": {
      const key = String(input.key ?? "");
      if (!panelKeys.has(key)) return { events: [], result: `No panel named "${key}".` };
      return { events: [{ t: "panel", v: key }], result: "Panel rendered inline for the admin." };
    }
    case "save_goal": {
      const text = String(input.text ?? "").trim();
      if (!text) return { events: [], result: "Goal text was empty; nothing saved." };
      await saveDirective(userId, { kind: "goal", text, enabled: true });
      const row = await prisma.agentDirective.findFirst({
        where: { userId, kind: "goal", text },
        orderBy: { createdAt: "desc" },
      });
      if (!row) return { events: [], result: "The goal did not save." };
      return {
        events: [{ t: "goal", v: { id: row.id, text: row.text } }],
        result: `Goal saved (id ${row.id}).`,
      };
    }
    case "propose_ingestion": {
      const sourceKey = String(input.sourceKey ?? "");
      const row = sources.find((s) => s.key === sourceKey && s.enabled);
      if (!row) return { events: [], result: `No ingestion source named "${sourceKey}".` };
      const method = String(input.method ?? "") as IngestMethod;
      const plan = ingestPlanFor(row, method);
      if (!plan.ok) return { events: [], result: plan.error };
      const proposal: IngestProposal = {
        sourceKey,
        method,
        title: input.title ? String(input.title) : undefined,
        url: input.url ? String(input.url) : undefined,
        text: input.text ? String(input.text) : undefined,
        caption: input.caption ? String(input.caption) : undefined,
        classification: asClassification(String(input.classification ?? "")) ?? row.classification,
      };
      return {
        events: [{ t: "approve", v: proposal }],
        result: "Approval card shown. Nothing is written until the admin clicks Approve.",
      };
    }
    default:
      return { events: [], result: `Unknown tool "${name}".` };
  }
}

/**
 * Answer one admin message: stream text, run tools for real, let the model
 * close. Yields events in the order they happen.
 */
export async function* adminAnswer(
  input: AdminInput,
  deps: AdminDeps = {},
): AsyncGenerator<AdminEvent> {
  const { userId, message, history = [], operator = false } = input;
  const client: ModelClient = deps.client ?? claude();

  try {
    const [panels, sources] = await Promise.all([
      adminPanelKeys(userId, operator),
      listIngestionSources(userId),
    ]);
    const enabled = sources.filter((s) => s.enabled);
    const ingestable = enabled.filter((s) =>
      (["url", "text", "file", "image"] as const).some((m) => ingestPlanFor(s, m).ok),
    );
    const system = systemPrompt(panels, ingestable);
    const tools = adminTools(
      panels.map((p) => p.key),
      ingestable,
    );
    const keySet = new Set(panels.map((p) => p.key));

    const convo: Anthropic.MessageParam[] = history.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    convo.push({ role: "user", content: message });

    for (let turn = 0; turn < 4; turn++) {
      const stream = client.messages.stream({
        model: claudeModel(),
        max_tokens: 1024,
        system,
        tools,
        messages: convo,
      });

      for await (const event of stream) {
        const delta = event.delta as { type?: string; text?: string } | undefined;
        if (event.type === "content_block_delta" && delta?.type === "text_delta") {
          yield { t: "text", v: delta.text ?? "" };
        }
      }

      const final = await stream.finalMessage();
      const content = final.content as Anthropic.ContentBlock[];
      const toolUses = content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0) return;

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const { events, result } = await execute(
          userId,
          tu.name,
          (tu.input ?? {}) as Record<string, unknown>,
          keySet,
          enabled,
        );
        for (const e of events) yield e;
        results.push({ type: "tool_result", tool_use_id: tu.id, content: result });
      }

      convo.push({ role: "assistant", content });
      convo.push({ role: "user", content: results });
    }
  } catch (e) {
    const note =
      e instanceof Error && e.message.includes("ANTHROPIC_API_KEY")
        ? "The copilot isn't configured yet (missing API key)."
        : "Something went wrong reaching the model.";
    yield { t: "text", v: `\n\n[${note}]` };
  }
}
