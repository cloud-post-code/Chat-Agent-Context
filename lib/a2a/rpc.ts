import { normalizeIncomingMessage, LEGACY_METHODS } from "./downgrade";
import { runTask, runTaskToCompletion } from "./run";
import {
  contextHistory,
  createTask,
  getTask,
  listTasks,
  newId,
  requestCancel,
  toWire,
} from "./tasks";
import {
  A2A_ERRORS,
  DEFAULT_PROTOCOL_VERSION,
  PROTOCOL_VERSIONS,
  isTerminal,
  taskStateV1,
  type A2AMessage,
  type ProtocolVersion,
  type StreamResponse,
  type TaskStateName,
} from "./types";

/**
 * The A2A method table. Both protocol bindings — JSON-RPC and HTTP+JSON — are
 * thin wrappers over `dispatch()`, which is what §5.1's "all bindings MUST be
 * functionally equivalent" requires in practice: one implementation, two
 * envelopes, no chance of them drifting apart.
 */

export type MethodResult =
  | { type: "result"; value: unknown }
  | { type: "error"; code: number; message: string; data?: unknown }
  | { type: "stream"; events: AsyncGenerator<StreamResponse> };

export type RpcContext = {
  version: ProtocolVersion;
  /// Whose agent this surface serves — the legacy endpoint binds to the
  /// founding user (see the route handlers).
  userId: string;
};

type Params = Record<string, unknown>;

function err(e: { code: number; message: string }, data?: unknown): MethodResult {
  return { type: "error", code: e.code, message: e.message, data };
}

/**
 * Which protocol generation to answer in.
 *
 * §3.6.2 is explicit that an absent `A2A-Version` header means 0.3, and that's
 * the rule for any conformant client. The one refinement: a caller that sends
 * no header but names a 1.0-only method (`SendMessage` rather than
 * `message/send`) is answered in 1.0, because interpreting it as 0.3 would mean
 * rejecting a method 0.3 doesn't have.
 */
export function negotiateVersion(
  headers: Headers,
  method?: string,
): ProtocolVersion | "unsupported" {
  const raw = (headers.get("a2a-version") ?? "").trim();
  if (!raw) {
    return method && !(method in LEGACY_METHODS) && KNOWN_METHODS.has(method)
      ? "1.0"
      : DEFAULT_PROTOCOL_VERSION;
  }
  // Patch numbers are not protocol-significant (§3.6): 1.0.1 is "1.0".
  const [major, minor] = raw.split(".");
  const version = `${major}.${minor}`;
  return (PROTOCOL_VERSIONS as readonly string[]).includes(version)
    ? (version as ProtocolVersion)
    : "unsupported";
}

const KNOWN_METHODS = new Set([
  "SendMessage",
  "SendStreamingMessage",
  "GetTask",
  "ListTasks",
  "CancelTask",
  "SubscribeToTask",
  "CreateTaskPushNotificationConfig",
  "GetTaskPushNotificationConfig",
  "ListTaskPushNotificationConfigs",
  "DeleteTaskPushNotificationConfig",
  "GetExtendedAgentCard",
]);

/** Accepts either generation's method name and returns the canonical 1.0 one. */
export function canonicalMethod(method: string): string | null {
  if (KNOWN_METHODS.has(method)) return method;
  return LEGACY_METHODS[method] ?? null;
}

export async function dispatch(
  method: string,
  params: Params,
  ctx: RpcContext,
): Promise<MethodResult> {
  const canonical = canonicalMethod(method);
  if (!canonical) return err(A2A_ERRORS.methodNotFound, { method });

  switch (canonical) {
    case "SendMessage":
      return sendMessage(params, ctx, false);
    case "SendStreamingMessage":
      return sendMessage(params, ctx, true);
    case "GetTask":
      return getTaskMethod(params, ctx);
    case "ListTasks":
      return listTasksMethod(params, ctx);
    case "CancelTask":
      return cancelTaskMethod(params, ctx);
    case "SubscribeToTask":
      return subscribeMethod(params, ctx);
    // Capability gating (§3.3.4): the card says pushNotifications is false, so
    // these MUST report exactly this error rather than 404 or "not found".
    case "CreateTaskPushNotificationConfig":
    case "GetTaskPushNotificationConfig":
    case "ListTaskPushNotificationConfigs":
    case "DeleteTaskPushNotificationConfig":
      return err(A2A_ERRORS.pushNotificationNotSupported);
    case "GetExtendedAgentCard":
      return err(A2A_ERRORS.unsupportedOperation);
    default:
      return err(A2A_ERRORS.methodNotFound, { method });
  }
}

/** Reads the send configuration of either generation into one decision. */
function wantsBlocking(params: Params, version: ProtocolVersion): boolean {
  const conf = (params.configuration as Params | undefined) ?? {};
  if (version === "1.0") return conf.returnImmediately !== true;
  // 0.3 spelled it the other way round. Absent means "give me the answer",
  // which is what a caller sending a question almost always wants.
  return conf.blocking !== false;
}

function historyLengthOf(params: Params): number | undefined {
  const conf = (params.configuration as Params | undefined) ?? {};
  const raw = conf.historyLength ?? params.historyLength;
  return typeof raw === "number" ? raw : undefined;
}

async function sendMessage(
  params: Params,
  ctx: RpcContext,
  streaming: boolean,
): Promise<MethodResult> {
  const message = normalizeIncomingMessage(params.message);
  if (!message) return err(A2A_ERRORS.invalidParams, { field: "message" });
  if (!message.messageId) message.messageId = newId();

  const contextId = message.contextId ?? newId();
  const priorHistory = await contextHistory(ctx.userId, contextId);

  // A finished task is a record of what happened; a follow-up message must not
  // overwrite it. Referencing one continues the conversation in a fresh task,
  // which is also what stops a caller clobbering a task by guessing its id.
  const requested = message.taskId;
  const existing = requested ? await getTask(ctx.userId, requested) : null;
  const taskId = requested && existing && !isTerminal(existing.state) ? requested : newId();

  message.contextId = contextId;
  message.taskId = taskId;
  if (taskId !== existing?.id) {
    await createTask({ id: taskId, userId: ctx.userId, contextId, history: [] });
  }

  if (streaming) {
    return {
      type: "stream",
      events: streamRun({ userId: ctx.userId, taskId, contextId, message, priorHistory }),
    };
  }

  if (!wantsBlocking(params, ctx.version)) {
    // Non-blocking: acknowledge now, keep working. The process outlives the
    // response here (a long-lived Node server, not a lambda), and the task row
    // is the caller's handle on it via GetTask.
    void runTaskToCompletion({
      userId: ctx.userId,
      taskId,
      contextId,
      userMessage: message,
      priorHistory,
    }).catch(() => {});
    const submitted = await getTask(ctx.userId, taskId);
    return submitted
      ? { type: "result", value: sendResult(toWire(submitted, historyLengthOf(params))) }
      : err(A2A_ERRORS.internal);
  }

  const finished = await runTaskToCompletion({
    userId: ctx.userId,
    taskId,
    contextId,
    userMessage: message,
    priorHistory,
  });
  if (!finished) return err(A2A_ERRORS.internal);
  return { type: "result", value: sendResult(toWire(finished, historyLengthOf(params))) };
}

/**
 * Always the 1.0 SendMessageResponse oneof. Unwrapping it for a 0.3 caller,
 * which expects the Task itself, happens in one place — transport.renderResult
 * — so the dispatcher never has to think about protocol vocabulary.
 */
function sendResult(task: unknown): unknown {
  return { task };
}

/** Turns the runner's events into A2A stream events (v1.0 oneof shape). */
async function* streamRun(input: {
  userId: string;
  taskId: string;
  contextId: string;
  message: A2AMessage;
  priorHistory: A2AMessage[];
}): AsyncGenerator<StreamResponse> {
  const { userId, taskId, contextId, message, priorHistory } = input;

  // §6.2: the stream opens with the Task itself so the client learns its id.
  const created = await getTask(userId, taskId);
  if (created) yield { task: toWire(created, 0) };

  for await (const event of runTask({
    userId,
    taskId,
    contextId,
    userMessage: message,
    priorHistory,
  })) {
    if (event.kind === "status") {
      yield {
        statusUpdate: {
          taskId,
          contextId,
          status: {
            state: taskStateV1(event.state),
            ...(event.message ? { message: event.message } : {}),
            timestamp: nowIso(),
          },
        },
      };
      continue;
    }

    if (event.kind === "text") {
      // Incremental text is an append-only artifact: chunk one creates it,
      // the rest extend it. `lastChunk` lands with the completed artifact
      // emitted at the end of the run.
      yield {
        artifactUpdate: {
          taskId,
          contextId,
          artifact: {
            artifactId: `${taskId}-answer`,
            name: "answer",
            parts: [{ text: event.chunk, mediaType: "text/plain" }],
          },
          append: !event.first,
          lastChunk: false,
        },
      };
      continue;
    }

    yield {
      artifactUpdate: {
        taskId,
        contextId,
        artifact: event.artifact,
        append: false,
        lastChunk: event.lastChunk,
      },
    };
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

async function getTaskMethod(params: Params, ctx: RpcContext): Promise<MethodResult> {
  const id = typeof params.id === "string" ? params.id : "";
  if (!id) return err(A2A_ERRORS.invalidParams, { field: "id" });
  const task = await getTask(ctx.userId, id);
  if (!task) return err(A2A_ERRORS.taskNotFound, { id });
  return { type: "result", value: toWire(task, historyLengthOf(params)) };
}

async function cancelTaskMethod(params: Params, ctx: RpcContext): Promise<MethodResult> {
  const id = typeof params.id === "string" ? params.id : "";
  if (!id) return err(A2A_ERRORS.invalidParams, { field: "id" });
  const outcome = await requestCancel(ctx.userId, id);
  if (outcome === "missing") return err(A2A_ERRORS.taskNotFound, { id });
  if (outcome === "terminal") return err(A2A_ERRORS.taskNotCancelable, { id });
  return { type: "result", value: toWire(outcome) };
}

async function listTasksMethod(params: Params, ctx: RpcContext): Promise<MethodResult> {
  const pageSize = clamp(numberOr(params.pageSize, 50), 1, 100);
  const skip = Math.max(0, numberOr(params.pageToken, 0));
  const stateFilter =
    typeof params.status === "string" && params.status
      ? (params.status.replace(/^TASK_STATE_/, "").toLowerCase().replace(/_/g, "-") as TaskStateName)
      : undefined;

  const { tasks, total } = await listTasks({
    userId: ctx.userId,
    contextId: typeof params.contextId === "string" ? params.contextId : undefined,
    state: stateFilter,
    pageSize,
    skip,
  });

  const wire = tasks.map((t) => toWire(t, 0));
  const nextSkip = skip + tasks.length;
  void ctx;
  return {
    type: "result",
    value: {
      tasks: wire,
      nextPageToken: nextSkip < total ? String(nextSkip) : "",
      pageSize,
      totalSize: total,
    },
  };
}

function numberOr(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Re-attaches to a task that is still running. There is no in-process event bus
 * to subscribe to — the runner's progress lives in the task row — so this polls
 * that row and emits what changed. Slower than a bus by a poll interval, but it
 * works across instances and across a redeploy mid-answer, which a bus doesn't.
 */
async function subscribeMethod(params: Params, ctx: RpcContext): Promise<MethodResult> {
  const id = typeof params.id === "string" ? params.id : "";
  if (!id) return err(A2A_ERRORS.invalidParams, { field: "id" });
  const task = await getTask(ctx.userId, id);
  if (!task) return err(A2A_ERRORS.taskNotFound, { id });
  // §9.4.6: subscribing to a finished task is an unsupported operation.
  if (["completed", "failed", "canceled", "rejected"].includes(task.state)) {
    return err(A2A_ERRORS.unsupportedOperation, { id, state: task.state });
  }
  return { type: "stream", events: pollTask(ctx.userId, id) };
}

const POLL_MS = 400;
const POLL_TIMEOUT_MS = 120_000;

async function* pollTask(userId: string, id: string): AsyncGenerator<StreamResponse> {
  let lastState = "";
  let seenArtifacts = 0;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const task = await getTask(userId, id);
    if (!task) return;

    for (const artifact of task.artifacts.slice(seenArtifacts)) {
      yield { artifactUpdate: { taskId: id, contextId: task.contextId, artifact, lastChunk: true } };
    }
    seenArtifacts = task.artifacts.length;

    if (task.state !== lastState) {
      lastState = task.state;
      const wire = toWire(task);
      yield {
        statusUpdate: {
          taskId: id,
          contextId: task.contextId,
          status: wire.status,
        },
      };
    }

    if (["completed", "failed", "canceled", "rejected"].includes(task.state)) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
