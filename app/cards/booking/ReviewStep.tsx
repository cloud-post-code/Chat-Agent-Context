"use client";

import { useEffect, useRef, useState } from "react";
import type {
  BookingFlow,
  BookingSelection,
  LocationRow,
  PriceBreakdown,
  ServiceRow,
  ServiceVariant,
  StaffRow,
} from "@/lib/booking/types";
import { formatDuration, formatMoney } from "@/lib/booking/types";
import { customerFromAnswers, isUploadType } from "@/lib/appointmentTypes";
import type { FlowField } from "@/lib/booking/flowSteps";
import { priceBreakdown } from "@/lib/booking/pricing";
import { formatInZone } from "@/lib/booking/time";
import { createBooking, quoteBooking, type CreateBookingResult } from "./api";
import { answerLines, hasAnswer, type Answer } from "../BookingQuestion";
import type { EditTarget } from "@/lib/booking/session";
import { Chip, chipRow, inputStyle, linkBtn, sectionLabel, textBtn } from "./ui";

/** The client's stand-in for BookingSettings: the visitor's flow carries only
 * the public `rules`, never the tenant's promo code list, so the local
 * fallback breakdown can never apply a promo — only the authoritative
 * /api/booking/quote can. That's fine: the fallback exists for when the
 * network is down, not to replace the server's figures. */
function clientSettings(flow: BookingFlow) {
  const { hasPromoCodes: _unused, ...rest } = flow.rules;
  return { ...rest, promoCodes: [] };
}

function formatHeaderDate(d: Date, tz: string): string {
  const datePart = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "long", day: "numeric" }).format(d);
  const timePart = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
  return `${datePart} at ${timePart}`;
}

const DEBOUNCE_MS = 300;

/** The answers that are text, as customerFromAnswers reads them (a choice answer is a list, never a contact detail). */
function textAnswers(answers: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers)) if (typeof v === "string") out[k] = v;
  return out;
}

export function ReviewStep({
  flow,
  service,
  variant,
  provider,
  location,
  selection,
  setSelection,
  fields,
  title = "",
  slug,
  onEdit,
  onBack,
  onConfirmed,
  preview = false,
}: {
  flow: BookingFlow;
  service: ServiceRow | null;
  variant: ServiceVariant | null;
  provider: StaffRow | null;
  location: LocationRow | null;
  selection: BookingSelection;
  setSelection: (s: BookingSelection) => void;
  /** Every field the form asks, role-tagged: the customer and the answers are both read from here. */
  fields: FlowField[];
  /** The business's own heading for this step; "" = the card's default. */
  title?: string;
  slug: string;
  onEdit: (target: EditTarget) => void;
  /** Left out when earlier steps stay editable in the thread: no Back button. */
  onBack?: () => void;
  onConfirmed: (result: CreateBookingResult, waitlisted: boolean) => void;
  /** False while a planned step before review has no valid answer: Confirm is disabled with `notReady`. */
  ready?: boolean;
  notReady?: string;
  /** The booking is done (or abandoned): controls disabled, no button. */
  locked?: boolean;
  /** The owner trying their own form: confirm draws the confirmation without booking anything. */
  preview?: boolean;
}) {
  const [breakdown, setBreakdown] = useState<PriceBreakdown | null>(null);
  const [promoInput, setPromoInput] = useState(selection.promoCode);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [full, setFull] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addons = service ? service.addons.filter((a) => selection.addonIds.includes(a.id)) : [];

  function localFallback(): PriceBreakdown {
    return priceBreakdown({
      service,
      variant,
      addons,
      quantity: selection.quantity,
      staff: provider,
      location,
      mode: selection.mode,
      settings: clientSettings(flow),
      promo: null,
      membership: null,
      tipPercent: selection.tipPercent,
      tipAmount: selection.tipAmount,
    });
  }

  // The add-on list as one string, so the effect below can depend on its
  // contents rather than on a fresh array each render.
  const addonKey = selection.addonIds.join(",");

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      quoteBooking(slug, selection).then((res) => {
        setBreakdown(res.ok ? res.breakdown : localFallback());
      });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    slug,
    selection.promoCode,
    selection.tipPercent,
    selection.tipAmount,
    selection.membershipId,
    selection.serviceId,
    selection.variantId,
    addonKey,
    selection.quantity,
    selection.staffId,
    selection.locationId,
    selection.mode,
    selection.startsAt,
  ]);

  const b = breakdown ?? localFallback();
  const startDate = selection.startsAt ? new Date(selection.startsAt) : null;
  const zone = selection.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const locationLine =
    selection.mode === "online"
      ? "Online"
      : selection.mode === "mobile"
        ? selection.customerAddress || "Your address"
        : location?.address || location?.name || "";
  // The customer is whatever the role-tagged answers say — the same read the
  // server makes when it books, so the review shows what the owner will see.
  const customer = customerFromAnswers(fields, textAnswers(selection.answers));
  const customerName = [customer.firstName, customer.lastName].filter(Boolean).join(" ");
  const hasContact = fields.some((f) => f.role !== "none" && f.role !== "policy");
  const answered = fields.filter((f) => (f.role === "none" || f.role === "notes") && hasAnswer(f, selection.answers[f.key] as Answer | undefined));
  const agreed = fields.filter((f) => f.role === "policy" && hasAnswer(f, selection.answers[f.key] as Answer | undefined));

  async function submit(waitlist: boolean) {
    if (sending) return;
    if (preview) {
      const start = new Date(selection.startsAt || Date.now());
      onConfirmed(
        {
          id: "preview",
          status: waitlist ? "waitlisted" : "confirmed",
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + b.durationMinutes * 60000).toISOString(),
          breakdown: b,
          staffName: provider?.name ?? "",
          locationName: location?.name ?? "",
          serviceName: service?.name ?? "",
          ids: [],
        },
        waitlist,
      );
      return;
    }
    setSending(true);
    setError("");
    setFull(false);
    const res = await createBooking(slug, { ...selection, waitlist });
    setSending(false);
    if (!res.ok) {
      setError(res.error);
      if (/full/i.test(res.error)) setFull(true);
      return;
    }
    onConfirmed(res, res.status === "waitlisted");
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <p style={{ fontSize: 12, opacity: 0.75, margin: 0 }}>{title || "Your appointment"}</p>
        <strong style={{ fontSize: 17, fontFamily: "var(--font-heading)", display: "block" }}>{service?.name ?? "Appointment"}</strong>
        <p style={{ margin: "2px 0" }}>{provider?.name ?? "Any available provider"}</p>
        {startDate && <p style={{ margin: "2px 0" }}>{formatHeaderDate(startDate, zone)}</p>}
        <p style={{ margin: "2px 0" }}>{formatDuration(b.durationMinutes)}</p>
        {locationLine && <p style={{ margin: "2px 0" }}>{locationLine}</p>}
        <p style={{ margin: "2px 0", fontWeight: 600 }}>{b.display}</p>
      </div>

      <ReviewSection label="Service" onEdit={() => onEdit("service")}>
        {service?.name ?? "Appointment"}
      </ReviewSection>
      {service && service.variants.length > 0 && (
        <ReviewSection label="Option" onEdit={() => onEdit("options")}>
          {variant?.name ?? "Standard"}
        </ReviewSection>
      )}
      {service && service.addons.length > 0 && (
        <ReviewSection label="Add-ons" onEdit={() => onEdit("options")}>
          {addons.map((a) => a.name).join(", ") || "None"}
        </ReviewSection>
      )}
      <ReviewSection label="Provider" onEdit={() => onEdit("provider")}>
        {provider?.name ?? "Any available"}
      </ReviewSection>
      {locationLine && (
        <ReviewSection label="Location" onEdit={() => onEdit("location")}>
          {locationLine}
        </ReviewSection>
      )}
      <ReviewSection label="Date & time" onEdit={() => onEdit("time")}>
        {startDate ? formatInZone(startDate, zone) : "—"}
      </ReviewSection>
      <ReviewSection label="Duration" onEdit={() => onEdit("time")}>
        {formatDuration(b.durationMinutes)}
      </ReviewSection>
      {hasContact && (
        <ReviewSection label="Your details" onEdit={() => onEdit("details")}>
          <div>{customerName || "—"}</div>
          {customer.email && <div>{customer.email}</div>}
          {customer.phone && <div>{customer.phone}</div>}
        </ReviewSection>
      )}
      {(answered.length > 0 || agreed.length > 0) && (
        <ReviewSection label="Your answers" onEdit={() => onEdit("intake")}>
          {answered.map((f) => (
            <div key={f.key} style={{ marginBottom: 4 }}>
              <span style={{ opacity: 0.75 }}>{f.label}: </span>
              <AnswerSummary field={f} value={selection.answers[f.key] as Answer | undefined} />
            </div>
          ))}
          {agreed.map((f) => (
            <div key={f.key} style={{ marginBottom: 4 }}>
              <span style={{ opacity: 0.75 }}>Policy: </span>
              <span>agreed</span>
            </div>
          ))}
        </ReviewSection>
      )}

      <div style={sectionLabel}>Price breakdown</div>
      {b.lines.map((l, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 2 }}>
          <span>{l.label}</span>
          <span>
            {l.amount === null ? "—" : formatMoney(l.amount, b.currency)}
            {l.estimate ? "+" : ""}
          </span>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginTop: 6, fontSize: 14 }}>
        <span>Total</span>
        <span>{b.display}</span>
      </div>
      {b.deposit !== null && <p style={{ fontSize: 13, marginTop: 6 }}>Deposit due today: {formatMoney(b.deposit, b.currency)}</p>}

      {flow.rules.hasPromoCodes && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input
            value={promoInput}
            onChange={(e) => setPromoInput(e.target.value)}
            placeholder="Promo code"
            style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
            aria-label="Promo code"
          />
          <button type="button" onClick={() => setSelection({ ...selection, promoCode: promoInput.trim() })} style={linkBtn}>
            Apply
          </button>
        </div>
      )}

      {flow.rules.tips.enabled && (
        <div style={{ marginTop: 10 }}>
          <div style={sectionLabel}>Tip</div>
          <div style={chipRow}>
            <Chip selected={!selection.tipPercent} onClick={() => setSelection({ ...selection, tipPercent: null, tipAmount: null })}>
              No tip
            </Chip>
            {flow.rules.tips.presets.map((p) => (
              <Chip key={p} selected={selection.tipPercent === p} onClick={() => setSelection({ ...selection, tipPercent: p, tipAmount: null })}>
                {p}%
              </Chip>
            ))}
          </div>
        </div>
      )}

      {flow.rules.memberships.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={sectionLabel}>Membership</div>
          <select
            value={selection.membershipId ?? ""}
            onChange={(e) => setSelection({ ...selection, membershipId: e.target.value || null })}
            style={inputStyle}
            aria-label="Membership"
          >
            <option value="">None</option>
            {flow.rules.memberships.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {(service?.cancellationPolicy || flow.rules.cancellationPolicy) && (
        <div style={{ marginTop: 10, padding: 10, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 12 }}>
          {service?.cancellationPolicy || flow.rules.cancellationPolicy}
        </div>
      )}

      {error && <p style={{ color: "var(--danger-on-bg-soft)", fontSize: 13, marginTop: 10 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button type="button" onClick={onBack} style={linkBtn}>
          Back
        </button>
      </div>
      <button
        type="button"
        onClick={() => submit(false)}
        disabled={sending}
        style={{
          width: "100%",
          padding: 12,
          fontSize: 15,
          fontWeight: 600,
          marginTop: 10,
          background: "var(--primary)",
          color: "var(--on-primary)",
          border: "none",
          borderRadius: "var(--radius-sm)",
          cursor: "pointer",
          opacity: sending ? 0.55 : 1,
        }}
      >
        {sending ? "Sending…" : flow.rules.confirmation === "request" ? "Request booking" : "Confirm booking"}
      </button>
      {flow.rules.confirmation === "request" && (
        <p style={{ fontSize: 12, fontStyle: "italic", margin: "8px 0 0" }}>
          {flow.business.name || "The business"} confirms requests
          {flow.business.phone ? ` — or call ${flow.business.phone} to book now` : ""}.
        </p>
      )}
      {full && flow.rules.waitlist && (
        <button type="button" onClick={() => submit(true)} disabled={sending} style={{ ...linkBtn, width: "100%", marginTop: 8, textAlign: "center" }}>
          Join waitlist instead
        </button>
      )}
    </div>
  );
}

function ReviewSection({ label, onEdit, children }: { label: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 12, opacity: 0.75 }}>{label}</span>
        <button type="button" onClick={onEdit} style={textBtn}>
          Edit
        </button>
      </div>
      <div style={{ fontSize: 14 }}>{children}</div>
    </div>
  );
}

/**
 * One intake answer as the review reads it. An upload is not its storage path:
 * a photo or signature shows as a thumbnail, a document as "Attached"; a
 * waiver reads "Agreed". Everything else lists the way the question step did.
 */
function AnswerSummary({ field, value }: { field: FlowField; value: Answer | undefined }) {
  const text = typeof value === "string" ? value : "";
  if (field.type === "waiver") return <span>Agreed</span>;
  if (isUploadType(field.type)) {
    if (!text) return <span>—</span>;
    const image = /\.(jpg|jpeg|png|webp|gif)$/i.test(text);
    return image ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={text}
        alt={field.type === "signature" ? "Your signature" : "Your photo"}
        style={{
          display: "block",
          maxWidth: field.type === "signature" ? 220 : 120,
          maxHeight: 90,
          marginTop: 4,
          borderRadius: "var(--radius-sm)",
          background: "#fff",
          border: "1px solid var(--border)",
        }}
      />
    ) : (
      <span>Attached</span>
    );
  }
  return <span>{answerLines(field, value).join(", ")}</span>;
}
