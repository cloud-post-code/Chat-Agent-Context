"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Cards } from "@/app/cards/Cards";
import { parseSampleBlock } from "@/lib/uiCards";
import type { BuildEvent, CardDraft } from "@/lib/cardBuilder";
import type { PromptImage } from "@/lib/imageGen";
import { saveBuiltCard } from "./actions";
import { panel, field, btn, btnGhost, SectionTitle, Label } from "./ui";

/**
 * The card builder page's flow: describe the card in plain text, Claude drafts
 * the whole thing (name, tool, purpose, sample), the draft renders as a live
 * preview, and a feedback box revises it until it's right. Nothing touches the
 * database until "Save card".
 *
 * Editing an existing card enters the same loop with the stored card as the
 * current draft, so "make the blurbs funnier" works on day-old cards too.
 */
export function CardBuilder({
  id,
  cardKey,
  initial,
  slug = "",
}: {
  /** Set when editing an existing card; absent on /admin/cards/new. */
  id?: string;
  cardKey?: string;
  initial?: CardDraft;
  /** The owner's agent slug, so live preview cards (contact form) post home. */
  slug?: string;
}) {
  const router = useRouter();
  const [instructions, setInstructions] = useState("");
  const [draft, setDraft] = useState<CardDraft | null>(initial ?? null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<"draft" | "revise" | "save" | null>(null);
  const [error, setError] = useState("");
  const [thinking, setThinking] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  // Images attached to the prompt. Uploaded on choose, so a revise turn resends
  // only these small descriptors rather than the file itself.
  const [attachments, setAttachments] = useState<PromptImage[]>([]);
  const [uploading, setUploading] = useState(false);

  async function attach(files: FileList | null) {
    if (!files?.length || uploading) return;
    setUploading(true);
    setError("");
    for (const file of Array.from(files).slice(0, 4 - attachments.length)) {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/admin/build-card/image", { method: "POST", body: form });
      if (!res.ok) {
        setError((await res.text().catch(() => "")) || "That image couldn't be uploaded.");
        continue;
      }
      const { src } = (await res.json()) as { src: string };
      // "auto" by default: most attachments are self-evident from the prompt,
      // and the admin can pin the intent when they care.
      setAttachments((a) => [...a, { src, intent: "auto" }]);
    }
    setUploading(false);
  }

  /**
   * Run one build over the streaming route, feeding reasoning and searches
   * into the page as they arrive. Resolves to the finished draft, or null if
   * the build failed (the error is already on screen by then).
   */
  async function build(payload: {
    instructions: string;
    current?: CardDraft;
    feedback?: string;
    attachments?: PromptImage[];
  }): Promise<CardDraft | null> {
    setError("");
    setThinking("");
    setSteps([]);
    let built: CardDraft | null = null;

    const res = await fetch("/api/admin/build-card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok || !res.body) {
      setError(await res.text().catch(() => "") || "The builder couldn't be reached.");
      return null;
    }

    // One JSON object per line; a chunk can split a line, so hold the partial.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let e: BuildEvent;
        try {
          e = JSON.parse(line) as BuildEvent;
        } catch {
          continue;
        }
        if (e.t === "thinking") setThinking((t) => t + e.v);
        else if (e.t === "search") setSteps((s) => [...s, `Searching: “${e.query}”`]);
        else if (e.t === "searched") {
          setSteps((s) => [
            ...s,
            e.hits ? `Found ${e.hits} excerpt${e.hits === 1 ? "" : "s"}` : "Nothing matched",
          ]);
        } else if (e.t === "image") {
          // Generated artwork costs real money, so the step log names what was
          // drawn rather than a bare "image created".
          setSteps((s) => [...s, `Created an image: “${e.prompt}”`]);
        } else if (e.t === "status") setSteps((s) => [...s, e.v]);
        else if (e.t === "draft") built = e.draft;
        else if (e.t === "error") setError(e.v);
      }
    }
    return built;
  }

  async function generate() {
    if (busy) return;
    setBusy("draft");
    const built = await build({ instructions, attachments });
    if (built) setDraft(built);
    setBusy(null);
  }

  async function revise() {
    if (busy || !draft) return;
    setBusy("revise");
    const built = await build({
      // Editing an existing card starts with no typed description; the draft
      // itself carries the context, so a stand-in instruction is enough.
      instructions: instructions.trim() || `Refine this existing card: ${draft.label}`,
      current: draft,
      feedback,
      // Attachments carry into revisions: "put the photo top-left instead"
      // needs the photo still attached to mean anything.
      attachments,
    });
    if (built) {
      setDraft(built);
      setFeedback("");
    }
    setBusy(null);
  }

  async function save() {
    if (busy || !draft) return;
    setBusy("save");
    setError("");
    const res = await saveBuiltCard({ id, key: cardKey, draft });
    if (res.ok) {
      // refresh() alongside push(): the dashboard may sit in the client router
      // cache from before the save, and the new card must be in the list the
      // admin lands on.
      router.push("/admin/dashboard?tab=a2ui");
      router.refresh();
      return;
    }
    setError(res.error ?? "Saving failed.");
    setBusy(null);
  }

  // Keep the newest reasoning in view as it streams, without yanking the page
  // around once the build is done and the admin may be reading back.
  const thinkingRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (busy && thinkingRef.current) {
      thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
    }
  }, [thinking, busy]);

  const block = draft ? parseSampleBlock(draft.sampleBlock) : null;

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "24px 20px 80px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 26 }}>{id ? "Refine a card" : "Build a card"}</h1>
          <p style={{ color: "var(--text)", fontStyle: "italic", fontSize: 14 }}>
            Describe it — the card designs itself, then takes your feedback.
          </p>
        </div>
        <Link href="/admin/dashboard?tab=a2ui" style={btnGhost as React.CSSProperties}>
          ← Back to cards
        </Link>
      </header>

      {!id && (
        <section data-fill="surface" style={panel}>
          <SectionTitle>What should this card be?</SectionTitle>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={3}
            placeholder="e.g. A card that shows off my photography as a slideshow visitors can flip through"
            style={{ ...field, resize: "vertical" }}
          />
          <AttachedImages
            attachments={attachments}
            uploading={uploading}
            disabled={!!busy}
            onAttach={attach}
            onIntent={(src, intent) =>
              setAttachments((a) => a.map((x) => (x.src === src ? { ...x, intent } : x)))
            }
            onRemove={(src) => setAttachments((a) => a.filter((x) => x.src !== src))}
          />
          <button
            onClick={generate}
            disabled={!!busy || !instructions.trim()}
            style={{ ...(btn as React.CSSProperties), opacity: busy || !instructions.trim() ? 0.55 : 1 }}
          >
            {busy === "draft" ? "Designing…" : draft ? "Start over from this description" : "Design the card"}
          </button>
        </section>
      )}

      {(thinking || steps.length > 0) && (
        <section data-fill="surface" style={panel}>
          <SectionTitle>{busy ? "Thinking…" : "How it built this"}</SectionTitle>
          {steps.length > 0 && (
            <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
              {steps.map((s, i) => (
                <li key={i} style={{ fontSize: 12, color: "var(--accent-on-surface)", lineHeight: 1.6 }}>
                  {s}
                </li>
              ))}
            </ul>
          )}
          {thinking && (
            <pre ref={thinkingRef} style={thinkingBox}>
              {thinking}
            </pre>
          )}
        </section>
      )}

      {error && (
        <p style={{ color: "var(--danger-on-surface)", fontSize: 13, margin: "0 0 14px" }}>{error}</p>
      )}

      {draft && (
        <>
          <section data-fill="surface" style={panel}>
            <SectionTitle>{draft.label}</SectionTitle>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", marginBottom: 6 }}>
              <code style={toolName}>{draft.tool}</code>
              <span style={{ fontSize: 13, color: "var(--on-surface)" }}>{draft.description}</span>
            </div>
            <div style={{ marginBottom: 12 }}>
              <Label>When the chatbot will show it</Label>
              <p style={{ fontSize: 13, color: "var(--on-surface)", lineHeight: 1.55, margin: 0 }}>
                {draft.reason || "(no guidance written)"}
              </p>
              {draft.note && (
                <p style={{ fontSize: 12, fontStyle: "italic", color: "var(--accent-on-surface)", margin: "6px 0 0" }}>
                  {draft.note}
                </p>
              )}
            </div>
            <Label>
              {draft.tool === "show_card"
                ? "Preview — a custom card shows exactly this content to visitors"
                : "Preview (sample content — the live card uses your real data)"}
            </Label>
            {block ? (
              <Cards block={block} slug={slug} />
            ) : (
              <p style={{ fontSize: 13, fontStyle: "italic", color: "var(--danger-on-surface)" }}>
                This draft&apos;s sample can&apos;t be rendered — ask for a revision below.
              </p>
            )}
          </section>

          <section data-fill="surface" style={panel}>
            <SectionTitle>Feedback</SectionTitle>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={2}
              placeholder="e.g. Make it a filmstrip instead, and only show it when someone asks about travel"
              style={{ ...field, resize: "vertical" }}
            />
            {/* Also here, so a photo can be added while iterating — including on
                an existing card, where the description box isn't shown at all. */}
            <AttachedImages
              attachments={attachments}
              uploading={uploading}
              disabled={!!busy}
              onAttach={attach}
              onIntent={(src, intent) =>
                setAttachments((a) => a.map((x) => (x.src === src ? { ...x, intent } : x)))
              }
              onRemove={(src) => setAttachments((a) => a.filter((x) => x.src !== src))}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={revise}
                disabled={!!busy || !feedback.trim()}
                style={{ ...(btnGhost as React.CSSProperties), opacity: busy || !feedback.trim() ? 0.55 : 1 }}
              >
                {busy === "revise" ? "Revising…" : "Revise the card"}
              </button>
              <button
                onClick={save}
                disabled={!!busy}
                style={{ ...(btn as React.CSSProperties), opacity: busy ? 0.55 : 1 }}
              >
                {busy === "save" ? "Saving…" : id ? "Save changes" : "Save card"}
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

const thinkingBox: React.CSSProperties = {
  margin: 0,
  maxHeight: 240,
  overflowY: "auto",
  padding: 12,
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--bg-soft)",
  color: "var(--on-bg-soft)",
  fontSize: 12,
  lineHeight: 1.6,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  opacity: 0.85,
};

const toolName: React.CSSProperties = {
  fontSize: 12,
  padding: "3px 8px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--bg-soft)",
  color: "var(--on-bg-soft)",
};

/** What each intent means, in the admin's language rather than the model's. */
const INTENT_LABELS: { value: PromptImage["intent"]; label: string; hint: string }[] = [
  { value: "auto", label: "Let it decide", hint: "Reads your description to choose" },
  { value: "use", label: "Put it in the card", hint: "Embedded and designed around" },
  { value: "reference", label: "Reference only", hint: "Style direction, not shown" },
];

/**
 * Attach images to the prompt. Each one is uploaded the moment it's chosen (so
 * revisions resend only a src, not the file) and carries its own intent,
 * because "put this in the card" and "copy this layout" are opposite
 * instructions that the model cannot reliably tell apart on its own.
 */
function AttachedImages({
  attachments,
  uploading,
  disabled,
  onAttach,
  onIntent,
  onRemove,
}: {
  attachments: PromptImage[];
  uploading: boolean;
  disabled: boolean;
  onAttach: (files: FileList | null) => void;
  onIntent: (src: string, intent: PromptImage["intent"]) => void;
  onRemove: (src: string) => void;
}) {
  const full = attachments.length >= 4;
  return (
    <div style={{ margin: "10px 0 12px" }}>
      <Label>
        Images (optional) — attach a photo to put in the card, or a screenshot to design from
      </Label>

      {attachments.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "8px 0" }}>
          {attachments.map((a) => (
            <div
              key={a.src}
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                padding: 8,
                background: "var(--bg-soft)",
                width: 168,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.src}
                alt=""
                style={{
                  width: "100%",
                  height: 92,
                  objectFit: "cover",
                  borderRadius: "var(--radius-sm)",
                  display: "block",
                }}
              />
              <select
                value={a.intent}
                disabled={disabled}
                onChange={(e) => onIntent(a.src, e.target.value as PromptImage["intent"])}
                style={{ ...field, fontSize: 11, padding: "4px 6px", margin: "8px 0 4px" }}
              >
                {INTENT_LABELS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <div
                style={{
                  fontSize: 10,
                  fontStyle: "italic",
                  color: "var(--on-bg-soft)",
                  opacity: 0.8,
                  lineHeight: 1.4,
                }}
              >
                {INTENT_LABELS.find((o) => o.value === a.intent)?.hint}
              </div>
              <button
                type="button"
                onClick={() => onRemove(a.src)}
                disabled={disabled}
                style={{ ...(btnGhost as React.CSSProperties), fontSize: 11, padding: "3px 8px", marginTop: 6 }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {!full && (
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={disabled || uploading}
          onChange={(e) => {
            onAttach(e.target.files);
            // Clear the input so re-choosing the same file still fires onChange.
            e.target.value = "";
          }}
          style={{ fontSize: 12, color: "var(--on-surface)" }}
        />
      )}
      {uploading && (
        <span style={{ fontSize: 12, fontStyle: "italic", color: "var(--accent-on-surface)" }}>
          Uploading…
        </span>
      )}
      {full && (
        <span style={{ fontSize: 12, fontStyle: "italic", color: "var(--on-surface)", opacity: 0.8 }}>
          Four images is the limit for one prompt.
        </span>
      )}
    </div>
  );
}
