import type { A2AMessage, A2ATaskWire, Artifact, Part, TaskStateName } from "./types";
import { isTerminal } from "./types";

/**
 * Translates the v1.0 objects this server thinks in into the v0.3.x objects
 * most deployed A2A clients still speak.
 *
 * Version 1.0 removed the `kind` discriminator from every polymorphic object
 * (§A.2.1), renamed the task states to `TASK_STATE_*`, renamed the roles to
 * `ROLE_*`, and dropped the `final` flag from status events. None of that is
 * negotiable at the field level, so rather than litter the runtime with
 * version checks, the whole server works in v1.0 and everything for an older
 * caller passes through here on the way out.
 */

/** v0.3 method name → the v1.0 name we dispatch on internally. */
export const LEGACY_METHODS: Record<string, string> = {
  "message/send": "SendMessage",
  "message/stream": "SendStreamingMessage",
  "tasks/get": "GetTask",
  "tasks/list": "ListTasks",
  "tasks/cancel": "CancelTask",
  "tasks/resubscribe": "SubscribeToTask",
  "tasks/pushNotificationConfig/set": "CreateTaskPushNotificationConfig",
  "tasks/pushNotificationConfig/get": "GetTaskPushNotificationConfig",
  "tasks/pushNotificationConfig/list": "ListTaskPushNotificationConfigs",
  "tasks/pushNotificationConfig/delete": "DeleteTaskPushNotificationConfig",
  "agent/getAuthenticatedExtendedCard": "GetExtendedAgentCard",
};

/** Maps a part onto its v0.3 `kind`-tagged equivalent. */
function partV03(part: Part): Record<string, unknown> {
  if ("text" in part) return { kind: "text", text: part.text, ...meta(part) };
  if ("data" in part) return { kind: "data", data: part.data, ...meta(part) };
  return {
    kind: "file",
    file: { uri: part.url, mimeType: part.mediaType, name: part.filename },
    ...meta(part),
  };
}

function meta(part: Part): Record<string, unknown> {
  return part.metadata ? { metadata: part.metadata } : {};
}

function messageV03(message: A2AMessage): Record<string, unknown> {
  return {
    kind: "message",
    messageId: message.messageId,
    role: message.role === "ROLE_AGENT" ? "agent" : "user",
    parts: message.parts.map(partV03),
    ...(message.contextId ? { contextId: message.contextId } : {}),
    ...(message.taskId ? { taskId: message.taskId } : {}),
    ...(message.metadata ? { metadata: message.metadata } : {}),
    ...(message.referenceTaskIds?.length ? { referenceTaskIds: message.referenceTaskIds } : {}),
  };
}

function artifactV03(artifact: Artifact): Record<string, unknown> {
  return {
    artifactId: artifact.artifactId,
    ...(artifact.name ? { name: artifact.name } : {}),
    ...(artifact.description ? { description: artifact.description } : {}),
    parts: artifact.parts.map(partV03),
    ...(artifact.metadata ? { metadata: artifact.metadata } : {}),
  };
}

/** TASK_STATE_INPUT_REQUIRED → "input-required". */
function taskStateV03(state: string): string {
  return state.replace(/^TASK_STATE_/, "").toLowerCase().replace(/_/g, "-");
}

export function taskV03(task: A2ATaskWire): Record<string, unknown> {
  return {
    kind: "task",
    id: task.id,
    contextId: task.contextId,
    status: {
      state: taskStateV03(task.status.state),
      ...(task.status.message ? { message: messageV03(task.status.message) } : {}),
      ...(task.status.timestamp ? { timestamp: task.status.timestamp } : {}),
    },
    ...(task.artifacts?.length ? { artifacts: task.artifacts.map(artifactV03) } : {}),
    ...(task.history ? { history: task.history.map(messageV03) } : {}),
    ...(task.metadata ? { metadata: task.metadata } : {}),
  };
}

function statusUpdateV03(event: {
  taskId: string;
  contextId: string;
  status: { state: string; timestamp?: string };
}): Record<string, unknown> {
  const state = taskStateV03(event.status.state);
  return {
    kind: "status-update",
    taskId: event.taskId,
    contextId: event.contextId,
    status: { state, ...(event.status.timestamp ? { timestamp: event.status.timestamp } : {}) },
    // 1.0 infers stream termination from a terminal state; 0.3 clients read
    // this flag instead, and some of them hang without it.
    final: isTerminal(state as TaskStateName),
  };
}

function artifactUpdateV03(event: {
  taskId: string;
  contextId: string;
  artifact: Artifact;
  append?: boolean;
  lastChunk?: boolean;
}): Record<string, unknown> {
  return {
    kind: "artifact-update",
    taskId: event.taskId,
    contextId: event.contextId,
    artifact: artifactV03(event.artifact),
    ...(event.append === undefined ? {} : { append: event.append }),
    ...(event.lastChunk === undefined ? {} : { lastChunk: event.lastChunk }),
  };
}

/**
 * A v1.0 StreamResponse (a oneof keyed by member name) rendered as the bare,
 * `kind`-tagged object a 0.3 client expects.
 */
export function streamEventV03(event: Record<string, unknown>): Record<string, unknown> {
  if (event.task) return taskV03(event.task as A2ATaskWire);
  if (event.message) return messageV03(event.message as A2AMessage);
  if (event.statusUpdate) {
    return statusUpdateV03(event.statusUpdate as Parameters<typeof statusUpdateV03>[0]);
  }
  if (event.artifactUpdate) {
    return artifactUpdateV03(event.artifactUpdate as Parameters<typeof artifactUpdateV03>[0]);
  }
  return event;
}

/**
 * Incoming direction: a 0.3 message (role "user", `kind`-tagged parts) read as
 * the v1.0 message the rest of the server works with. Fields that only ever
 * appear in one generation are simply absent in the other, so one reader
 * handles both — the only real ambiguity is the role and part encoding.
 */
export function normalizeIncomingMessage(raw: unknown): A2AMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const rawParts = Array.isArray(m.parts) ? m.parts : [];
  const parts = rawParts.map(normalizeIncomingPart).filter((p): p is Part => p !== null);
  if (!parts.length) return null;

  const role = m.role === "agent" || m.role === "ROLE_AGENT" ? "ROLE_AGENT" : "ROLE_USER";
  return {
    messageId: typeof m.messageId === "string" && m.messageId ? m.messageId : "",
    role,
    parts,
    ...(typeof m.contextId === "string" && m.contextId ? { contextId: m.contextId } : {}),
    ...(typeof m.taskId === "string" && m.taskId ? { taskId: m.taskId } : {}),
    ...(m.metadata && typeof m.metadata === "object"
      ? { metadata: m.metadata as Record<string, unknown> }
      : {}),
  };
}

function normalizeIncomingPart(raw: unknown): Part | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  // 1.0: presence of the member is the type. 0.3: `kind` says which it is, and
  // a file part nests its content under `file`.
  if (typeof p.text === "string") return { text: p.text };
  if ("data" in p && p.data !== undefined) return { data: p.data };
  if (typeof p.url === "string") return { url: p.url };
  if (p.kind === "file" && p.file && typeof p.file === "object") {
    const f = p.file as Record<string, unknown>;
    if (typeof f.uri === "string") {
      return {
        url: f.uri,
        ...(typeof f.mimeType === "string" ? { mediaType: f.mimeType } : {}),
        ...(typeof f.name === "string" ? { filename: f.name } : {}),
      };
    }
  }
  return null;
}
