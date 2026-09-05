"use client";

import { useMemo, useState, useTransition } from "react";
import { Paginated } from "./Paginated";
import { SectionTitle, Label, btn, btnGhost, btnDanger, panel, stamp } from "./ui";
// The surface field style: rows sit on the surface panel, and some tenant
// themes pair --on-bg-soft/--bg-soft unreadably (same fix as onboarding's
// FormCard), so inputs stay on surface tokens.
import { cf as field } from "@/app/cards/Cards";

/**
 * Operator-only account administration (see docs/features/admin-user-management).
 * Rows arrive server-fetched; search filters client-side, the same pattern as
 * the other admin lists. Every mutation calls an operator-gated server action
 * and surfaces its {ok}|{error} result inline.
 */

export type UserAccount = {
  id: string;
  name: string;
  email: string;
  slug: string;
  createdAt: Date;
  onboardedAt: Date | null;
  disabledAt: Date | null;
};

export type ChatHistorySession = {
  id: string;
  firstQuery: string;
  updatedAt: Date;
  messages: { id: string; role: string; content: string; createdAt: Date }[];
};

type ActionResult = { ok: true } | { error: string };
type PasswordResult = { password: string } | { error: string };

type RowActions = {
  updateAction: (formData: FormData) => Promise<ActionResult>;
  disableAction: (formData: FormData) => Promise<ActionResult>;
  deleteAction: (formData: FormData) => Promise<ActionResult>;
  passwordAction: (id: string) => Promise<PasswordResult>;
  chatsAction: (id: string) => Promise<ChatHistorySession[]>;
  impersonateAction: (formData: FormData) => Promise<void>;
};

export function UsersPanel({
  rows,
  selfId,
  createAction,
  ...actions
}: {
  rows: UserAccount[];
  selfId: string;
  createAction: (formData: FormData) => Promise<PasswordResult>;
} & RowActions) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((r) =>
      terms.every((t) =>
        [r.name, r.email, r.slug].some((v) => v.toLowerCase().includes(t)),
      ),
    );
  }, [rows, q]);

  return (
    <section data-fill="surface" style={panel}>
      <SectionTitle>Users</SectionTitle>
      <CreateUser createAction={createAction} />
      <input
        type="search"
        placeholder="Search name, email, or slug…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ ...field, marginBottom: 14 }}
        aria-label="Search users"
      />
      {filtered.length === 0 ? (
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 14 }}>
          No accounts match.
        </p>
      ) : (
        <Paginated pageSize={10}>
          {filtered.map((r) => (
            <UserRow key={r.id} row={r} isSelf={r.id === selfId} {...actions} />
          ))}
        </Paginated>
      )}
    </section>
  );
}

/** New-account form: name + email in, shown-once generated password out. */
function CreateUser({
  createAction,
}: {
  createAction: (formData: FormData) => Promise<PasswordResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        startTransition(async () => {
          const result = await createAction(data);
          if ("error" in result) {
            setError(result.error);
            setCreated(null);
          } else {
            setError(null);
            setCreated({ email: String(data.get("email") ?? ""), password: result.password });
            form.reset();
          }
        });
      }}
      style={{ marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end" }}>
        <div>
          <Label>New account name</Label>
          <input name="name" required style={{ ...field, marginBottom: 0 }} />
        </div>
        <div>
          <Label>Email</Label>
          <input name="email" type="email" required style={{ ...field, marginBottom: 0 }} />
        </div>
        <button type="submit" disabled={pending} style={btn}>
          {pending ? "Creating…" : "Create user"}
        </button>
      </div>
      {error && (
        <p style={{ fontSize: 13, marginTop: 8, color: "var(--danger-on-surface)" }}>{error}</p>
      )}
      {created && (
        <p style={{ fontSize: 13, marginTop: 8 }}>
          Created {created.email}. Password (shown once — hand it over now):{" "}
          <code style={{ userSelect: "all" }}>{created.password}</code>
        </p>
      )}
    </form>
  );
}

function UserRow({
  row,
  isSelf,
  updateAction,
  disableAction,
  deleteAction,
  passwordAction,
  chatsAction,
  impersonateAction,
}: { row: UserAccount; isSelf: boolean } & RowActions) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [issued, setIssued] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [chats, setChats] = useState<ChatHistorySession[] | null>(null);
  const [pending, startTransition] = useTransition();

  const report = (result: ActionResult, okText: string) =>
    setMessage("error" in result ? { ok: false, text: result.error } : { ok: true, text: okText });

  const submit = (form: HTMLFormElement) =>
    startTransition(async () => {
      report(await updateAction(new FormData(form)), "Saved.");
    });

  const toggleDisabled = () =>
    startTransition(async () => {
      const data = new FormData();
      data.set("id", row.id);
      data.set("disabled", row.disabledAt ? "" : "1");
      report(await disableAction(data), row.disabledAt ? "Account enabled." : "Account disabled.");
    });

  const issue = () =>
    startTransition(async () => {
      const result = await passwordAction(row.id);
      if ("error" in result) setMessage({ ok: false, text: result.error });
      else {
        setIssued(result.password);
        setMessage(null);
      }
    });

  const destroy = () =>
    startTransition(async () => {
      const data = new FormData();
      data.set("id", row.id);
      report(await deleteAction(data), "Account deleted.");
      setConfirmingDelete(false);
    });

  const toggleChats = () => {
    if (chats) return setChats(null);
    startTransition(async () => {
      setChats(await chatsAction(row.id));
    });
  };

  const enter = () =>
    startTransition(async () => {
      const data = new FormData();
      data.set("id", row.id);
      // Redirects into the target account's dashboard on success.
      await impersonateAction(data);
    });

  const disabled = row.disabledAt !== null;

  return (
    <li
      style={{
        // Stays on the surface fill (color inherits) — see the field import.
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        padding: "12px 14px",
        opacity: disabled ? 0.75 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div>
          <strong>{row.name}</strong>
          {isSelf && <span style={{ fontSize: 11, fontStyle: "italic" }}> (you)</span>}
          {row.disabledAt !== null && (
            <span style={{ fontSize: 11, color: "var(--danger-on-surface)", marginLeft: 8 }}>
              disabled {stamp(row.disabledAt)}
            </span>
          )}
          <div style={{ fontSize: 12, fontStyle: "italic" }}>
            {row.email} · /a/{row.slug} · joined {stamp(row.createdAt)}
            {row.onboardedAt === null && " · onboarding incomplete"}
          </div>
        </div>
        <button type="button" onClick={() => setOpen(!open)} style={btnGhost}>
          {open ? "Close" : "Manage"}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(e.currentTarget);
            }}
          >
            <input type="hidden" name="id" value={row.id} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div>
                <Label>Name</Label>
                <input name="name" defaultValue={row.name} style={field} />
              </div>
              <div>
                <Label>Email</Label>
                <input name="email" defaultValue={row.email} style={field} />
              </div>
              <div>
                <Label>Slug</Label>
                <input name="slug" defaultValue={row.slug} style={field} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button type="submit" disabled={pending} style={btn}>
                {pending ? "Working…" : "Save"}
              </button>
              {!isSelf && (
                <button type="button" disabled={pending} onClick={toggleDisabled} style={disabled ? btnGhost : btnDanger}>
                  {disabled ? "Enable account" : "Disable account"}
                </button>
              )}
              <button type="button" disabled={pending} onClick={issue} style={btnGhost}>
                Issue new password
              </button>
              <button type="button" disabled={pending} onClick={toggleChats} style={btnGhost}>
                {chats ? "Hide chats" : "View chats"}
              </button>
              {!isSelf && !disabled && (
                <button type="button" disabled={pending} onClick={enter} style={btnGhost} title="Switch your session to this account">
                  Log in as
                </button>
              )}
              {!isSelf &&
                (confirmingDelete ? (
                  <>
                    <button type="button" disabled={pending} onClick={destroy} style={btnDanger}>
                      Really delete — everything goes
                    </button>
                    <button type="button" onClick={() => setConfirmingDelete(false)} style={btnGhost}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button type="button" disabled={pending} onClick={() => setConfirmingDelete(true)} style={btnDanger}>
                    Delete account
                  </button>
                ))}
            </div>
          </form>
          {message && (
            <p style={{ fontSize: 13, marginTop: 8, color: message.ok ? "var(--success-on-surface)" : "var(--danger-on-surface)" }}>
              {message.text}
            </p>
          )}
          {issued && (
            <p style={{ fontSize: 13, marginTop: 8 }}>
              New password (shown once — hand it over now):{" "}
              <code style={{ userSelect: "all" }}>{issued}</code>
            </p>
          )}
          {chats && (
            <div style={{ marginTop: 10 }}>
              {chats.length === 0 ? (
                <p style={{ fontSize: 13, fontStyle: "italic" }}>No visitor conversations yet.</p>
              ) : (
                chats.map((s) => (
                  <details key={s.id} style={{ marginBottom: 8, fontSize: 13 }}>
                    <summary style={{ cursor: "pointer" }}>
                      {s.firstQuery || "(no first question)"} · {s.messages.length} messages ·{" "}
                      {stamp(s.updatedAt)}
                    </summary>
                    <div style={{ display: "grid", gap: 6, padding: "8px 0 4px 14px" }}>
                      {s.messages.map((m) => (
                        <div key={m.id} style={{ whiteSpace: "pre-wrap" }}>
                          <em>{m.role === "user" ? "visitor" : "bot"}:</em> {m.content}
                        </div>
                      ))}
                    </div>
                  </details>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
