import React from "react";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { isEditAuthed } from "@/lib/ingestionAuth";
import { getIngestionSource, UPLOAD_METHODS, STORAGE_KINDS } from "@/lib/ingestionSources";
import { listIngestedItems } from "@/lib/ingestedItems";
import { unlockIngestionEditAction, updateIngestionSourceAction, deleteIngestionSourceAction, setIngestionSourceHiddenAction } from "@/app/admin/actions/ingestion";
import { SourceBuilder } from "../../SourceBuilder";
import { PendingButton } from "../../PendingButton";
import { ClassificationSelect } from "../../ClassificationSelect";
import { panel, field, btn, btnGhost, SectionTitle, Label, stamp } from "../../ui";

export const dynamic = "force-dynamic";

/**
 * Edit one ingestion source the same way it was built: the builder chat and
 * sample page, seeded with the stored config. The manual form survives below,
 * collapsed, for direct field edits (and it alone exposes order/enabled).
 * Double-gated: admin login gets you to the page, but editing only unlocks
 * with the edit password held in the local .env (INGESTION_EDIT_PASSWORD;
 * the update actions re-check the unlock cookie server-side, so the lock is
 * not just UI).
 */
export default async function EditIngestionSourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (!user) redirect("/admin");
  const { key } = await params;
  const query = await searchParams;
  const error = Array.isArray(query.error) ? query.error[0] : query.error;

  const row = await getIngestionSource(user.id, key);
  if (!row) notFound();
  const unlocked = await isEditAuthed();
  // How much the Danger zone's delete would destroy — counted lazily so a
  // locked page never pays for it.
  const itemCount = unlocked ? (await listIngestedItems(user.id, row.key)).length : 0;

  return (
    <main
      style={{
        maxWidth: unlocked ? 1100 : 640,
        margin: "0 auto",
        padding: "24px 20px 80px",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 24 }}>Edit ingestion — {row.label}</h1>
        <Link href={`/admin/dashboard?tab=${row.key}`} style={btnGhost as React.CSSProperties}>
          Back
        </Link>
      </header>
      <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 12, marginBottom: 16 }}>
        Created {stamp(row.createdAt)} · Updated {stamp(row.updatedAt)}
      </p>
      {error ? (
        <p role="alert" style={{ color: "var(--danger, #b00020)", marginBottom: 14 }}>
          {error === "1" ? "Wrong edit password." : error}
        </p>
      ) : null}

      {!unlocked ? (
        <section data-fill="surface" style={panel}>
          <SectionTitle>Unlock editing</SectionTitle>
          <p style={{ fontSize: 13, fontStyle: "italic", marginBottom: 12 }}>
            Editing an ingestion source changes what the agent ingests and how.
            Enter the edit password from your local .env
            (INGESTION_EDIT_PASSWORD) to unlock this page for an hour.
          </p>
          <form action={unlockIngestionEditAction} style={{ display: "grid", gap: 10 }}>
            <input type="hidden" name="key" value={row.key} />
            <Label>Edit password</Label>
            <input type="password" name="password" required style={field as React.CSSProperties} />
            <PendingButton pendingLabel="Unlocking…" style={btn as React.CSSProperties}>
              Unlock
            </PendingButton>
          </form>
        </section>
      ) : (
        <>
          <SourceBuilder
            initial={{
              id: row.id,
              label: row.label,
              key: row.key,
              description: row.description,
              systemPrompt: row.systemPrompt,
              uploadMethod: row.uploadMethod,
              storageKinds: row.storageKinds,
              splitMode: row.splitMode,
              panelHtml: row.panelHtml,
              classification: row.classification,
              outputMethod: row.outputMethod,
            }}
          />

          <details style={{ marginTop: 24 }}>
            <summary style={{ cursor: "pointer", fontSize: 14, marginBottom: 10 }}>
              Manual edit (skip the chat)
            </summary>
            <section data-fill="surface" style={panel}>
              <SectionTitle>Source settings</SectionTitle>
              <form action={updateIngestionSourceAction} style={{ display: "grid", gap: 10 }}>
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="key" value={row.key} />
                <Label>Name</Label>
                <input name="label" defaultValue={row.label} required style={field as React.CSSProperties} />
                <Label>Description</Label>
                <input name="description" defaultValue={row.description} style={field as React.CSSProperties} />
                <Label>System prompt</Label>
                <textarea
                  name="systemPrompt"
                  rows={5}
                  defaultValue={row.systemPrompt}
                  style={field as React.CSSProperties}
                />
                <Label>Upload method</Label>
                <select name="uploadMethod" defaultValue={row.uploadMethod} style={field as React.CSSProperties}>
                  {UPLOAD_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <Label>Stores</Label>
                <select name="storageKinds" defaultValue={row.storageKinds} style={field as React.CSSProperties}>
                  {STORAGE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
            <Label>Items per upload</Label>
            <select name="splitMode" defaultValue={row.splitMode} style={field as React.CSSProperties}>
              <option value="split">split — one item per point (default)</option>
              <option value="single">single — keep each upload as one item</option>
            </select>
            <Label>Page code (advanced, optional — HTML with a {"{{items}}"} placeholder)</Label>
            <textarea
              name="panelHtml"
              rows={6}
              defaultValue={row.panelHtml}
              placeholder="Custom HTML for this tab; leave empty for the default page."
              style={field as React.CSSProperties}
            />
                <Label>Output (where ingested data lands)</Label>
                <input name="outputMethod" defaultValue={row.outputMethod} style={field as React.CSSProperties} />
                <Label>Display order (lower comes first in the tab strip)</Label>
                <input
                  name="order"
                  type="number"
                  defaultValue={row.order}
                  style={field as React.CSSProperties}
                />
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
                  <input type="checkbox" name="enabled" defaultChecked={row.enabled} />
                  Enabled (shown as a Content tab)
                </label>
                <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
                  <ClassificationSelect defaultValue={row.classification} />
                  <PendingButton pendingLabel="Saving…" style={btn as React.CSSProperties}>
                    Save changes
                  </PendingButton>
                </div>
              </form>
            </section>
          </details>

          <section data-fill="surface" style={{ ...panel, marginTop: 24 }}>
            <SectionTitle>Visibility</SectionTitle>
            <p style={{ fontSize: 13, marginBottom: 12 }}>
              {row.enabled
                ? "Shown as a Content tab. Hiding takes it off the tab strip without touching anything it has ingested — hidden sources stay listed above the Content tabs with a Show button, so this is always reversible."
                : "Hidden — not on the tab strip right now. Everything it ingested is untouched, and it stays listed above the Content tabs."}
            </p>
            <form action={setIngestionSourceHiddenAction}>
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="hidden" value={row.enabled ? "1" : ""} />
              <PendingButton
                pendingLabel={row.enabled ? "Hiding…" : "Showing…"}
                style={btnGhost as React.CSSProperties}
              >
                {row.enabled ? "Hide from tab strip" : "Show on tab strip"}
              </PendingButton>
            </form>
          </section>

          <section
            data-fill="surface"
            style={{
              ...panel,
              marginTop: 24,
              border: "1px solid var(--danger, #b00020)",
            }}
          >
            <SectionTitle>Danger zone</SectionTitle>
            <p style={{ fontSize: 13, marginBottom: 12 }}>
              <strong>Warning:</strong> deleting “{row.label}” permanently removes this
              ingestion source <em>and everything it has ingested</em> —{" "}
              {itemCount} item{itemCount === 1 ? "" : "s"}, plus their knowledge
              chunks and graph claims. The agent forgets all of it. This cannot
              be undone. If you just want it off the tab strip, use Visibility
              above instead.
            </p>
            <form action={deleteIngestionSourceAction} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="key" value={row.key} />
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                <input type="checkbox" name="confirm" required />
                I understand this deletes the source and all {itemCount} ingested
                item{itemCount === 1 ? "" : "s"}, permanently.
              </label>
              <PendingButton
                pendingLabel="Deleting…"
                style={{
                  ...(btn as React.CSSProperties),
                  background: "var(--danger, #b00020)",
                  borderColor: "var(--danger, #b00020)",
                  color: "#fff",
                  justifySelf: "start",
                }}
              >
                Delete source and all its data
              </PendingButton>
            </form>
          </section>
        </>
      )}
    </main>
  );
}
