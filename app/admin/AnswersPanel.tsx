import { cannedStats } from "@/lib/canned";
import { CHIP_COUNT, CHIP_WORDS, deriveLabel } from "@/lib/chipLabel";
import { saveCanned, deleteCanned, redraftCanned, regenerateCanned } from "./actions";
import { CardFields } from "./CardFields";
import { PendingButton } from "./PendingButton";
import { panel, field, btn, btnGhost, btnDanger, SectionTitle, Label } from "./ui";

/**
 * The "Presets" sub-tab of the Agent Behavior section: replies to the
 * questions visitors ask over and over,
 * served straight from the database with no model call.
 *
 * A row nobody has written yet arrives as an AI draft, written from the same
 * knowledge the chatbot would have used — so the tab opens on a review queue
 * rather than a blank to-do list. A draft is already live; saving it is Blake
 * putting his name to it, and Redraft asks for a new one.
 *
 * Every live row is in the pool the page's starter tabs are picked from: a
 * chat shows CHIP_COUNT of them, one per goal first, and the next chat shows
 * a different CHIP_COUNT (lib/starterPick.ts). The Goal field is what that
 * pick groups by.
 */

type Row = {
  id: string;
  question: string;
  label: string;
  goal: string;
  answer: string;
  cardTool: string | null;
  cardInput: string | null;
  enabled: boolean;
  hits: number;
  order: number;
  aiDraft: boolean;
};

export function AnswersPanel({ rows, goals = [] }: { rows: Row[]; goals?: string[] }) {
  const stats = cannedStats(rows);
  const live = rows.filter((r) => r.enabled).length;

  return (
    <div>
      <div style={panel}>
        <SectionTitle>Preset Answers</SectionTitle>
        <p style={{ fontSize: 13, marginBottom: 12, lineHeight: 1.55 }}>
          When a visitor&apos;s question matches one of these, they get the stored
          words instantly and the model is never called. Matching ignores case,
          spacing and a trailing question mark — anything else goes to the chatbot.
        </p>
        <p style={{ fontSize: 13, marginBottom: 12, lineHeight: 1.55 }}>
          Blank rows are drafted for you from your knowledge base the next time
          this tab loads, and go live as soon as they&apos;re written. Edit one and
          hit Save to make it yours; hit Redraft to throw it away and ask again.
        </p>
        <p style={{ fontSize: 13, marginBottom: 12, lineHeight: 1.55 }} data-starter-pool={live}>
          Every live question is in the pool for the tabs on your page&apos;s home
          screen. Each new chat shows {CHIP_COUNT} of them, so different chats open on
          different questions — one for each of your goals first, then the general
          ones. Each tab shows its short label ({CHIP_WORDS} words at most); tapping
          it asks the full question.
        </p>
        <div
          style={{
            display: "flex",
            gap: 18,
            fontSize: 13,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span><strong>{stats.live}</strong> live</span>
          <span><strong>{stats.unreviewed}</strong> awaiting your review</span>
          <span><strong>{stats.unanswered}</strong> still unanswered</span>
          <span><strong>{stats.callsSaved}</strong> model calls saved</span>
          <form action={regenerateCanned} style={{ marginLeft: "auto" }}>
            <PendingButton
              pendingLabel="Regenerating…"
              style={btnGhost}
              title="Rewrite the question list for your business. Answers you saved as yours are kept; drafts and blank rows are replaced."
            >
              Regenerate questions
            </PendingButton>
          </form>
        </div>
      </div>

      {rows.map((r) => (
        <AnswerForm key={r.id} row={r} goals={goals} />
      ))}

      <AnswerForm goals={goals} />
    </div>
  );
}

/** `goals` are the account's live goals, the choices the Goal field offers. */
function AnswerForm({ row, goals }: { row?: Row; goals: string[] }) {
  const isNew = !row;
  const draft = !!row?.aiDraft && !!row.answer.trim();
  const goal = row?.goal ?? "";
  // A row's goal stays selectable even after the goal itself was reworded or
  // deleted, so saving the row never silently drops it.
  const choices = goal && !goals.includes(goal) ? [...goals, goal] : goals;

  return (
    <form action={saveCanned} style={panel}>
      {row ? <input type="hidden" name="id" value={row.id} /> : null}
      <input type="hidden" name="order" value={row?.order ?? 99} />

      <Label>{isNew ? "New question" : "Question"}</Label>
      <input
        name="question"
        defaultValue={row?.question ?? ""}
        placeholder="What do visitors ask?"
        style={field}
      />

      <Label>Tab label</Label>
      <input
        name="label"
        defaultValue={row?.label ?? ""}
        // Left blank, the tab says what the placeholder shows.
        placeholder={row ? deriveLabel(row.question) : `${CHIP_WORDS} words at most`}
        maxLength={40}
        style={field}
      />

      <Label>Goal — each chat takes one question per goal before any general one</Label>
      <select name="goal" defaultValue={goal} style={field}>
        <option value="">General — no particular goal</option>
        {choices.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>

      <Label>
        Answer
        {draft ? " — AI draft, live but not reviewed by you yet" : ""}
        {!isNew && !draft && !row.answer.trim() ? " — not written yet" : ""}
      </Label>
      <textarea
        name="answer"
        rows={4}
        defaultValue={row?.answer ?? ""}
        placeholder="Leave this blank and it gets drafted for you on the next load."
        style={{
          ...field,
          resize: "vertical",
          fontFamily: "inherit",
          // A draft is somebody else's words in Blake's voice; the field says so
          // at a glance instead of making him read the label to find out.
          borderColor: draft ? "var(--accent)" : undefined,
        }}
      />

      <CardFields savedTool={row?.cardTool ?? ""} savedInput={row?.cardInput ?? ""} />

      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" name="enabled" defaultChecked={row?.enabled ?? true} />
          Live
        </label>
        <PendingButton pendingLabel={isNew ? "Adding…" : "Saving…"} style={btn}>
          {isNew ? "Add" : draft ? "Save as mine" : "Save"}
        </PendingButton>
        {row ? (
          <>
            <PendingButton pendingLabel="Redrafting…" formAction={redraftCanned} style={btnGhost}>
              Redraft
            </PendingButton>
            <PendingButton pendingLabel="Deleting…" formAction={deleteCanned} style={btnDanger}>
              Delete
            </PendingButton>
            <span style={{ fontSize: 12, fontStyle: "italic", marginLeft: "auto" }}>
              served {row.hits}×
            </span>
          </>
        ) : null}
      </div>
    </form>
  );
}
