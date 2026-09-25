"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { StoredMsg } from "@/lib/chatStore";

/**
 * What a card may do to the conversation it sits in. The visitor chat
 * (app/Chat.tsx) provides one over its message list; the onboarding preview
 * provides a local one (LocalChatThreadProvider) over its own list. A card
 * that finds no thread (server render, an old page) simply can't append —
 * it draws itself and nothing more.
 *
 * Message ids are what make in-place rewrites possible (a booking step's
 * reply line changes when the visitor edits that step); `appendMessages`
 * replaces an id already present instead of adding it twice.
 */
export type ChatThread = {
  chatId: string;
  slug: string;
  /** Append; a message whose id is already present is replaced in place. */
  appendMessages(msgs: StoredMsg[]): void;
  rewriteMessage(id: string, patch: Partial<Pick<StoredMsg, "content" | "cards" | "typed">>): void;
  removeMessages(pred: (m: StoredMsg) => boolean): void;
  has(id: string): boolean;
  snapshot(): StoredMsg[];
  scrollToEnd(): void;
};

export const ChatThreadContext = createContext<ChatThread | null>(null);

export function useChatThread(): ChatThread | null {
  return useContext(ChatThreadContext);
}

/** Merge `incoming` into `current`: ids already present are replaced in place, the rest appended. */
export function mergeMessages(current: StoredMsg[], incoming: StoredMsg[]): StoredMsg[] {
  const out = [...current];
  for (const m of incoming) {
    const at = m.id ? out.findIndex((x) => x.id === m.id) : -1;
    if (at >= 0) out[at] = m;
    else out.push(m);
  }
  return out;
}

/**
 * A thread over local state — the onboarding preview and any card outside
 * the visitor chat. `render` draws the list; `onChange` hears every change.
 */
export function LocalChatThreadProvider({
  slug,
  chatId = "local",
  initial = [],
  onChange,
  onScrollToEnd,
  children,
}: {
  slug: string;
  chatId?: string;
  initial?: StoredMsg[];
  onChange?: (msgs: StoredMsg[]) => void;
  /** How this thread scrolls itself into view; a caller with no scroll
   *  container of its own (server render) can leave this out. */
  onScrollToEnd?: () => void;
  children: (msgs: StoredMsg[]) => ReactNode;
}) {
  const [msgs, setMsgs] = useState<StoredMsg[]>(initial);
  const latest = useRef(msgs);
  latest.current = msgs;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onScrollToEndRef = useRef(onScrollToEnd);
  onScrollToEndRef.current = onScrollToEnd;

  const update = useCallback((fn: (m: StoredMsg[]) => StoredMsg[]) => {
    setMsgs((m) => {
      const next = fn(m);
      latest.current = next;
      onChangeRef.current?.(next);
      return next;
    });
  }, []);

  const thread = useMemo<ChatThread>(
    () => ({
      chatId,
      slug,
      appendMessages: (incoming) => update((m) => mergeMessages(m, incoming)),
      rewriteMessage: (id, patch) => update((m) => m.map((x) => (x.id === id ? { ...x, ...patch } : x))),
      removeMessages: (pred) => update((m) => m.filter((x) => !pred(x))),
      has: (id) => latest.current.some((x) => x.id === id),
      snapshot: () => latest.current,
      scrollToEnd: () => onScrollToEndRef.current?.(),
    }),
    [chatId, slug, update],
  );

  return <ChatThreadContext.Provider value={thread}>{children(msgs)}</ChatThreadContext.Provider>;
}
