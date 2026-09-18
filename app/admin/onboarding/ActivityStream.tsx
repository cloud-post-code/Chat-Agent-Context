"use client";

import React, { useEffect, useRef, useState } from "react";

/** Lemonade-style letter-by-letter text for assistant messages. Progress is
 *  derived from elapsed time, not tick counts, so a backgrounded tab (whose
 *  timers the browser throttles) catches up instantly instead of stalling. */
export function Typewriter({ text, speed = 14, onDone }: { text: string; speed?: number; onDone?: () => void }) {
  const [shown, setShown] = useState(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    setShown(0);
    const startedAt = Date.now();
    const t = setInterval(() => {
      const n = Math.min(text.length, Math.floor((Date.now() - startedAt) / speed));
      setShown(n);
      if (n >= text.length) clearInterval(t);
    }, speed);
    return () => clearInterval(t);
  }, [text, speed]);
  // Completion is signaled from an effect, not from inside the interval's
  // state updater — updating the parent mid-render is a React error.
  useEffect(() => {
    if (text.length > 0 && shown >= text.length) onDoneRef.current?.();
  }, [shown, text]);
  return <>{text.slice(0, shown)}</>;
}

/**
 * The live extraction feed: REAL activity lines from the job (pages being
 * read, values found, sections that don't exist), streamed in order. The
 * newest line types in; every earlier one stays dimmed above it for the whole
 * run, so the finished steps read as a transcript of what the agent did
 * rather than scrolling out of the bubble.
 */
export function ActivityStream({ lines, progress, eta }: { lines: string[]; progress: number; eta?: Eta | null }) {
  const last = lines.length - 1;
  return (
    <div aria-live="polite">
      <div style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 10, minHeight: 22 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ opacity: i === last ? 1 : 0.55 }}>
            {i === last ? <Typewriter text={l} /> : l}
          </div>
        ))}
      </div>
      {eta && <Countdown eta={eta} />}
      <div style={{ background: "var(--bg-soft)", borderRadius: 6, height: 10, overflow: "hidden" }}>
        <div style={{ width: `${Math.max(progress, 3)}%`, height: "100%", background: "var(--primary)", transition: "width .6s" }} />
      </div>
    </div>
  );
}

/** Seconds the run had left when the last status poll landed, and the client
 *  clock at that moment — the countdown runs from these between polls. */
export type Eta = { remainingSeconds: number; receivedAt: number };

/** "3:05 left" / "0:40 left"; past the estimate it says so instead of counting negative. */
export function formatRemaining(seconds: number): string {
  if (seconds <= 0) return "Taking a little longer than estimated — still working";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `About ${m}:${String(s).padStart(2, "0")} left`;
}

/** Seconds left right now, from the last poll's figure and the clock since. */
export function remainingNow(eta: Eta, now = Date.now()): number {
  return Math.max(0, eta.remainingSeconds - Math.floor((now - eta.receivedAt) / 1000));
}

/**
 * The live "how long until it's done" line. Derived from elapsed wall-clock
 * time like Typewriter, so a backgrounded tab shows the true remainder when
 * it comes back, and re-anchored by every poll so the number stays honest to
 * the server's estimate rather than drifting on its own.
 */
function Countdown({ eta }: { eta: Eta }) {
  const [left, setLeft] = useState(() => remainingNow(eta));
  useEffect(() => {
    setLeft(remainingNow(eta));
    const t = setInterval(() => setLeft(remainingNow(eta)), 1000);
    return () => clearInterval(t);
  }, [eta]);
  return (
    <div data-countdown style={{ fontSize: 13, marginBottom: 8, fontVariantNumeric: "tabular-nums" }}>
      {formatRemaining(left)}
    </div>
  );
}
