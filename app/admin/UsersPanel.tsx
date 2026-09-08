"use client";

import { useMemo, useState, useTransition } from "react";
import { SectionTitle, Label, btn, btnGhost, btnDanger, panel, stamp } from "./ui";
// The surface field style: rows sit on the surface panel, and some tenant
// themes pair --on-bg-soft/--bg-soft unreadably (same fix as onboarding's
// FormCard), so inputs stay on surface tokens.
import { cf as field } from "@/app/cards/Cards";

/**
 * Operator-only account administration (see docs/features/admin-user-management).
 * Rows arrive server-fetched; search filters client-side. Every mutation calls
 * an operator-gated server action and surfaces its {ok}|{error} result inline.
 *
 * One table row per account, icon actions, and an editor row that folds out
 * under the account being managed. Columns beyond name + actions hide on
 * narrow screens. Everything styles through the tenant theme tokens
 * (color-mix over --primary / --on-surface) so any brand palette works.
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

type ActionResult = { ok: true } | { error: string };
type PasswordResult = { password: string } | { error: string };

type RowActions = {
  updateAction: (formData: FormData) => Promise<ActionResult>;
  disableAction: (formData: FormData) => Promise<ActionResult>;
  deleteAction: (formData: FormData) => Promise<ActionResult>;
  passwordAction: (id: string) => Promise<PasswordResult>;
  impersonateAction: (formData: FormData) => Promise<void>;
};

const PAGE_SIZE = 10;

const soft = (pct: number) => `color-mix(in srgb, var(--on-surface) ${pct}%, transparent)`;

/** Hover/focus/responsive polish that inline styles can't express. */
const CSS = `
  .up-panel button { cursor: pointer; transition: opacity .12s ease, transform .06s ease; }
  .up-panel button:hover:not(:disabled) { opacity: .8; }
  .up-panel button:active:not(:disabled) { transform: translateY(1px); }
  .up-panel button:disabled { opacity: .5; cursor: default; }
  .up-panel input:focus {
    border-color: color-mix(in srgb, var(--primary) 65%, var(--border));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 18%, transparent);
  }
  .up-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .up-table th {
    text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: .06em; padding: 6px 10px;
    color: color-mix(in srgb, var(--on-surface) 65%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--on-surface) 22%, transparent);
  }
  .up-table td {
    padding: 9px 10px; vertical-align: middle;
    border-bottom: 1px solid color-mix(in srgb, var(--on-surface) 12%, transparent);
  }
  .up-table tr.up-account:hover td {
    background: color-mix(in srgb, var(--on-surface) 5%, transparent);
  }
  .up-editor-cell { animation: up-open .16s ease; }
  @keyframes up-open { from { opacity: 0; transform: translateY(-3px); } }
  @media (max-width: 860px) { .up-hide-sm { display: none; } }
`;

/** 16px stroke icons so actions read at a glance without emoji. */
function Icon({ d, filled }: { d: string; filled?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

const ICON = {
  pencil: "M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z",
  close: "M18 6 6 18 M6 6l12 12",
  key: "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777Zm0 0L15.5 7.5m3 3L22 7l-3-3",
  enter: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4 M10 17l5-5-5-5 M15 12H3",
  power: "M18.4 6.6a9 9 0 1 1-12.8 0 M12 2v10",
  trash: "M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
};

function IconButton({
  icon,
  label,
  onClick,
  danger,
  active,
  disabled,
}: {
  icon: keyof typeof ICON;
  label: string;
  onClick: () => void;
  danger?: boolean;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      style={{
        width: 30,
        height: 30,
        display: "grid",
        placeItems: "center",
        background: active ? "color-mix(in srgb, var(--primary) 35%, transparent)" : "transparent",
        color: danger ? "var(--danger-on-surface)" : "inherit",
        border: `1px solid ${
          danger ? "color-mix(in srgb, var(--danger-on-surface) 40%, transparent)" : soft(22)
        }`,
        borderRadius: 7,
      }}
    >
      <Icon d={ICON[icon]} />
    </button>
  );
}

/** Initial-letter avatar tinted from the brand primary — theme-safe on any palette. */
function Avatar({ name, dimmed }: { name: string; dimmed: boolean }) {
  return (
    <div
      aria-hidden
      style={{
        width: 32,
        height: 32,
        borderRadius: "50%",
        flexShrink: 0,
        display: "grid",
        placeItems: "center",
        fontWeight: 700,
        fontSize: 14,
        fontFamily: "var(--font-heading)",
        background: "color-mix(in srgb, var(--primary) 30%, var(--surface))",
        border: "1px solid color-mix(in srgb, var(--primary) 45%, transparent)",
        filter: dimmed ? "grayscale(1)" : undefined,
      }}
    >
      {(name.trim()[0] || "?").toUpperCase()}
    </div>
  );
}

/** Small status pill: "you", "disabled", "onboarding". */
function Chip({ tone, children }: { tone: "neutral" | "danger"; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontStyle: "normal",
        padding: "1px 8px",
        borderRadius: 999,
        color: tone === "danger" ? "var(--danger-on-surface)" : "inherit",
        background:
          tone === "danger"
            ? "color-mix(in srgb, var(--danger-on-surface) 12%, transparent)"
            : soft(9),
        border: `1px solid ${
          tone === "danger"
            ? "color-mix(in srgb, var(--danger-on-surface) 35%, transparent)"
            : soft(18)
        }`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** The shown-once credential, made impossible to scroll past. */
function PasswordReveal({ intro, password }: { intro: string; password: string }) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: "10px 14px",
        borderRadius: "var(--radius-sm)",
        border: "1px dashed color-mix(in srgb, var(--primary) 55%, transparent)",
        background: "color-mix(in srgb, var(--primary) 10%, transparent)",
        fontSize: 13,
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <span>{intro} — shown once, hand it over now:</span>
      <code style={{ userSelect: "all", fontSize: 15, fontWeight: 700, letterSpacing: 0.5 }}>
        {password}
      </code>
    </div>
  );
}

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
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((r) =>
      terms.every((t) =>
        [r.name, r.email, r.slug].some((v) => v.toLowerCase().includes(t)),
      ),
    );
  }, [rows, q]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  return (
    <section data-fill="surface" style={panel} className="up-panel">
      <style>{CSS}</style>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <SectionTitle>Users</SectionTitle>
        <span style={{ fontSize: 12, fontStyle: "italic", color: soft(75) }}>
          {rows.length} account{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <CreateUser createAction={createAction} />
      <input
        type="search"
        placeholder="Search name, email, or slug…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(0);
        }}
        style={{ ...field, marginBottom: 14, borderRadius: 999, padding: "10px 18px" }}
        aria-label="Search users"
      />
      {visible.length === 0 ? (
        <p style={{ textAlign: "center", padding: "22px 0 10px", fontStyle: "italic", fontSize: 14, color: soft(75) }}>
          No accounts match{q.trim() ? ` “${q.trim()}”` : ""}.
        </p>
      ) : (
        <table className="up-table">
          <thead>
            <tr>
              <th>Account</th>
              <th className="up-hide-sm">Page</th>
              <th className="up-hide-sm">Joined</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <UserRow key={r.id} row={r} isSelf={r.id === selfId} {...actions} />
            ))}
          </tbody>
        </table>
      )}
      {pages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 10, fontSize: 13 }}>
          <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} style={btnGhost}>
            Prev
          </button>
          <span>Page {current + 1} of {pages} · {filtered.length} accounts</span>
          <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} style={btnGhost}>
            Next
          </button>
        </div>
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
      style={{
        marginBottom: 16,
        padding: "12px 14px",
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${soft(16)}`,
        background: soft(5),
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 180px" }}>
          <Label>New account name</Label>
          <input name="name" required style={{ ...field, marginBottom: 0 }} />
        </div>
        <div style={{ flex: "1 1 180px" }}>
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
        <PasswordReveal intro={`Created ${created.email}. Password`} password={created.password} />
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
  impersonateAction,
}: { row: UserAccount; isSelf: boolean } & RowActions) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [issued, setIssued] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  const report = (result: ActionResult, okText: string) =>
    setMessage("error" in result ? { ok: false, text: result.error } : { ok: true, text: okText });

  const withId = (extra?: Record<string, string>) => {
    const data = new FormData();
    data.set("id", row.id);
    for (const [k, v] of Object.entries(extra ?? {})) data.set(k, v);
    return data;
  };

  const toggleDisabled = () =>
    startTransition(async () => {
      const data = withId({ disabled: row.disabledAt ? "" : "1" });
      report(await disableAction(data), row.disabledAt ? "Account enabled." : "Account disabled.");
      setOpen(true);
    });

  const issue = () =>
    startTransition(async () => {
      const result = await passwordAction(row.id);
      if ("error" in result) setMessage({ ok: false, text: result.error });
      else {
        setIssued(result.password);
        setMessage(null);
      }
      setOpen(true); // the reveal lives in the editor row
    });

  const destroy = () =>
    startTransition(async () => {
      report(await deleteAction(withId()), "Account deleted.");
      setConfirmingDelete(false);
      setOpen(true);
    });

  const enter = () =>
    startTransition(async () => {
      // Redirects into the target account's dashboard on success.
      await impersonateAction(withId());
    });

  const disabled = row.disabledAt !== null;
  const columns = 4;

  return (
    <>
      <tr className="up-account" style={{ opacity: disabled ? 0.65 : 1 }}>
        <td>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Avatar name={row.name} dimmed={disabled} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 14 }}>{row.name}</strong>
                {isSelf && <Chip tone="neutral">you</Chip>}
                {disabled && <Chip tone="danger">disabled</Chip>}
                {row.onboardedAt === null && <Chip tone="neutral">onboarding</Chip>}
              </div>
              <div style={{ fontSize: 12, fontStyle: "italic", color: soft(75), overflowWrap: "anywhere" }}>
                {row.email}
              </div>
            </div>
          </div>
        </td>
        <td className="up-hide-sm" style={{ whiteSpace: "nowrap" }}>/a/{row.slug}</td>
        <td className="up-hide-sm" style={{ whiteSpace: "nowrap", color: soft(80) }}>
          {stamp(row.createdAt).slice(0, 10)}
        </td>
        <td>
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
            {confirmingDelete ? (
              <>
                <button type="button" disabled={pending} onClick={destroy} style={{ ...btnDanger, fontWeight: 600, background: "color-mix(in srgb, var(--danger-on-surface) 14%, transparent)" }}>
                  Really delete
                </button>
                <button type="button" onClick={() => setConfirmingDelete(false)} style={btnGhost}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <IconButton icon={open ? "close" : "pencil"} label={open ? "Close editor" : "Edit account"} active={open} onClick={() => setOpen(!open)} disabled={pending} />
                <IconButton icon="key" label="Issue new password" onClick={issue} disabled={pending} />
                {!isSelf && !disabled && (
                  <IconButton icon="enter" label="Log in as this account" onClick={enter} disabled={pending} />
                )}
                {!isSelf && (
                  <IconButton icon="power" label={disabled ? "Enable account" : "Disable account"} danger={!disabled} onClick={toggleDisabled} disabled={pending} />
                )}
                {!isSelf && (
                  <IconButton icon="trash" label="Delete account" danger onClick={() => setConfirmingDelete(true)} disabled={pending} />
                )}
              </>
            )}
          </div>
        </td>
      </tr>
      {(open || message || issued) && (
        <tr>
          <td colSpan={columns} className="up-editor-cell" style={{ background: soft(4), padding: "12px 14px" }}>
            {open && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  startTransition(async () => {
                    report(await updateAction(new FormData(form)), "Saved.");
                  });
                }}
              >
                <input type="hidden" name="id" value={row.id} />
                <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 160px" }}>
                    <Label>Name</Label>
                    <input name="name" defaultValue={row.name} style={{ ...field, marginBottom: 0 }} />
                  </div>
                  <div style={{ flex: "1 1 200px" }}>
                    <Label>Email</Label>
                    <input name="email" defaultValue={row.email} style={{ ...field, marginBottom: 0 }} />
                  </div>
                  <div style={{ flex: "1 1 140px" }}>
                    <Label>Slug</Label>
                    <input name="slug" defaultValue={row.slug} style={{ ...field, marginBottom: 0 }} />
                  </div>
                  <button type="submit" disabled={pending} style={btn}>
                    {pending ? "Working…" : "Save"}
                  </button>
                </div>
              </form>
            )}
            {message && (
              <p style={{ fontSize: 13, marginTop: open ? 8 : 0, color: message.ok ? "var(--success-on-surface)" : "var(--danger-on-surface)" }}>
                {message.text}
              </p>
            )}
            {issued && <PasswordReveal intro="New password" password={issued} />}
          </td>
        </tr>
      )}
    </>
  );
}
