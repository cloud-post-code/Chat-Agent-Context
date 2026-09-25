/**
 * A2A wire types, v1.0 shape (the current spec: A2A v1.0.1, protocol "1.0").
 *
 * These mirror `specification/a2a.proto` in a2aproject/A2A, serialized the way
 * §5.5 requires: camelCase field names, enums as SCREAMING_SNAKE strings, and
 * oneofs expressed by WHICH KEY IS PRESENT rather than by a discriminator
 * field. That last point is the big break from v0.3.x, where every polymorphic
 * object carried `kind`. We speak both versions (see downgrade.ts); v1.0 is the
 * internal representation and 0.3 is produced on the way out.
 */

/** Protocol versions we can speak, newest first. Major.Minor only (§3.6). */
export const PROTOCOL_VERSIONS = ["1.0", "0.3"] as const;
export type ProtocolVersion = (typeof PROTOCOL_VERSIONS)[number];

/**
 * §3.6.2: "Agents MUST interpret empty value as 0.3 version." A caller that
 * sends no A2A-Version header is, by definition, a 0.3 caller.
 */
export const DEFAULT_PROTOCOL_VERSION: ProtocolVersion = "0.3";

/** Task lifecycle, stored in short form and rendered per version. */
export type TaskStateName =
  | "submitted"
  | "working"
  | "completed"
  | "failed"
  | "canceled"
  | "rejected"
  | "input-required"
  | "auth-required";

/** Once a task is here it can no longer change, and a stream must close. */
const TERMINAL_STATES: readonly TaskStateName[] = [
  "completed",
  "failed",
  "canceled",
  "rejected",
];

export function isTerminal(state: TaskStateName): boolean {
  return TERMINAL_STATES.includes(state);
}

/** v1.0 spelling: TASK_STATE_INPUT_REQUIRED, TASK_STATE_COMPLETED, ... */
export function taskStateV1(state: TaskStateName): string {
  return `TASK_STATE_${state.toUpperCase().replace(/-/g, "_")}`;
}

/** JSON-RPC + A2A error codes (§5.4). Identical across 0.3 and 1.0. */
export const A2A_ERRORS = {
  parse: { code: -32700, message: "Invalid JSON payload" },
  invalidRequest: { code: -32600, message: "Invalid request" },
  methodNotFound: { code: -32601, message: "Method not found" },
  invalidParams: { code: -32602, message: "Invalid parameters" },
  internal: { code: -32603, message: "Internal error" },
  taskNotFound: { code: -32001, message: "Task not found" },
  taskNotCancelable: { code: -32002, message: "Task cannot be canceled" },
  pushNotificationNotSupported: { code: -32003, message: "Push Notification is not supported" },
  unsupportedOperation: { code: -32004, message: "This operation is not supported" },
  contentTypeNotSupported: { code: -32005, message: "Incompatible content types" },
  invalidAgentResponse: { code: -32006, message: "Invalid agent response" },
  extendedCardNotConfigured: { code: -32007, message: "Extended agent card not configured" },
  extensionRequired: { code: -32008, message: "Extension support required" },
  versionNotSupported: { code: -32009, message: "Version not supported" },
} as const;

// ── Core data model (§4) ──────────────────────────────────────────────────

/**
 * A oneof: exactly one of text/raw/url/data is present, and that presence IS
 * the type. `mediaType` and `metadata` are flat on the part in 1.0.
 */
export type Part =
  | { text: string; mediaType?: string; metadata?: Json }
  | { data: unknown; mediaType?: string; metadata?: Json }
  | { url: string; mediaType?: string; filename?: string; metadata?: Json };

type Json = Record<string, unknown>;

type Role = "ROLE_USER" | "ROLE_AGENT";

export type A2AMessage = {
  messageId: string;
  contextId?: string;
  taskId?: string;
  role: Role;
  parts: Part[];
  metadata?: Json;
  extensions?: string[];
  referenceTaskIds?: string[];
};

export type Artifact = {
  artifactId: string;
  name?: string;
  description?: string;
  parts: Part[];
  metadata?: Json;
  extensions?: string[];
};

type TaskStatus = {
  state: string;
  message?: A2AMessage;
  /** ISO 8601 UTC (§5.6.1). */
  timestamp?: string;
};

export type A2ATaskWire = {
  id: string;
  contextId: string;
  status: TaskStatus;
  artifacts?: Artifact[];
  history?: A2AMessage[];
  metadata?: Json;
};

/** Stream payloads are also a oneof-by-key (§3.2.3). No `final` field in 1.0. */
export type StreamResponse =
  | { task: A2ATaskWire }
  | { message: A2AMessage }
  | { statusUpdate: { taskId: string; contextId: string; status: TaskStatus; metadata?: Json } }
  | {
      artifactUpdate: {
        taskId: string;
        contextId: string;
        artifact: Artifact;
        append?: boolean;
        lastChunk?: boolean;
        metadata?: Json;
      };
    };

// ── Agent Card (§4.4.1) ───────────────────────────────────────────────────

type AgentInterface = {
  url: string;
  /** Open string; officially JSONRPC | GRPC | HTTP+JSON. */
  protocolBinding: string;
  tenant?: string;
  protocolVersion: string;
};

export type AgentSkill = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
  securityRequirements?: unknown[];
};

export type AgentCardV1 = {
  name: string;
  description: string;
  supportedInterfaces: AgentInterface[];
  provider?: { url: string; organization: string };
  version: string;
  documentationUrl?: string;
  capabilities: {
    streaming?: boolean;
    pushNotifications?: boolean;
    extensions?: unknown[];
    extendedAgentCard?: boolean;
  };
  securitySchemes?: Record<string, unknown>;
  securityRequirements?: unknown[];
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
  signatures?: unknown[];
  iconUrl?: string;
};
