"use client";

import { useEffect, useRef, useState } from "react";
import { CARD_TOOLS } from "@/lib/canned.tools";
import { field, Label } from "./ui";

/**
 * The card half of one Answers row.
 *
 * React resets an uncontrolled form once its action resolves, and a reset
 * restores a `<select>` from the `selected` attribute in the HTML — which a
 * client re-render never writes. So a card Blake picked and saved came back as
 * "No card" on the very next paint, and saving again wrote that emptiness to
 * the database. Holding the pair in state keeps what Blake chose on screen; the
 * `saved` props are the row as stored, so a save (or another row's save) resyncs
 * the fields to the database rather than to whatever was typed.
 */
export function CardFields({
  savedTool,
  savedInput,
}: {
  savedTool: string;
  savedInput: string;
}) {
  const [tool, setTool] = useState(savedTool);
  const [input, setInput] = useState(savedInput);
  const [saved, setSaved] = useState({ tool: savedTool, input: savedInput });
  const select = useRef<HTMLSelectElement>(null);

  // Adjusting state while rendering, the React-documented way to follow a prop
  // that changed: a save re-renders this row with the stored values, and only
  // then do the fields snap to them.
  if (saved.tool !== savedTool || saved.input !== savedInput) {
    setSaved({ tool: savedTool, input: savedInput });
    setTool(savedTool);
    setInput(savedInput);
  }

  // A reset restores a `<select>` from whichever `<option>` carries the
  // `selected` attribute, and React writes that attribute only when the markup
  // came from the server. `defaultSelected` is that attribute, so keeping it on
  // the chosen option is what makes a reset restore the card rather than clear
  // it — including the save that changes nothing and re-renders nothing.
  useEffect(() => {
    for (const option of select.current?.options ?? []) {
      option.defaultSelected = option.value === tool;
    }
  }, [tool]);

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div style={{ flex: "1 1 200px" }}>
        <Label>Show a card</Label>
        <select
          ref={select}
          name="cardTool"
          value={tool}
          onChange={(e) => setTool(e.target.value)}
          style={field}
        >
          <option value="">No card</option>
          {CARD_TOOLS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div style={{ flex: "1 1 200px" }}>
        <Label>Card options (JSON)</Label>
        <input
          name="cardInput"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='{"layout":"filmstrip"}'
          style={field}
        />
      </div>
    </div>
  );
}
