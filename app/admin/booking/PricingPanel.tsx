import { saveBookingSettingsAction } from "../actions";
import { PendingButton } from "../PendingButton";
import { field as fieldStyle, btn, panel, SectionTitle, Label } from "../ui";
import type { BookingSettings } from "@/lib/booking/types";
import { formatPromoLines, formatMembershipLines } from "./lines";

const CURRENCIES = ["USD", "CAD", "GBP", "EUR", "AUD", "NZD"];

/**
 * "Pricing & policies": currency, tax, service fee, tips, promo codes,
 * memberships, and the tenant-wide policy text (a service's own policy, when
 * set, overrides the cancellation one). One form → saveBookingSettingsAction
 * (marked "section=pricing").
 */
export function PricingPanel({ settings }: { settings: BookingSettings }) {
  const knownCurrency = CURRENCIES.includes(settings.currency);
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

          <Label>Promo codes — one per line: CODE | 10% | note | 2026-12-31 | serviceId,serviceId</Label>
          <textarea
            name="promoCodes"
            defaultValue={formatPromoLines(settings.promoCodes)}
            rows={3}
            placeholder="WELCOME10 | 10% | First visit | 2026-12-31"
            style={{ ...fieldStyle, fontFamily: "ui-monospace, monospace", fontSize: 13, resize: "vertical" }}
          />

          <Label>Memberships — one per line: Name | 15%</Label>
          <textarea
            name="memberships"
            defaultValue={formatMembershipLines(settings.memberships)}
            rows={2}
            placeholder="VIP | 15%"
            style={{ ...fieldStyle, fontFamily: "ui-monospace, monospace", fontSize: 13, resize: "vertical" }}
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
