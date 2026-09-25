import { addSource } from "@/app/admin/actions/content";
import { PendingButton } from "./PendingButton";
import { field, btn } from "./ui";

/**
 * The ingest form for one kind of knowledge. The kind is fixed by the caller —
 * each Knowledge tab (Links / PDFs / Text) renders the one form it owns, so
 * there is no mode switcher here.
 */
export function Extractor({ mode }: { mode: "link" | "pdf" | "text" }) {
  if (mode === "link") {
    return (
      <form action={addSource} style={{ display: "flex", gap: 8 }}>
        <input type="hidden" name="type" value="link" />
        <input
          name="url"
          placeholder="https://…  (LinkedIn post, article, GitHub, anything)"
          style={{ ...field, marginBottom: 0, flex: 1 }}
        />
        <PendingButton pendingLabel="Extracting…" style={btn}>
          Extract
        </PendingButton>
      </form>
    );
  }

  if (mode === "pdf") {
    return (
      <form action={addSource} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input type="hidden" name="type" value="doc" />
        <input
          type="file"
          name="file"
          accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          required
          style={{ ...field, marginBottom: 0, flex: 1, minWidth: 240 }}
        />
        <PendingButton pendingLabel="Extracting…" style={btn}>
          Extract
        </PendingButton>
      </form>
    );
  }

  return (
    <form action={addSource}>
      <input type="hidden" name="type" value="text" />
      <input name="title" placeholder="Title (optional)" style={field} />
      <textarea
        name="text"
        placeholder="Paste text or markdown — notes, an essay, an opinion, a bit of your story…"
        rows={5}
        required
        style={{ ...field, resize: "vertical" }}
      />
      <PendingButton pendingLabel="Extracting…" style={btn}>
        Extract text
      </PendingButton>
    </form>
  );
}
