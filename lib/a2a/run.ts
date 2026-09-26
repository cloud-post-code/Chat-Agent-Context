import { answer } from "@/lib/brain";
import { newId, updateTask, isCancelRequested, getTask, type StoredTask } from "./tasks";
import type { A2AMessage, Artifact, Part, TaskStateName } from "./types";

/**
 * Runs one A2A task by driving the site's existing chatbot.
 *
 * There is deliberately no second brain here. lib/brain.ts already answers a
 * message independently of how it was reached, so A2A is a transport in exactly
 * the sense that refactor anticipated: this file translates between the brain's
 * {text, card} events and A2A's messages and artifacts, and nothing else.
 *
 * The translation that matters is the card one. On the web a UI block renders
 * as a project card or a gallery; to a calling agent that same block is
 * structured JSON it can actually consume, so blocks are emitted as `data`
 * parts. An agent asking "what has he built" gets machine-readable projects,
 * not a paragraph it has to parse.
 */

/** What the runner reports as it goes. Transports render these their own way. */
export type RunEvent =
  // The terminal status carries the finished agent message: 0.3 clients
  // commonly read the answer off `status.message` rather than off artifacts.
  | { kind: "status"; state: TaskStateName; message?: A2AMessage }
  | { kind: "text"; chunk: string; first: boolean }
  | { kind: "artifact"; artifact: Artifact; lastChunk: boolean };

/** Joins every text part of a message; other part kinds aren't input we accept. */
function messageText(message: A2AMessage): string {
  return message.parts
    .map((p) => ("text" in p ? p.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** A2A roles onto the brain's roles. Anything not from the agent is the user. */
function toBrainHistory(history: A2AMessage[]): { role: "user" | "assistant"; content: string }[] {
  return history
    .map((m) => ({
      role: m.role === "ROLE_AGENT" ? ("assistant" as const) : ("user" as const),
      content: messageText(m),
    }))
    .filter((m) => m.content.length > 0);
}

function textArtifact(taskId: string, text: string): Artifact {
  return {
    artifactId: `${taskId}-answer`,
    name: "answer",
    description: "The agent's spoken answer.",
    parts: [{ text, mediaType: "text/plain" }],
  };
}

function cardArtifact(taskId: string, seq: number, block: unknown): Artifact {
  const type = (block as { type?: string })?.type ?? "card";
  return {
    artifactId: `${taskId}-${type}-${seq}`,
    name: type,
    description: `Structured ${type} data the agent would render as a card for a human.`,
    parts: [{ data: block, mediaType: "application/json" }],
    metadata: { uiBlockType: type },
  };
}

/**
 * Executes the task, persisting progress as it happens so a caller polling
 * GetTask sees the same thing a streaming caller sees. Yields events for the
 * streaming transport; the blocking transport just drains it.
 */
export async function* runTask(input: {
  userId: string;
  taskId: string;
  contextId: string;
  userMessage: A2AMessage;
  priorHistory: A2AMessage[];
}): AsyncGenerator<RunEvent> {
  const { userId, taskId, contextId, userMessage, priorHistory } = input;
  const question = messageText(userMessage);

  await updateTask(userId, taskId, { state: "working" });
  yield { kind: "status", state: "working" };

  const artifacts: Artifact[] = [];
  const parts: Part[] = [];
  let spoken = "";
  let cards = 0;
  let firstChunk = true;
  let canceled = false;

  try {
    for await (const event of answer({
      userId,
      message: question,
      history: toBrainHistory(priorHistory),
      // The context is the conversation, so it doubles as the chat session id:
      // an agent-to-agent exchange lands in Activity like any other visitor's.
      sessionId: contextId,
      channel: "a2a",
    })) {
      // Cancellation can only be honored between events — mid-token there is
      // nothing meaningful to stop.
      if (await isCancelRequested(userId, taskId)) {
        canceled = true;
        break;
      }

      if (event.t === "text") {
        spoken += event.v;
        yield { kind: "text", chunk: event.v, first: firstChunk };
        firstChunk = false;
      } else if (event.t === "card") {
        const artifact = cardArtifact(taskId, cards++, event.v);
        artifacts.push(artifact);
        parts.push({ data: event.v, mediaType: "application/json" });
        yield { kind: "artifact", artifact, lastChunk: true };
      }
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : "The agent failed to produce an answer.";
    await updateTask(userId, taskId, { state: "failed", error: reason });
    yield { kind: "status", state: "failed" };
    return;
  }

  if (spoken.trim()) {
    const artifact = textArtifact(taskId, spoken);
    artifacts.unshift(artifact);
    parts.unshift({ text: spoken, mediaType: "text/plain" });
    yield { kind: "artifact", artifact, lastChunk: true };
  }

  const agentMessage: A2AMessage = {
    messageId: newId(),
    contextId,
    taskId,
    role: "ROLE_AGENT",
    parts: parts.length ? parts : [{ text: "", mediaType: "text/plain" }],
  };

  const state: TaskStateName = canceled ? "canceled" : "completed";
  await updateTask(userId, taskId, {
    state,
    artifacts,
    history: [...priorHistory, userMessage, agentMessage],
  });
  yield { kind: "status", state, message: agentMessage };
}

/** Runs a task to completion and returns the final stored row. */
export async function runTaskToCompletion(input: {
  userId: string;
  taskId: string;
  contextId: string;
  userMessage: A2AMessage;
  priorHistory: A2AMessage[];
}): Promise<StoredTask | null> {
  for await (const _event of runTask(input)) void _event;
  return getTask(input.userId, input.taskId);
}
