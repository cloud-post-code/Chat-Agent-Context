import { describe, expect, it } from "vitest";
import { MAX_CHATS, chatTitle, deleteChat, listChats, loadMessages, newChatId, saveChat, type StoredMsg } from "@/lib/chatStore";

// Converted from docs/features/chat-history-sidebar/proof.ts.
function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    keys: () => [...m.keys()],
  };
}
const user = (content: string): StoredMsg => ({ role: "user", content });
const bot = (content: string, cards?: unknown[]): StoredMsg => ({ role: "assistant", content, ...(cards ? { cards: cards as StoredMsg["cards"] } : {}) });

describe("chatStore", () => {
  it("starts empty and scopes by slug", () => {
    const s = memStorage();
    expect(listChats(s, "alice")).toEqual([]);
    saveChat(s, "alice", newChatId(), [user("hi")], 1);
    expect(listChats(s, "bob")).toHaveLength(0);
    expect(listChats(s, "alice")).toHaveLength(1);
  });

  it("lists newest first with the first user message as title", () => {
    const s = memStorage();
    const a = newChatId();
    const b = newChatId();
    expect(a).not.toBe(b);
    saveChat(s, "alice", a, [user("What are your recent projects?"), bot("Here.")], 1000);
    saveChat(s, "alice", b, [user("How can I connect with you?")], 2000);
    const idx = listChats(s, "alice");
    expect(idx.map((c) => c.id)).toEqual([b, a]);
    expect(idx[1].title).toBe("What are your recent projects?");
    expect(chatTitle([user("x".repeat(200))]).length).toBeLessThanOrEqual(64);
    expect(chatTitle([bot("hi")]).length).toBeGreaterThan(0);
  });

  it("round-trips cards and updates in place", () => {
    const s = memStorage();
    const a = newChatId();
    const b = newChatId();
    const msgs = [user("show projects"), bot("sure", [{ tool: "projects", items: [{ title: "One" }] }])];
    saveChat(s, "alice", a, msgs, 1000);
    saveChat(s, "alice", b, [user("second")], 2000);
    expect(loadMessages(s, "alice", a)).toEqual(msgs);
    saveChat(s, "alice", a, [...msgs, bot("answer")], 3000);
    const idx = listChats(s, "alice");
    expect(idx).toHaveLength(2);
    expect(idx[0].id).toBe(a);
    expect(loadMessages(s, "alice", a)).toHaveLength(3);
  });

  it("deletes index entry and payload with no orphan keys", () => {
    const s = memStorage();
    const id = newChatId();
    saveChat(s, "alice", id, [user("bye")], 1);
    deleteChat(s, "alice", id);
    expect(listChats(s, "alice")).toHaveLength(0);
    expect(loadMessages(s, "alice", id)).toEqual([]);
    expect(s.keys().filter((k) => k.includes(id))).toEqual([]);
  });

  it("caps the index at MAX_CHATS, dropping the oldest payload", () => {
    const s = memStorage();
    const ids: string[] = [];
    for (let i = 0; i < MAX_CHATS + 3; i++) {
      const id = newChatId();
      ids.push(id);
      saveChat(s, "alice", id, [user(`q${i}`)], i + 1);
    }
    const idx = listChats(s, "alice");
    expect(idx).toHaveLength(MAX_CHATS);
    expect(idx.some((c) => c.id === ids[0])).toBe(false);
    expect(loadMessages(s, "alice", ids[0])).toEqual([]);
    expect(idx[0].id).toBe(ids[ids.length - 1]);
  });

  it("tolerates corrupt storage", () => {
    const s = memStorage();
    s.setItem("chats:alice", "{not json");
    expect(listChats(s, "alice")).toEqual([]);
    const id = newChatId();
    saveChat(s, "alice", id, [user("recovers")], 1);
    expect(listChats(s, "alice")).toHaveLength(1);
    s.setItem(`chat:alice:${id}`, "[broken");
    expect(loadMessages(s, "alice", id)).toEqual([]);
  });
});
