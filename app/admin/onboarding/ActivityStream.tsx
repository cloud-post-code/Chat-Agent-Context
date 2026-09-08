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
export function ActivityStream({ lines, progress }: { lines: string[]; progress: number }) {
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
      <div style={{ background: "var(--bg-soft)", borderRadius: 6, height: 10, overflow: "hidden" }}>
        <div style={{ width: `${Math.max(progress, 3)}%`, height: "100%", background: "var(--primary)", transition: "width .6s" }} />
      </div>
    </div>
  );
}
