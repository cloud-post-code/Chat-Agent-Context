import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { claude, claudeModel } from "@/lib/claude";
import { buildSystemPrompt } from "@/lib/knowledge";

/**
 * First drafts for the Answers tab. A blank canned row is a chore Blake has to
 * sit down and write, and until he does, that question costs a model call on
 * every page view — so the tab writes its own first draft and hands him a
 * filled-in form to edit.
 *
 * A draft is served to visitors immediately. That isn't a shortcut: it comes
 * from the same retrieval + persona prompt the chatbot would have used to
 * answer that exact question, so serving it is the same answer the visitor was
 * going to get — only instant and free. `aiDraft` marks it unreviewed for
 * Blake, and saving the row clears the mark.
 *
 * Each row is auto-drafted at most once, ever (`draftedAt`), so a row Blake
 * deliberately empties stays empty rather than refilling itself behind him.
 * Redrafting is a button, never a watcher.
 */

/**
 * The Anthropic client narrowed to the one call drafting makes. Injectable so
 * the proof can count calls and read the prompt at the provider boundary,
 * exactly as lib/brain.ts does.
 */
export type DraftClient = {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<{ content: unknown[] }>;
  };
};

export type DraftDeps = { client?: DraftClient };

/**
 * How many rows one pass will draft. The pass runs during a dashboard render,
 * so the cap is what keeps it a short errand: the rows go out together, but
 * never more than this many, however long the question list grows.
 */
const MAX_PER_PASS = 8;

/**
 * How long a pass may hold up the dashboard render. Each draft runs retrieval
 * first, and retrieval embeds the question — so a batch of them queues behind
 * the embedding provider's per-minute limit and can take half a minute. Past
 * this deadline the page stops waiting: the in-flight drafts finish and store
 * themselves regardless, so nothing is wasted and a later load picks up
 * whatever didn't land in time.
 *
 * Read per call so `DRAFT_DEADLINE_MS` can shorten it — the proof drives this
 * path with a slow client rather than sitting out the real twelve seconds.
 */
function draftDeadlineMs(): number {
  return Number(process.env.DRAFT_DEADLINE_MS) || 12_000;
}

/**
 * Appended to the chatbot's own system prompt. The prompt it extends is written
 * for a live chat with tools, so this says what's different: the words are
 * stored and replayed verbatim, and there are no tools in this call.
 */
const DRAFT_BRIEF = `YOU ARE DRAFTING A STORED ANSWER:
This is not a live chat. Write the answer that will be saved and replayed
verbatim to every visitor who asks this question, so:
- Write prose only. You have no tools here — never mention or describe a card,
  and never write a placeholder. The owner attaches a card to the row themselves.
- Answer only from the knowledge above. If it isn't there, say so briefly and
  warmly, and point them to how they can reach the owner — do not invent anything.
- Two to four sentences, in the owner's voice, as if they are speaking.
- No preamble about drafting, no headings, no sign-off. Just the answer.`;

/** The text blocks of a completion, joined. */
function textOf(content: unknown[]): string {
  return content
    .filter((b): b is { type: "text"; text: string } => {
      const block = b as { type?: string; text?: string };
      return block.type === "text" && typeof block.text === "string";
    })
    .map((b) => b.text)
    .join("")
    .trim();
}

/** One draft, from the real knowledge prompt for that question. */
async function generate(userId: string, question: string, client: DraftClient): Promise<string> {
  const system = `${await buildSystemPrompt(userId, question)}\n\n${DRAFT_BRIEF}`;
  const message = await client.messages.create({
    model: claudeModel(),
    max_tokens: 700,
    system,
    messages: [{ role: "user", content: question }],
  });
  const text = textOf(message.content);
  // An empty completion is a failure, not an answer: storing it would burn the
  // row's one automatic shot and leave it blank forever.
  if (!text) throw new Error("model returned no text");
  return text;
}

async function store(id: string, answer: string): Promise<void> {
  await prisma.cannedAnswer.update({
    where: { id },
    data: { answer, aiDraft: true, draftedAt: new Date() },
  });
}

/**
 * Draft every row that is blank and has never been drafted. Returns how many
 * were written.
 *
 * Failure is per-row and swallowed: a provider outage must not take down the
 * admin dashboard, and the row is left blank with `draftedAt` still null so the
 * next load simply tries again.
 */
export async function draftBlankAnswers(userId: string, deps: DraftDeps = {}): Promise<number> {
  // Without a key there is nothing to try, and every row would fail in turn.
  if (!deps.client && !process.env.ANTHROPIC_API_KEY) return 0;

  const rows = await prisma.cannedAnswer.findMany({
    where: { userId, answer: "", draftedAt: null },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    take: MAX_PER_PASS,
  });

  // Concurrent because Blake is watching a blank dashboard while this runs;
  // bounded by MAX_PER_PASS so "concurrent" can never mean "a hundred at once".
  let drafted = 0;
  const batch = Promise.all(
    rows.map(async (row) => {
      try {
        await store(row.id, await generate(userId, row.question, deps.client ?? claude()));
        drafted++;
      } catch (e) {
        console.error(`draftBlankAnswers(${row.id}) failed:`, e);
      }
    }),
  );

  // Whichever comes first: every draft, or the deadline. The timer is unref'd
  // so waiting on it can never be the reason a process stays alive.
  await Promise.race([
    batch,
    new Promise((resolve) => setTimeout(resolve, draftDeadlineMs()).unref?.()),
  ]);
  return drafted;
}

/**
 * Throw away a row's current text and write a fresh draft — the manual override
 * for when the knowledge base has improved since. Explicit, so it overwrites a
 * reviewed answer too, and re-marks the row unreviewed.
 */
export async function redraftAnswer(
  userId: string,
  id: string,
  deps: DraftDeps = {},
): Promise<void> {
  const row = await prisma.cannedAnswer.findFirst({ where: { id, userId } });
  if (!row) return;
  await store(row.id, await generate(userId, row.question, deps.client ?? claude()));
}
