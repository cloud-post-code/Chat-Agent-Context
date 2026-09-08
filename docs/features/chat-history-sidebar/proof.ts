/**
 * Proof — chat history sidebar store (docs/features/chat-history-sidebar).
 * Offline: exercises lib/chatStore.ts against an in-memory Storage stub.
 * Run: npx tsx docs/features/chat-history-sidebar/proof.ts
 */
import { readFileSync } from "node:fs";
import {
  listChats,
  loadMessages,
  saveChat,
  deleteChat,
  newChatId,
  chatTitle,
  MAX_CHATS,
  type StoredMsg,
} from "../../../lib/chatStore";

let passed = 0;
let failed = 0;
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Minimal in-memory Storage-like stub. */
function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    _map: m,
  };
}

const userMsg = (content: string): StoredMsg => ({ role: "user", content });
const botMsg = (content: string, cards?: unknown[]): StoredMsg => ({
  role: "assistant",
  content,
  ...(cards ? { cards: cards as StoredMsg["cards"] } : {}),
});

// 1. Empty start
{
  const s = memStorage();
  assert("empty index lists []", Array.isArray(listChats(s, "alice")) && listChats(s, "alice").length === 0);
}

// 2. Save & list, title derivation, ordering
{
  const s = memStorage();
  const a = newChatId();
  const b = newChatId();
  assert("newChatId is unique + non-empty", !!a && !!b && a !== b);
  saveChat(s, "alice", a, [userMsg("What are your recent projects?"), botMsg("Here.")], 1000);
  saveChat(s, "alice", b, [userMsg("How can I connect with you?")], 2000);
  const idx = listChats(s, "alice");
  assert("two chats listed", idx.length === 2);
  assert("newest first", idx[0]?.id === b && idx[1]?.id === a, JSON.stringify(idx));
  assert(
    "title = first user message",
    idx[1]?.title === "What are your recent projects?",
    idx[1]?.title,
  );
  const long = "x".repeat(200);
  assert("chatTitle truncates long questions", chatTitle([userMsg(long)]).length <= 64);
  assert("chatTitle falls back when no user msg", chatTitle([botMsg("hi")]).length > 0);
}

// 3. Per-slug scoping
{
  const s = memStorage();
  saveChat(s, "alice", newChatId(), [userMsg("hi")], 1);
  assert("slug scoping", listChats(s, "bob").length === 0 && listChats(s, "alice").length === 1);
}

// 4. Round trip with cards
{
  const s = memStorage();
  const id = newChatId();
  const msgs = [
    userMsg("show projects"),
    botMsg("sure", [{ tool: "projects", items: [{ title: "One", tags: ["a"] }] }]),
  ];
  saveChat(s, "alice", id, msgs, 5);
  assert("round trip deep-equal incl. cards", JSON.stringify(loadMessages(s, "alice", id)) === JSON.stringify(msgs));
}

// 5. Update in place
{
  const s = memStorage();
  const a = newChatId();
  const b = newChatId();
  saveChat(s, "alice", a, [userMsg("first")], 1000);
  saveChat(s, "alice", b, [userMsg("second")], 2000);
  saveChat(s, "alice", a, [userMsg("first"), botMsg("answer")], 3000);
  const idx = listChats(s, "alice");
  assert("no duplicate on re-save", idx.length === 2);
  assert("re-saved chat bumped to top", idx[0]?.id === a);
  assert("messages updated", loadMessages(s, "alice", a).length === 2);
}

// 6. Delete
{
  const s = memStorage();
  const id = newChatId();
  saveChat(s, "alice", id, [userMsg("bye")], 1);
  deleteChat(s, "alice", id);
  assert("delete removes index entry", listChats(s, "alice").length === 0);
  assert("delete removes payload", loadMessages(s, "alice", id).length === 0);
  const keys = [...s._map.keys()].filter((k) => k.includes(id));
  assert("no orphan keys after delete", keys.length === 0, keys.join(","));
}

// 7. Cap enforcement
{
  const s = memStorage();
  const ids: string[] = [];
  for (let i = 0; i < MAX_CHATS + 3; i++) {
    const id = newChatId();
    ids.push(id);
    saveChat(s, "alice", id, [userMsg(`q${i}`)], i + 1);
  }
  const idx = listChats(s, "alice");
  assert("index capped", idx.length === MAX_CHATS, String(idx.length));
  assert("oldest dropped from index", !idx.some((c) => c.id === ids[0]));
  assert("oldest payload dropped", loadMessages(s, "alice", ids[0]).length === 0);
  assert("newest kept", idx[0]?.id === ids[ids.length - 1]);
}

// 8. Corruption tolerance
{
  const s = memStorage();
  s.setItem("chats:alice", "{not json");
  assert("garbage index -> []", listChats(s, "alice").length === 0);
  const id = newChatId();
  saveChat(s, "alice", id, [userMsg("recovers")], 1);
  assert("save recovers from garbage index", listChats(s, "alice").length === 1);
  s.setItem(`chat:alice:${id}`, "[broken");
  assert("garbage payload -> []", loadMessages(s, "alice", id).length === 0);
}

// 9. Wiring: Chat.tsx uses the store
{
  const src = readFileSync(new URL("../../../app/Chat.tsx", import.meta.url), "utf8");
  assert("Chat.tsx imports lib/chatStore", /from\s+["']@?\/?(\.\.\/)?lib\/chatStore["']/.test(src) || src.includes("@/lib/chatStore"));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
