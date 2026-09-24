import { saveBookingSettingsAction } from "../actions";
import { PendingButton } from "../PendingButton";
import { field as fieldStyle, btn, panel, SectionTitle, Label } from "../ui";
import type { BookingSettings, ServiceRow } from "@/lib/booking/types";
import { RowsEditor, SelectField, type RowColumn } from "./RowsEditor";

const CURRENCIES = ["USD", "CAD", "GBP", "EUR", "AUD", "NZD"];

const MEMBERSHIP_COLUMNS: RowColumn[] = [
  { key: "name", label: "Membership", placeholder: "VIP", required: true },
  { key: "percent", label: "% off", kind: "percent", placeholder: "15" },
];

/**
 * "Pricing & policies": currency, tax, service fee, tips, promo codes,
 * memberships, and the tenant-wide policy text (a service's own policy, when
 * set, overrides the cancellation one). Promo codes and memberships are rows
 * with dropdowns, posted in the line format the action parses. One form →
 * saveBookingSettingsAction (marked "section=pricing").
 */
export function PricingPanel({ settings, services }: { settings: BookingSettings; services: ServiceRow[] }) {
  const knownCurrency = CURRENCIES.includes(settings.currency);
  const promoColumns: RowColumn[] = [
    { key: "code", label: "Code", placeholder: "WELCOME10", required: true, width: 130 },
    { key: "amount", label: "Off", placeholder: "10% or 5", width: 90 },
    { key: "note", label: "Note", placeholder: "First visit" },
    { key: "expires", label: "Expires", kind: "date" },
    {
      key: "service",
      label: "Applies to",
      kind: "select",
      options: [{ value: "", label: "Every service" }, ...services.map((s) => ({ value: s.id, label: s.name }))],
      width: 160,
    },
  ];
  return (
    <section>
      <div data-fill="surface" style={panel}>
        <SectionTitle>Pricing &amp; policies</SectionTitle>
        <form action={saveBookingSettingsAction}>
          <input type="hidden" name="section" value="pricing" />

          <div style={grid2}>
            <div>
              <Label>Currency</Label>
              <select name="currency" defaultValue={knownCurrency ? settings.currency : ""} style={fieldStyle}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="">Other (type below)</option>
              </select>
              <input
                name="currencyOther"
                defaultValue={knownCurrency ? "" : settings.currency}
                placeholder="ISO 4217 code, e.g. CHF"
                maxLength={3}
                style={fieldStyle}
              />
            </div>
            <div>
              <Label>Tax rate (%)</Label>
              <input name="taxRate" type="number" min="0" max="100" step="0.01" defaultValue={settings.taxRate} style={fieldStyle} />
              <Label>Tax label</Label>
              <input name="taxLabel" defaultValue={settings.taxLabel} style={{ ...fieldStyle, marginBottom: 0 }} />
            </div>
          </div>

          <div style={box}>
            <Label>Service fee</Label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <select name="serviceFeeKind" defaultValue={settings.serviceFee.kind} style={{ ...fieldStyle, width: "auto", marginBottom: 0 }}>
                <option value="none">None</option>
                <option value="fixed">Fixed amount</option>
                <option value="percent">Percent</option>
              </select>
              <input
                name="serviceFeeAmount"
                type="number"
                min="0"
                step="0.01"
                defaultValue={settings.serviceFee.amount}
                placeholder="Amount"
                style={{ ...fieldStyle, width: 120, marginBottom: 0 }}
              />
              <input
                name="serviceFeeLabel"
                defaultValue={settings.serviceFee.label}
                placeholder="Label, e.g. Service fee"
                style={{ ...fieldStyle, flex: "1 1 160px", marginBottom: 0 }}
              />
            </div>
          </div>

          <div style={box}>
            <label style={checkboxLabel}>
              <input type="checkbox" name="tipsEnabled" defaultChecked={settings.tips.enabled} /> Offer a tip at checkout
            </label>
            <Label>Preset percentages (comma-separated)</Label>
            <input name="tipsPresets" defaultValue={settings.tips.presets.join(", ")} placeholder="15, 20, 25" style={{ ...fieldStyle, marginBottom: 0 }} />
          </div>

          <RowsEditor
            name="promoCodes"
            label="Promo codes"
            columns={promoColumns}
            initial={settings.promoCodes.map((p) => ({
              code: p.code,
              amount: p.kind === "percent" ? `${p.amount}%` : String(p.amount),
              note: p.note ?? "",
              expires: p.expiresOn ?? "",
              service: p.serviceIds[0] ?? "",
            }))}
            addLabel="+ Add a promo code"
            hint="“Off” is a percent when it ends in %, otherwise a fixed amount."
          />

          <RowsEditor
            name="memberships"
            label="Memberships"
            columns={MEMBERSHIP_COLUMNS}
            initial={settings.memberships.map((m) => ({ name: m.name, percent: String(m.discountPercent) }))}
            addLabel="+ Add a membership"
            serialize={(rows) => rows.map((r) => `${r.name} | ${r.percent}%`).join("\n")}
          />

          <Label>Cancellation policy</Label>
          <textarea name="cancellationPolicy" defaultValue={settings.cancellationPolicy} rows={3} style={{ ...fieldStyle, resize: "vertical" }} />
          <Label>Deposit policy</Label>
          <textarea name="depositPolicy" defaultValue={settings.depositPolicy} rows={2} style={{ ...fieldStyle, resize: "vertical" }} />
          <Label>Confirmation note (shown on the booking confirmation)</Label>
          <textarea name="confirmationNote" defaultValue={settings.confirmationNote} rows={2} style={{ ...fieldStyle, resize: "vertical" }} />

          <PendingButton pendingLabel="Saving…" style={btn as React.CSSProperties}>
            Save
          </PendingButton>
        </form>
      </div>
    </section>
  );
}

const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
const box: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: 12,
  marginBottom: 12,
};
const checkboxLabel: React.CSSProperties = { fontSize: 13, display: "flex", alignItems: "center", gap: 6, marginBottom: 8 };
