import { saveBookingSettingsAction } from "../actions";
import { PendingButton } from "../PendingButton";
import { field as fieldStyle, btn, panel, SectionTitle } from "../ui";
import {
  CUSTOMER_FIELD_KEYS,
  CORE_CUSTOMER_KEYS,
  CUSTOMER_FIELD_LABELS,
  type BookingSettings,
} from "@/lib/booking/types";

// sanitizeCustomerFields (lib/booking/types.ts) forces these regardless of
// what's posted — the checkboxes here are disabled to match, so the form
// never shows a control that can't actually change anything.
const ALWAYS_REQUIRED = new Set(["firstName", "email"]);
const NEVER_REQUIRED = new Set(["smsConsent"]);

/**
 * The customer-detail fields the booking flow asks for, beyond the
 * appointment itself. One form → saveBookingSettingsAction with
 * `customerFields` (marked "section=customer").
 */
export function CustomerPanel({ settings }: { settings: BookingSettings }) {
  const byKey = Object.fromEntries(settings.customerFields.map((f) => [f.key, f]));
  return (
    <section>
      <div data-fill="surface" style={panel}>
        <SectionTitle>Customer details</SectionTitle>
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13, marginBottom: 14 }}>
          The first five are always asked. Everything else is optional — turn it on and, if it
          matters, make it required.
        </p>
        <form action={saveBookingSettingsAction}>
          <input type="hidden" name="section" value="customer" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {CUSTOMER_FIELD_KEYS.map((key) => {
              const f = byKey[key];
              const core = (CORE_CUSTOMER_KEYS as readonly string[]).includes(key);
              const requiredLocked = ALWAYS_REQUIRED.has(key) || NEVER_REQUIRED.has(key);
              return (
                <div key={key} style={row}>
                  <span style={{ flex: "0 0 190px", fontSize: 13 }}>{CUSTOMER_FIELD_LABELS[key]}</span>
                  <input
                    name={`label.${key}`}
                    defaultValue={f?.label}
                    placeholder={CUSTOMER_FIELD_LABELS[key]}
                    style={{ ...fieldStyle, flex: "1 1 200px", marginBottom: 0 }}
                  />
                  <label style={checkboxLabel} title={core ? "Always asked" : undefined}>
                    <input type="checkbox" name={`ask.${key}`} defaultChecked={core || f?.enabled} disabled={core} /> Ask
                  </label>
                  <label style={checkboxLabel} title={requiredLocked ? "Fixed" : undefined}>
                    <input
                      type="checkbox"
                      name={`required.${key}`}
                      defaultChecked={ALWAYS_REQUIRED.has(key) ? true : NEVER_REQUIRED.has(key) ? false : f?.required}
                      disabled={requiredLocked}
                    />
                    Required
                  </label>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 14 }}>
            <PendingButton pendingLabel="Saving…" style={btn as React.CSSProperties}>
              Save
            </PendingButton>
          </div>
        </form>
      </div>
    </section>
  );
}

const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" };
const checkboxLabel: React.CSSProperties = { fontSize: 13, display: "flex", alignItems: "center", gap: 6 };
