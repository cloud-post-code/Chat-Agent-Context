"use client";

import { useEffect, useRef, useState } from "react";
import { btn, btnGhost, panel } from "../ui";
import { card as a2uiCard, cf as a2uiField } from "@/app/cards/styles";
import { BookingFlowCard } from "@/app/cards/booking/BookingFlowCard";
import { diffSteps, type BookingFormSummary, type FormStep } from "@/lib/booking/steps";

/**
 * The onboarding chat's booking-form step — the user's side of it. Three
 * things in one card: the steps the form asks, in the order a customer meets
 * them; the real booking card in preview mode, to try like a customer would
 * (live availability, the real quote, nothing booked); and a text chat to say
 * what is missing or wrong. Each message is applied for real
 * (/api/admin/onboarding/booking-form → lib/onboarding/bookingFormChat.ts) and
 * the form is read back and shown again, with what changed marked.
 */

export type FormRound = { user: string; reply: string; changes: string[] };

type Marks = { added: Set<string>; changed: Set<string>; removed: string[] };

const NO_MARKS: Marks = { added: new Set(), changed: new Set(), removed: [] };

export function BookingFormStep({
  onDone,
  doneLabel = "Done — the form is right",
  busy = false,
}: {
  /** Called with the one-line summary the step collapses into. */
  onDone: (summary: string, rounds: FormRound[]) => void;
  doneLabel?: string;
  busy?: boolean;
}) {
  const [form, setForm] = useState<BookingFormSummary | null>(null);
  const [loadError, setLoadError] = useState("");
  const [rounds, setRounds] = useState<FormRound[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [trying, setTrying] = useState(false);
  // Bumped on every change so the preview card remounts on the new form.
  const [version, setVersion] = useState(0);
  const [marks, setMarks] = useState<Marks>(NO_MARKS);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/onboarding/booking-form")
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return (await res.json()) as { form: BookingFormSummary };
      })
      .then((data) => {
        if (!cancelled) setForm(data.form);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Couldn't load the form.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Swap in a re-read form, marking what moved. */
  function adopt(next: BookingFormSummary) {
    const d = form ? diffSteps(form.steps, next.steps) : { added: [], changed: [], removed: [] };
    const gone = (form?.steps ?? []).filter((s) => d.removed.includes(s.id)).map((s) => s.title);
    setMarks({ added: new Set(d.added), changed: new Set(d.changed), removed: gone });
    setForm(next);
    setVersion((v) => v + 1);
  }

  async function send() {
    const message = draft.trim();
    if (!message || sending || !form) return;
    setSending(true);
    setDraft("");
    const history = rounds.flatMap((r) => [
      { role: "user", content: r.user },
      { role: "assistant", content: r.reply },
    ]);
    try {
      const res = await fetch("/api/admin/onboarding/booking-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { reply: string; changes: string[]; form: BookingFormSummary };
      setRounds((r) => [...r, { user: message, reply: data.reply, changes: data.changes }]);
      if (data.changes.length) {
        adopt(data.form);
        // The card is worth re-trying once something changed.
        setTrying(true);
      }
    } catch (e) {
      setRounds((r) => [
        ...r,
        { user: message, reply: `Couldn't apply that — ${e instanceof Error ? e.message : "try again"}.`, changes: [] },
      ]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function enable() {
    setSending(true);
    try {
      const res = await fetch("/api/admin/onboarding/booking-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enable" }),
      });
      if (res.ok) adopt(((await res.json()) as { form: BookingFormSummary }).form);
    } finally {
      setSending(false);
    }
  }

  if (loadError) return <p style={{ color: "var(--danger, #f66)", margin: 0 }}>{loadError}</p>;
  if (!form) return <p style={{ margin: 0, fontStyle: "italic", opacity: 0.75 }}>Loading your booking form…</p>;

  const changesMade = rounds.reduce((n, r) => n + r.changes.length, 0);
  const summary = form.enabled
    ? `Booking form: ${form.steps.length} step${form.steps.length === 1 ? "" : "s"}${changesMade ? `, ${changesMade} change${changesMade === 1 ? "" : "s"} made` : ", kept as built"}.`
    : "Booking left off.";

  return (
    <div>
      {!form.enabled ? (
        <div style={{ marginBottom: 14 }}>
          <p style={{ margin: "0 0 10px", fontSize: 14 }}>
            Booking is turned off for your page, so visitors can&apos;t book from the chat. Turn it
            on to build the form here, or leave it off and carry on.
          </p>
          <button style={btn} onClick={enable} disabled={sending || busy}>
            {sending ? "Turning on…" : "Turn booking on"}
          </button>
        </div>
      ) : (
        <>
          <StepList steps={form.steps} marks={marks} />

          {/* Try it: the real card, remounted on every change. */}
          <div style={{ margin: "14px 0" }}>
            {trying ? (
              <div ref={cardRef}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <strong style={{ fontSize: 14, fontFamily: "var(--font-heading)" }}>
                    Try it — this is what a customer sees
                  </strong>
                  <button style={btnGhost} onClick={() => setTrying(false)}>Hide</button>
                </div>
                <BookingFlowCard
                  key={version}
                  slug={form.slug}
                  fields={form.fields}
                  flow={form.flow}
                  preview
                />
              </div>
            ) : (
              <button style={btnGhost} onClick={() => setTrying(true)}>
                Try the form
              </button>
            )}
          </div>

          {/* The chat: what's missing, what to change. */}
          <div style={{ ...a2uiCard, background: "transparent", color: "inherit", padding: 12 }}>
            <strong style={{ fontSize: 14, fontFamily: "var(--font-heading)" }}>
              What&apos;s missing or wrong?
            </strong>
            <p style={{ fontSize: 13, margin: "4px 0 10px", opacity: 0.75 }}>
              Say it in plain words — I&apos;ll change the form and show it to you again.
            </p>
            {rounds.map((r, i) => (
              <div key={i} className="onboard-phase-in" style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div style={{ ...panel, padding: "8px 12px", maxWidth: "85%", margin: "0 0 6px", background: "var(--primary)", color: "var(--on-primary, #fff)", border: "none", fontSize: 14 }}>
                    {r.user}
                  </div>
                </div>
                <div style={{ ...panel, padding: "8px 12px", maxWidth: "85%", margin: 0, fontSize: 14 }}>
                  <div>{r.reply}</div>
                  {r.changes.length > 0 && (
                    <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13, opacity: 0.85 }}>
                      {r.changes.map((c, j) => <li key={j}>{c}</li>)}
                    </ul>
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <p style={{ fontSize: 13, fontStyle: "italic", opacity: 0.75, margin: "0 0 8px" }}>
                Changing the form…
              </p>
            )}
            <textarea
              ref={inputRef}
              style={{ ...a2uiField, resize: "vertical", marginBottom: 8 }}
              rows={2}
              value={draft}
              disabled={sending || busy}
              placeholder="e.g. Ask how many guests are coming. Make the phone number optional. Add a $20 beard trim."
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button style={btn} onClick={send} disabled={sending || busy || !draft.trim()}>
              {sending ? "Applying…" : "Change the form"}
            </button>
          </div>
        </>
      )}

      <div style={{ marginTop: 14 }}>
        <button style={btn} onClick={() => onDone(summary, rounds)} disabled={busy || sending}>
          {busy ? "Saving…" : form.enabled ? doneLabel : "Continue without booking"}
        </button>
      </div>
    </div>
  );
}

const KIND_NOTE: Partial<Record<FormStep["kind"], string>> = {
  options: "sometimes",
  question: "question",
};

function StepList({ steps, marks }: { steps: FormStep[]; marks: Marks }) {
  return (
    <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
      {steps.map((s, i) => {
        const mark = marks.added.has(s.id) ? "new" : marks.changed.has(s.id) ? "changed" : "";
        return (
          <li
            key={s.id}
            className={mark ? "onboard-phase-in" : undefined}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              padding: "7px 10px",
              marginBottom: 6,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: mark ? "var(--surface)" : "transparent",
            }}
          >
            <span
              style={{
                flex: "0 0 24px", height: 24, borderRadius: 999, fontSize: 12, lineHeight: "24px",
                textAlign: "center", background: "var(--primary)", color: "var(--on-primary, #fff)",
              }}
            >
              {i + 1}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{s.title}</span>
              {mark && (
                <span
                  style={{
                    marginLeft: 8, fontSize: 11, padding: "1px 7px", borderRadius: 999,
                    border: "1px solid var(--border)", fontStyle: "italic",
                  }}
                >
                  {mark}
                </span>
              )}
              {KIND_NOTE[s.kind] && !mark && (
                <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.6, fontStyle: "italic" }}>{KIND_NOTE[s.kind]}</span>
              )}
              <span style={{ display: "block", fontSize: 13, opacity: 0.75 }}>{s.detail}</span>
            </span>
          </li>
        );
      })}
      {marks.removed.length > 0 && (
        <li style={{ fontSize: 13, fontStyle: "italic", opacity: 0.7, padding: "4px 10px" }}>
          Removed: {marks.removed.join(", ")}
        </li>
      )}
    </ol>
  );
}
