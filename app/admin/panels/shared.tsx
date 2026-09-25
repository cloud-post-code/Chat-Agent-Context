import { deletePhoto } from "@/app/admin/actions/content";
import { saveChatFeedback } from "@/app/admin/actions/chat";
import { PendingButton } from "../PendingButton";
import { btnGhost, btnDanger, field } from "../ui";

export function FormDelete({ id }: { id: string }) {
  return (
    <form action={deletePhoto}>
      <input type="hidden" name="id" value={id} />
      <PendingButton pendingLabel="Deleting…" style={btnDanger as React.CSSProperties}>
        Delete
      </PendingButton>
    </form>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 14 }}>{children}</p>;
}

/** One message in a transcript: the bubble, plus feedback controls on bot answers. */
export function MessageRow({
  message,
}: {
  message: { id: string; role: string; content: string; rating: string | null; note: string | null };
}) {
  const isUser = message.role === "user";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start", gap: 4 }}>
      <div
        style={{
          maxWidth: "85%",
          background: isUser ? "var(--primary)" : "var(--bg-soft)",
          color: isUser ? "var(--on-primary)" : "var(--on-bg-soft)",
          border: isUser ? "1px solid transparent" : "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          padding: "8px 12px",
          fontSize: 13,
          whiteSpace: "pre-wrap",
        }}
      >
        {message.content}
      </div>
      {!isUser && <FeedbackControls id={message.id} rating={message.rating} note={message.note} />}
    </div>
  );
}

/**
 * Admin feedback on a bot answer. 👍/👎 buttons submit immediately; the note
 * (a correction the bot should follow next time) submits with its own Save.
 * Each is its own form so a rating click doesn't require typing a note.
 */
export function FeedbackControls({
  id,
  rating,
  note,
}: {
  id: string;
  rating: string | null;
  note: string | null;
}) {
  const pill = (active: boolean): React.CSSProperties => ({
    ...(btnGhost as React.CSSProperties),
    padding: "4px 10px",
    fontSize: 13,
    ...(active ? { borderColor: "var(--primary)", color: "var(--accent-on-bg-soft)", background: "var(--bg-soft)" } : {}),
  });
  return (
    <div style={{ maxWidth: "85%", width: "100%" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <form action={saveChatFeedback} style={{ display: "flex", gap: 6 }}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="note" value={note ?? ""} />
          {/* Icon-width buttons: an hourglass keeps the pill from resizing mid-save. */}
          <PendingButton pendingLabel="⏳" name="rating" value="up" style={pill(rating === "up")} title="Good answer">
            👍
          </PendingButton>
          <PendingButton pendingLabel="⏳" name="rating" value="down" style={pill(rating === "down")} title="Bad answer">
            👎
          </PendingButton>
        </form>
        {rating && (
          <form action={saveChatFeedback}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="rating" value="" />
            <input type="hidden" name="note" value="" />
            <PendingButton pendingLabel="Clearing…" style={{ ...(btnGhost as React.CSSProperties), padding: "4px 10px", fontSize: 12 }} title="Clear feedback">
              Clear
            </PendingButton>
          </form>
        )}
        {rating === "up" && <span style={{ fontSize: 11, color: "var(--success-on-surface)" }}>Marked good</span>}
      </div>

      {/* Correction note — steers future answers when the rating is 👎. */}
      <form action={saveChatFeedback} style={{ marginTop: 6 }}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="rating" value={rating ?? ""} />
        <textarea
          name="note"
          defaultValue={note ?? ""}
          rows={2}
          placeholder="What should it have done instead? Saved as a correction the bot follows on future chats."
          style={{ ...field, marginBottom: 6, fontSize: 12, resize: "vertical" }}
        />
        <PendingButton pendingLabel="Saving…" style={{ ...(btnGhost as React.CSSProperties), padding: "5px 12px", fontSize: 12 }}>
          Save correction
        </PendingButton>
      </form>
    </div>
  );
}

export const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
