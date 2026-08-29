import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { safeJson } from "@/lib/util";
import {
  isTerminal,
  taskStateV1,
  type A2AMessage,
  type Artifact,
  type A2ATaskWire,
  type TaskStateName,
} from "./types";

/**
 * Task storage for the A2A endpoint.
 *
 * A2A lets a caller send a message now and collect the result later, so a task
 * has to outlive the request that created it. Reference implementations ship an
 * in-memory store; that would quietly break GetTask across a Railway redeploy
 * and across any future multi-instance deploy, so tasks live in Postgres next
 * to everything else the site remembers.
 */

export type StoredTask = {
  id: string;
  contextId: string;
  state: TaskStateName;
  history: A2AMessage[];
  artifacts: Artifact[];
  error: string | null;
  cancelRequested: boolean;
  createdAt: Date;
};

type Row = {
  id: string;
  contextId: string;
  state: string;
  history: string;
  artifacts: string;
  error: string | null;
  cancelRequested: boolean;
  createdAt: Date;
};

function hydrate(row: Row): StoredTask {
  return {
    id: row.id,
    contextId: row.contextId,
    state: row.state as TaskStateName,
    history: safeJson<A2AMessage[]>(row.history, []),
    artifacts: safeJson<Artifact[]>(row.artifacts, []),
    error: row.error,
    cancelRequested: row.cancelRequested,
    createdAt: row.createdAt,
  };
}

export function newId(): string {
  return randomUUID();
}

export async function createTask(input: {
  id?: string;
  userId: string;
  contextId: string;
  history: A2AMessage[];
}): Promise<StoredTask> {
  const row = await prisma.a2ATask.create({
    data: {
      id: input.id ?? newId(),
      userId: input.userId,
      contextId: input.contextId,
      state: "submitted",
      history: JSON.stringify(input.history),
      artifacts: "[]",
    },
  });
  return hydrate(row);
}

export async function getTask(userId: string, id: string): Promise<StoredTask | null> {
  const row = await prisma.a2ATask.findFirst({ where: { id, userId } });
  return row ? hydrate(row) : null;
}

export async function updateTask(
  userId: string,
  id: string,
  patch: Partial<Pick<StoredTask, "state" | "history" | "artifacts" | "error">>,
): Promise<StoredTask | null> {
  const data: Record<string, unknown> = {};
  if (patch.state !== undefined) data.state = patch.state;
  if (patch.error !== undefined) data.error = patch.error;
  if (patch.history !== undefined) data.history = JSON.stringify(patch.history);
  if (patch.artifacts !== undefined) data.artifacts = JSON.stringify(patch.artifacts);
  const updated = await prisma.a2ATask
    .updateMany({ where: { id, userId }, data })
    .catch(() => null);
  if (!updated || updated.count === 0) return null;
  const row = await prisma.a2ATask.findFirst({ where: { id, userId } });
  return row ? hydrate(row) : null;
}

/**
 * Marks a task for cancellation. Returns the reason it couldn't be canceled, or
 * null on success — the caller maps that onto TaskNotCancelableError. A task
 * already in a terminal state is not cancelable (§9.4.5).
 */
export async function requestCancel(
  userId: string,
  id: string,
): Promise<StoredTask | "missing" | "terminal"> {
  const task = await getTask(userId, id);
  if (!task) return "missing";
  if (isTerminal(task.state)) return "terminal";
  const row = await prisma.a2ATask.update({
    where: { id },
    data: { cancelRequested: true, state: "canceled" },
  });
  return hydrate(row);
}

export async function isCancelRequested(userId: string, id: string): Promise<boolean> {
  const row = await prisma.a2ATask.findFirst({
    where: { id, userId },
    select: { cancelRequested: true },
  });
  return row?.cancelRequested ?? false;
}

export async function listTasks(opts: {
  userId: string;
  contextId?: string;
  state?: TaskStateName;
  pageSize: number;
  skip: number;
}): Promise<{ tasks: StoredTask[]; total: number }> {
  const where = {
    userId: opts.userId,
    ...(opts.contextId ? { contextId: opts.contextId } : {}),
    ...(opts.state ? { state: opts.state } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.a2ATask.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.pageSize,
      skip: opts.skip,
    }),
    prisma.a2ATask.count({ where }),
  ]);
  return { tasks: rows.map(hydrate), total };
}

/**
 * Prior turns in the same context, oldest first. This is what gives an
 * agent-to-agent conversation memory: a caller that reuses a contextId gets
 * the earlier exchange fed back into the chatbot as history.
 */
export async function contextHistory(
  userId: string,
  contextId: string,
  limit = 20,
): Promise<A2AMessage[]> {
  const rows = await prisma.a2ATask.findMany({
    where: { userId, contextId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { history: true },
  });

  // Each task stores the whole conversation as it stood when that task ended,
  // so consecutive tasks overlap. Concatenating them would feed the model the
  // early turns once per later turn; dedupe on messageId, keeping first
  // appearance, so the conversation reads once in order.
  const seen = new Set<string>();
  const messages: A2AMessage[] = [];
  for (const row of rows.reverse()) {
    for (const message of safeJson<A2AMessage[]>(row.history, [])) {
      if (message.messageId && seen.has(message.messageId)) continue;
      if (message.messageId) seen.add(message.messageId);
      messages.push(message);
    }
  }
  return messages.slice(-limit);
}

/** Renders a stored task into the v1.0 wire shape. */
export function toWire(task: StoredTask, historyLength?: number): A2ATaskWire {
  const history =
    historyLength === undefined
      ? task.history
      : historyLength <= 0
        ? []
        : task.history.slice(-historyLength);

  const statusMessage = [...task.history].reverse().find((m) => m.role === "ROLE_AGENT");

  return {
    id: task.id,
    contextId: task.contextId,
    status: {
      state: taskStateV1(task.state),
      ...(statusMessage ? { message: statusMessage } : {}),
      timestamp: task.createdAt.toISOString(),
    },
    artifacts: task.artifacts,
    ...(historyLength === 0 ? {} : { history }),
    ...(task.error ? { metadata: { error: task.error } } : {}),
  };
}
