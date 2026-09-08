/**
 * Client-side chat history for the public agent page. Conversations live in
 * the visitor's own localStorage, scoped per agent slug so one browser can
 * talk to several agent pages without mixing histories.
 *
 * Two key shapes:
 *   chats:<slug>       — index: ChatMeta[] (id, title, updatedAt)
 *   chat:<slug>:<id>   — payload: StoredMsg[] for one conversation
 *
 * Every function takes a Storage-like object rather than touching
 * window.localStorage directly, so the proof can run offline and callers can
 * decide how to handle an unavailable storage (private mode, quota).
 * Corrupt JSON reads as "nothing stored" — history is a convenience, never
 * something that may break the chat itself.
 */

import type { UiBlock } from "@/app/cards/Cards";

export type StoredMsg = {
  role: "user" | "assistant";
  content: string;
  cards?: UiBlock[];
};

export type ChatMeta = {
  id: string;
  /** First user message, truncated — the sidebar label. */
  title: string;
  updatedAt: number;
};

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** Oldest chats beyond this are dropped, index and payload both. */
export const MAX_CHATS = 30;

const TITLE_MAX = 64;

const indexKey = (slug: string) => `chats:${slug}`;
const chatKey = (slug: string, id: string) => `chat:${slug}:${id}`;

export function newChatId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Sidebar label for a conversation: its first user message, truncated. */
export function chatTitle(messages: StoredMsg[]): string {
  const first = messages.find((m) => m.role === "user")?.content.trim();
  const t = first || "New chat";
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t;
}

/** All chats for one agent, newest first. Corrupt or missing index → []. */
export function listChats(storage: StorageLike, slug: string): ChatMeta[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(indexKey(slug)) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (c): c is ChatMeta =>
        !!c &&
        typeof (c as ChatMeta).id === "string" &&
        typeof (c as ChatMeta).title === "string" &&
        typeof (c as ChatMeta).updatedAt === "number",
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** One chat's messages. Corrupt or missing payload → []. */
export function loadMessages(storage: StorageLike, slug: string, id: string): StoredMsg[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(chatKey(slug, id)) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (m): m is StoredMsg =>
      !!m &&
      ((m as StoredMsg).role === "user" || (m as StoredMsg).role === "assistant") &&
      typeof (m as StoredMsg).content === "string",
  );
}

/**
 * Persist one chat (payload + index entry), bumping it to the top and
 * dropping the oldest chats beyond MAX_CHATS. `now` is injectable for tests.
 */
export function saveChat(
  storage: StorageLike,
  slug: string,
  id: string,
  messages: StoredMsg[],
  now: number = Date.now(),
): void {
  storage.setItem(chatKey(slug, id), JSON.stringify(messages));
  const rest = listChats(storage, slug).filter((c) => c.id !== id);
  const index = [{ id, title: chatTitle(messages), updatedAt: now }, ...rest].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  for (const dropped of index.slice(MAX_CHATS)) {
    storage.removeItem(chatKey(slug, dropped.id));
  }
  storage.setItem(indexKey(slug), JSON.stringify(index.slice(0, MAX_CHATS)));
}

/** Remove one chat entirely: index entry and message payload. */
export function deleteChat(storage: StorageLike, slug: string, id: string): void {
  storage.removeItem(chatKey(slug, id));
  const rest = listChats(storage, slug).filter((c) => c.id !== id);
  storage.setItem(indexKey(slug), JSON.stringify(rest));
}
