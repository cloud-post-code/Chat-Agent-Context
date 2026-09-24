"use client";

import { btn, btnGhost, Label } from "../ui";
import { cf as field } from "@/app/cards/Cards";
import { PRICING_KINDS, type PricingKind } from "@/lib/booking/types";
import { minuteOptions } from "../booking/RowsEditor";
import type { ReviewService, ReviewStaff } from "@/lib/onboarding/bookingReview";

/**
 * The booking review, as two chat cards: the services (name, price, length,
 * on/off) and the providers (name, role, on/off, and whether a visitor picks
 * a person). Everything with a known set of answers is a dropdown. The caller
 * owns the rows and posts them to /api/admin/onboarding/booking; a row with an
 * empty id is one the owner added here.
 */

export const PRICING_KIND_LABELS: Record<PricingKind, string> = {
  free: "Free",
  fixed: "Fixed price",
  starting_at: "Starting at",
  range: "Price range",
  hourly: "Per hour",
  per_person: "Per person",
  per_unit: "Per unit",
  quote: "Quote",
  variable: "Varies",
};

export type ServiceDraft = Omit<ReviewService, "durationMinutes"> & { durationMinutes: string };
export type StaffDraft = ReviewStaff;

export const newService = (): ServiceDraft => ({
  id: "", name: "", category: "", pricingKind: "fixed", amount: "", maxAmount: "", durationMinutes: "60", enabled: true, imageUrl: null,
});
export const newStaff = (): StaffDraft => ({ id: "", name: "", role: "", enabled: true, photoUrl: null });

const priced = (k: PricingKind) => k !== "free" && k !== "quote" && k !== "variable";

export function ServicesSetupCard({
  services,
  onChange,
  onDone,
  busy,
}: {
  services: ServiceDraft[];
  onChange: (next: ServiceDraft[]) => void;
  onDone: () => void;
  busy: boolean;
}) {
  const set = (i: number, patch: Partial<ServiceDraft>) => onChange(services.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const remove = (i: number) => onChange(services.filter((_, j) => j !== i));
  const kept = services.filter((s) => s.name.trim());
  return (
    <div>
      {services.length === 0 ? (
        <p style={{ fontSize: 13, fontStyle: "italic", opacity: 0.8, margin: "0 0 10px" }}>No services yet — add what visitors can book.</p>
      ) : null}
      {services.map((s, i) => (
        <div key={s.id || `new-${i}`} className="onboard-phase-in" style={rowBox}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {s.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.imageUrl} alt="" style={{ width: 40, height: 40, borderRadius: "var(--radius-sm)", objectFit: "cover", flex: "0 0 auto" }} />
            ) : null}
            <input
              style={{ ...field, marginBottom: 0, flex: 1 }}
              value={s.name}
              placeholder="Service name"
              aria-label="Service name"
              disabled={busy}
              onChange={(e) => set(i, { name: e.target.value })}
            />
            <button type="button" style={{ ...btnGhost, padding: "6px 9px" }} onClick={() => remove(i)} disabled={busy} aria-label={`Remove ${s.name || "service"}`}>
              ✕
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <div style={{ flex: "1 1 130px" }}>
              <Label>Price</Label>
              <select style={{ ...field, marginBottom: 0 }} value={s.pricingKind} disabled={busy} aria-label="Pricing" onChange={(e) => set(i, { pricingKind: e.target.value as PricingKind })}>
                {PRICING_KINDS.map((k) => (
                  <option key={k} value={k}>{PRICING_KIND_LABELS[k]}</option>
                ))}
              </select>
            </div>
            {priced(s.pricingKind) ? (
              <div style={{ flex: "0 0 96px" }}>
                <Label>{s.pricingKind === "range" ? "From" : "Amount"}</Label>
                <input type="number" min={0} step="0.01" style={{ ...field, marginBottom: 0 }} value={s.amount} disabled={busy} aria-label="Amount" onChange={(e) => set(i, { amount: e.target.value })} />
              </div>
            ) : null}
            {s.pricingKind === "range" ? (
              <div style={{ flex: "0 0 96px" }}>
                <Label>To</Label>
                <input type="number" min={0} step="0.01" style={{ ...field, marginBottom: 0 }} value={s.maxAmount} disabled={busy} aria-label="To" onChange={(e) => set(i, { maxAmount: e.target.value })} />
              </div>
            ) : null}
            <div style={{ flex: "1 1 120px" }}>
              <Label>Length</Label>
              <select style={{ ...field, marginBottom: 0 }} value={s.durationMinutes} disabled={busy} aria-label="Length" onChange={(e) => set(i, { durationMinutes: e.target.value })}>
                {minuteOptions(s.durationMinutes).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: "1 1 120px" }}>
              <Label>Bookable</Label>
              <select style={{ ...field, marginBottom: 0 }} value={s.enabled ? "on" : "off"} disabled={busy} aria-label="Bookable" onChange={(e) => set(i, { enabled: e.target.value === "on" })}>
                <option value="on">Yes</option>
                <option value="off">Not yet</option>
              </select>
            </div>
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
        <button type="button" style={btnGhost} onClick={() => onChange([...services, newService()])} disabled={busy}>
          + Add a service
        </button>
        <button type="button" style={btn} onClick={onDone} disabled={busy}>
          {busy ? "Saving…" : kept.length ? `Done — ${kept.length} service${kept.length === 1 ? "" : "s"}` : "Done — no services for now"}
        </button>
      </div>
    </div>
  );
}

export function ProvidersSetupCard({
  staff,
  staffSelection,
  onChange,
  onSelection,
  onDone,
  busy,
}: {
  staff: StaffDraft[];
  staffSelection: "hidden" | "optional" | "required";
  onChange: (next: StaffDraft[]) => void;
  onSelection: (v: "hidden" | "optional" | "required") => void;
  onDone: () => void;
  busy: boolean;
}) {
  const set = (i: number, patch: Partial<StaffDraft>) => onChange(staff.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const remove = (i: number) => onChange(staff.filter((_, j) => j !== i));
  const kept = staff.filter((p) => p.name.trim());
  return (
    <div>
      {staff.length === 0 ? (
        <p style={{ fontSize: 13, fontStyle: "italic", opacity: 0.8, margin: "0 0 10px" }}>No providers yet — add the people visitors can book with, or leave this empty if it doesn&apos;t matter who.</p>
      ) : null}
      {staff.map((p, i) => (
        <div key={p.id || `new-${i}`} className="onboard-phase-in" style={{ ...rowBox, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {p.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.photoUrl} alt="" style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover", flex: "0 0 auto" }} />
          ) : null}
          <input style={{ ...field, marginBottom: 0, flex: "1 1 140px" }} value={p.name} placeholder="Name" aria-label="Provider name" disabled={busy} onChange={(e) => set(i, { name: e.target.value })} />
          <input style={{ ...field, marginBottom: 0, flex: "1 1 120px" }} value={p.role} placeholder="Role (optional)" aria-label="Role" disabled={busy} onChange={(e) => set(i, { role: e.target.value })} />
          <select style={{ ...field, marginBottom: 0, flex: "0 0 110px" }} value={p.enabled ? "on" : "off"} aria-label="Bookable" disabled={busy} onChange={(e) => set(i, { enabled: e.target.value === "on" })}>
            <option value="on">Bookable</option>
            <option value="off">Not yet</option>
          </select>
          <button type="button" style={{ ...btnGhost, padding: "6px 9px" }} onClick={() => remove(i)} disabled={busy} aria-label={`Remove ${p.name || "provider"}`}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" style={{ ...btnGhost, marginBottom: 14 }} onClick={() => onChange([...staff, newStaff()])} disabled={busy}>
        + Add a provider
      </button>
      {kept.length > 0 ? (
        <div style={{ marginBottom: 14 }}>
          <Label>Can visitors pick who they see?</Label>
          <select style={{ ...field, marginBottom: 0, maxWidth: 360 }} value={staffSelection} disabled={busy} aria-label="Picking a provider" onChange={(e) => onSelection(e.target.value as "hidden" | "optional" | "required")}>
            <option value="optional">Yes, or leave it to “anyone available”</option>
            <option value="required">Yes — they must pick a person</option>
            <option value="hidden">No — we assign someone</option>
          </select>
        </div>
      ) : null}
      <button type="button" style={btn} onClick={onDone} disabled={busy}>
        {busy ? "Saving…" : kept.length ? `Done — ${kept.length} provider${kept.length === 1 ? "" : "s"}` : "Done — no providers"}
      </button>
    </div>
  );
}

const rowBox: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: 10,
  marginBottom: 8,
};
